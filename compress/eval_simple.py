"""Simpler eval: generate bash from candidate prompt, ask Claude if it's
functionally equivalent to the real shprout. Average over n samples.

No regex, no sandbox, no execution. Just two scripts and one judge call.
"""
from __future__ import annotations
import json, os, re, textwrap
from dataclasses import dataclass

import litellm

POLLI = "https://gen.pollinations.ai/v1"
_token_path = os.path.expanduser("~/.pollinations/shprout.json")
POLLI_KEY = json.load(open(_token_path))["apiKey"] if os.path.exists(_token_path) else "x"
GEN_MODEL = "openai/deepseek-pro"
JUDGE_MODEL = "openai/claude-large"

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHPROUT_PATH = os.path.join(REPO_ROOT, "shprout")
with open(SHPROUT_PATH) as f:
    REAL_SHPROUT = f.read()


JUDGE_SYS = textwrap.dedent("""\
    You decide whether the CANDIDATE bash script is functionally equivalent to the
    REFERENCE. Both are LLM-driven self-prompting agents.

    Equivalence is about OBSERVABLE BEHAVIOR, not implementation choices.

    The candidate is EQUIVALENT (score 8-10) if all of these hold:
      1. It refuses to start without KEY, MODEL, API env vars (any mechanism).
      2. It includes its own source code in the prompt sent to the LLM (via $0,
         BASH_SOURCE, cat "$0", or equivalent).
      3. It accepts a purpose string from $1 (or $@, "$@", etc.).
      4. It loops some bounded number of times (10, 20, 100 — bound doesn't matter).
      5. It POSTs to $API with the OpenAI chat-completions JSON shape, using $KEY
         as bearer auth.
      6. It extracts the assistant message content from the JSON response.
      7. It strips ``` fences from the reply (any sed/awk/regex form is fine).
      8. It evaluates the resulting bash (eval, bash -c, source — any of these).
      9. It appends the reply AND the resulting stdout to the prompt for the next
         iteration (cumulative history, not overwriting).

    Things that DO NOT break equivalence:
      - Different variable names, different loop syntax, different bound (5/20/100)
      - set -euo pipefail or any extra safety checks
      - Different unfence regex, as long as fenced content is extracted
      - Logging/printf differences, leading/trailing newlines
      - Error messages on missing env vars vs silent ':?' parameter expansion
      - Using 'bash -c' vs 'eval' (both run the LLM-supplied bash)
      - Inline curl body vs piped via @-

    Things that DO break equivalence:
      - Missing one of the 9 behaviors above
      - Overwriting the prompt instead of appending (loses history)
      - Not actually running the LLM-supplied bash (e.g. only printing it)
      - Not stripping fences (so eval gets ``` literals)

    Score on the count of the 9 behaviors that work, mapped to 0-10:
      9/9 → 10, 8/9 → 9, 7/9 → 8, 6/9 → 7, 5/9 → 5, 4/9 → 4, ≤3/9 → 0-3.

    Output ONLY the JSON object below — no prose, no preamble, no chain-of-thought,
    no markdown fences. The very first character of your response must be '{'.

      {"behaviors_present": ["1","2",...], "behaviors_missing": ["..."],
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


def generate(prompt: str, *, n=3, temperature=0.7, timeout=90) -> list[str]:
    out = []
    for _ in range(n):
        r = litellm.completion(
            model=GEN_MODEL, api_base=POLLI, api_key=POLLI_KEY,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature, timeout=timeout,
        )
        out.append(strip_code_fence(r.choices[0].message.content or ""))
    return out


def judge(candidate: str) -> tuple[int, str, list[str]]:
    """Returns (score 0..10, verdict, differences)."""
    msg = (
        f"=== REFERENCE ===\n```bash\n{REAL_SHPROUT}\n```\n\n"
        f"=== CANDIDATE ===\n```bash\n{candidate}\n```\n"
    )
    r = litellm.completion(
        model=JUDGE_MODEL, api_base=POLLI, api_key=POLLI_KEY,
        messages=[
            {"role": "system", "content": JUDGE_SYS},
            {"role": "user", "content": msg},
        ],
        temperature=0, timeout=120,
    )
    raw = r.choices[0].message.content or ""
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
        "Write a bash script: requires env vars KEY MODEL API. Read your own source via $0. "
        "Take purpose as $1. Build a prompt of 'you:' + own source + 'purpose:' + $1. "
        "Loop 20 times: POST {model,messages:[{role:user,content:prompt}]} via curl to $API "
        "with bearer $KEY, parse choices[0].message.content with jq, strip ``` fences, "
        "print '> '+reply, eval the reply capturing stdout, append reply+output to prompt."
    )
    s = score_prompt(prompt, n=3)
    print(json.dumps(s.as_dict(), indent=2))
    for i, (sc, vd, df) in enumerate(zip(s.scores, s.verdicts, s.diffs)):
        print(f"\n--- sample {i}: score={sc} verdict={vd} ---")
        for d in df:
            print(f"  - {d}")
