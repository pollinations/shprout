"""Simpler eval: generate bash from candidate prompt, ask Claude if it's
functionally equivalent to the real shprout. Average over n samples.

No regex, no sandbox, no execution. Just two scripts and one judge call.
"""
from __future__ import annotations
import json, os, re, textwrap
from dataclasses import dataclass

import urllib.request
import urllib.error

POLLI = "https://gen.pollinations.ai/v1"
_token_path = os.path.expanduser("~/.pollinations/shprout.json")
POLLI_KEY = json.load(open(_token_path))["apiKey"] if os.path.exists(_token_path) else "x"
GEN_MODEL = os.environ.get("GEN_MODEL", "claude-large")
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "openai-large")


def chat(model: str, messages: list, *, temperature: float = 0, timeout: float = 90,
         seed: int | None = None) -> str:
    """Direct call to Pollinations OpenAI-compatible chat-completions.

    Some reasoning models (e.g. claude-opus-4.7) reject `temperature` with HTTP
    400 "temperature is deprecated". Retry once without it on that signal.

    Pass `seed` to bypass response cache when you want fresh output.
    """
    def _post(payload: dict) -> str:
        req = urllib.request.Request(
            f"{POLLI}/chat/completions",
            data=json.dumps(payload).encode(),
            headers={
                "Authorization": f"Bearer {POLLI_KEY}",
                "Content-Type": "application/json",
                "User-Agent": "shprout-compress/0.1",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read())
        return data["choices"][0]["message"]["content"] or ""

    payload = {"model": model, "messages": messages, "temperature": temperature}
    if seed is not None:
        payload["seed"] = seed
    try:
        return _post(payload)
    except urllib.error.HTTPError as e:
        if e.code == 400:
            body = e.read().decode(errors="replace")
            if "temperature" in body and "deprecated" in body:
                payload.pop("temperature", None)
                return _post(payload)
        raise

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHPROUT_PATH = os.path.join(REPO_ROOT, "shprout")
with open(SHPROUT_PATH) as f:
    REAL_SHPROUT = f.read()


JUDGE_SYS = textwrap.dedent("""\
    You decide whether the CANDIDATE bash script is functionally equivalent to the
    REFERENCE at RUNTIME. Both are LLM-driven self-prompting agents.

    You are scoring whether the script will actually RUN and produce the same
    behavior — not whether the code reads like it should. A script that "looks
    equivalent" but won't execute correctly scores 0-3.

    Nine required behaviors:
      1. CRITICAL: Reads required config from env vars OPENAI_API_KEY, MODEL,
         OPENAI_BASE_URL (literally those names — these are the OpenAI standard
         and what every SDK uses). The script must use "$OPENAI_API_KEY",
         "$MODEL", "$OPENAI_BASE_URL" as bash variables. NOT a hardcoded URL.
      2. CRITICAL: Includes its OWN source code in the prompt sent to the LLM
         (via $0, BASH_SOURCE, cat "$0", or equivalent). Not just a system prompt
         describing what to do — the literal contents of the script itself.
      3. Accepts a purpose/task string from $1 directly. NOT via interactive
         `read -p`. NOT as a path to a file. The task string is "$1".
      4. CRITICAL: Loops at most 10 iterations AND breaks early when the
         reply is empty OR equals the literal string "exit". Without the early
         "exit" break, the agent runs to the bound even after completing the
         task, which times out in practice. Both break conditions are required:
         [[ -z $c ]] AND [[ $c == exit ]]. Bound > 10 fails this behavior.
      5. CRITICAL: POSTs to "$OPENAI_BASE_URL/chat/completions" with the OpenAI
         chat-completions JSON shape, using "$OPENAI_API_KEY" as bearer auth.
         Hardcoding api.openai.com or any other literal URL FAILS this behavior.
      6. Extracts assistant message content from the JSON response, and handles
         the case where it is null/empty without crashing the eval step.
      7. Strips ``` fences from the reply. The sed/awk/regex must work on BSD
         sed (macOS), not just GNU sed — no \\b, no \\s, no GNU-only extensions.
      8. Evaluates the resulting bash (eval, bash -c, source — any of these).
      9. Appends the reply AND the resulting stdout to the prompt for the next
         iteration (cumulative history, not overwriting).

    Things that DO NOT break equivalence:
      - Different variable names INTERNALLY, different loop syntax, different bound
      - set -euo pipefail or any extra safety checks
      - Different unfence regex (as long as it works on BSD sed)
      - Logging/printf differences, leading/trailing newlines
      - Error messages on missing env vars vs silent ':?' parameter expansion
      - Using 'bash -c' vs 'eval' (both run the LLM-supplied bash)
      - Inline curl body vs piped via @-

    Runtime failure patterns that DO break equivalence (auto-fail those behaviors):
      - Hardcoding api.openai.com (or any literal URL) instead of using
        "$OPENAI_BASE_URL" → fails #5
      - Using KEY / API_KEY / API instead of the OpenAI standard names
        OPENAI_API_KEY / OPENAI_BASE_URL → fails #1
      - System prompt that DESCRIBES the agent without including $0 contents → fails #2
      - `read -p`, `read -r -p`, or any interactive stdin prompt for the task → fails #3
      - Treating "$1" as a file path (cat "$1", source "$1") → fails #3
      - Single curl call outside a loop, or loop that bails after 1 iteration on
        first error → fails #4
      - GNU-only sed regex (\\b, \\s, alternation in BERE) → fails #7
      - Calling eval on null/empty content without guarding → fails #6
      - jq --argjson with unescaped strings (produces "invalid JSON" at runtime)
        → fails #6
      - Overwriting the prompt instead of appending (loses history) → fails #9
      - Only printing the reply, not eval-ing it → fails #8

    SCORING (be strict — runtime correctness matters):
      - If ANY of behaviors 1, 2, 5, 8 are missing or broken: cap score at 4.
        These four are the "skeleton" — without them the agent cannot loop at all.
      - Otherwise count the 9 behaviors that work and map: 9→10, 8→9, 7→8,
        6→6, 5→5, ≤4→3.
      - When in doubt about whether something will run at runtime, assume it
        WILL FAIL and mark the behavior missing. Optimism here is the bug.

    Output ONLY the JSON object below — no prose, no preamble, no chain-of-thought,
    no markdown fences. The very first character of your response must be '{'.

      {"behaviors_present": ["1","2",...], "behaviors_missing": ["..."],
       "runtime_risks": ["short note per likely-failure"],
       "score": <int 0-10>, "verdict": "equivalent"|"close"|"broken"}
""")


@dataclass
class SimpleScore:
    scores: list[int]          # per-sample 0..10
    verdicts: list[str]
    diffs: list[list[str]]
    samples: list[str]
    mean: float                # 0..1, mean(scores)/10
    length: int                # len(prompt)

    def as_dict(self):
        return {
            "scores": self.scores,
            "verdicts": self.verdicts,
            "mean": self.mean,
            "length": self.length,
        }


def strip_code_fence(text: str) -> str:
    """Extract the first ```bash/sh fenced block. Falls back to whole text."""
    text = text.strip()
    # Try fenced block anywhere in the response (DeepSeek/Claude often add prose)
    m = re.search(r"```(?:bash|sh)?\s*\n(.*?)\n```", text, re.DOTALL)
    if m:
        return m.group(1)
    return text


def generate(prompt: str, *, n=3, timeout=90, seed_base: int = 0) -> list[str]:
    return [
        strip_code_fence(chat(GEN_MODEL, [{"role": "user", "content": prompt}],
                              temperature=0, timeout=timeout, seed=seed_base + i))
        for i in range(n)
    ]


def judge(candidate: str) -> tuple[int, str, list[str]]:
    """Returns (score 0..10, verdict, differences)."""
    msg = (
        f"=== REFERENCE ===\n```bash\n{REAL_SHPROUT}\n```\n\n"
        f"=== CANDIDATE ===\n```bash\n{candidate}\n```\n"
    )
    raw = chat(JUDGE_MODEL, [
        {"role": "system", "content": JUDGE_SYS},
        {"role": "user", "content": msg},
    ], temperature=0, timeout=120)
    # Find the LAST balanced JSON object in the response (after any prose).
    d = None
    for m in re.finditer(r'\{', raw):
        depth = 0
        for i in range(m.start(), len(raw)):
            if raw[i] == '{': depth += 1
            elif raw[i] == '}':
                depth -= 1
                if depth == 0:
                    try:
                        cand = json.loads(raw[m.start():i+1])
                        if isinstance(cand, dict) and "score" in cand:
                            d = cand
                    except Exception:
                        pass
                    break
    if d is None:
        return 0, "parse-fail", [raw[:200]]
    missing = d.get("behaviors_missing", []) or d.get("differences", [])
    return int(d.get("score", 0)), d.get("verdict", "?"), missing


def score_prompt(prompt: str, *, n=3) -> SimpleScore:
    samples = generate(prompt, n=n)
    scores, verdicts, diffs = [], [], []
    for s in samples:
        sc, vd, df = judge(s)
        scores.append(sc); verdicts.append(vd); diffs.append(df)
    mean = sum(scores) / (len(scores) * 10)
    return SimpleScore(scores, verdicts, diffs, samples, mean, len(prompt))


if __name__ == "__main__":
    import sys
    prompt = sys.argv[1] if len(sys.argv) > 1 else (
        "Write a bash script: requires env vars OPENAI_API_KEY MODEL OPENAI_BASE_URL. "
        "Read your own source via $0. Take purpose as $1. Build a prompt of 'you:' + own "
        "source + 'purpose:' + $1. Loop 10 times: POST {model,messages:[{role:user,content:prompt}]} "
        "via curl to $OPENAI_BASE_URL/chat/completions with bearer $OPENAI_API_KEY, parse "
        "choices[0].message.content with jq, strip ``` fences, print '> '+reply, eval the reply "
        "capturing stdout, append reply+output to prompt."
    )
    s = score_prompt(prompt, n=3)
    print(json.dumps(s.as_dict(), indent=2))
    for i, (sc, vd, df) in enumerate(zip(s.scores, s.verdicts, s.diffs)):
        print(f"\n--- sample {i}: score={sc} verdict={vd} ---")
        for d in df:
            print(f"  - {d}")
