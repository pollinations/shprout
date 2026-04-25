"""Evaluate a generated bash script against the shprout rubric.

Three tiers (cheapest first):
  1. regex gate     — structural features in the static script
  2. trace gate     — run script under sandbox against fake_api, capture trace
  3. judge          — Claude grades the trace against a behavioral rubric

The fake_api is a stateful local server that returns scripted replies and
logs every (request, response) pair, so the judge can verify history
accumulation and fence handling from the actual run, not from static analysis.
"""
from __future__ import annotations
import json, os, re, socket, subprocess, tempfile, textwrap, threading, time
from dataclasses import dataclass
from http.server import HTTPServer

import litellm

from fake_api import make_handler

POLLI = "https://gen.pollinations.ai/v1"
_token_path = os.path.expanduser("~/.pollinations/shprout.json")
POLLI_KEY = json.load(open(_token_path))["apiKey"] if os.path.exists(_token_path) else "x"
GEN_MODEL = "openai/openai-fast"
JUDGE_MODEL = "openai/claude"

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SANDBOX_SH = os.path.join(REPO_ROOT, "sandbox.sh")


RUBRIC = textwrap.dedent("""\
    The script must be functionally equivalent to shprout — a tiny self-prompting bash LLM agent.
    Score each criterion as a boolean:
    a. Requires KEY, MODEL, API env vars (refuses to start without them).
    b. Reads its own source file into the prompt sent to the LLM.
    c. Takes a "purpose" string as $1.
    d. Loops a bounded number of times (e.g. for/while with a counter).
    e. Sends the conversation to an OpenAI-compatible /chat/completions endpoint via curl.
    f. Extracts the assistant message content from the JSON response (e.g. via jq).
    g. Strips markdown code fences if present.
    h. Evals the resulting bash.
    i. Appends the command + its output back to the prompt for the next turn.
""")


@dataclass
class Score:
    regex_hits: int
    judge_hits: int
    judge_notes: str
    trace_turns: int           # how many turns the fake_api saw
    exit_code: int | None
    total: float               # composite, 0..1
    sample: str
    trace: list                # [{turn, request, response}, ...]
    run_log: str               # captured stdout/stderr from the script run

    def as_dict(self):
        return {
            "regex_hits": self.regex_hits,
            "judge_hits": self.judge_hits,
            "trace_turns": self.trace_turns,
            "exit_code": self.exit_code,
            "total": self.total,
        }


# ---------- regex gate ----------

def regex_gate(code: str) -> int:
    checks = [
        re.search(r'\$\{?KEY[:\}]', code) and re.search(r'\$\{?MODEL[:\}]', code)
            and re.search(r'\$\{?API[:\}]', code),                 # a
        re.search(r'\$0|BASH_SOURCE', code),                       # b
        re.search(r'\$\{?1[:\}]?|\$@', code),                      # c
        re.search(r'\bfor\b.*;.*;|\bwhile\b', code),               # d
        re.search(r'curl\b', code),                                # e
        re.search(r'\bjq\b|message.*content|\.content', code),     # f
        re.search(r"```|sed.*```|fence", code, re.I),              # g
        re.search(r'\beval\b|`\$', code),                          # h
        re.search(r'p\+=|messages\+=|\+=.*\\n', code),             # i
    ]
    return sum(bool(c) for c in checks)


def strip_code_fence(text: str) -> str:
    text = text.strip()
    m = re.match(r"^```(?:bash|sh)?\s*\n(.*?)\n```\s*$", text, re.DOTALL)
    return m.group(1) if m else text


# ---------- generation ----------

def generate(prompt: str, *, model=GEN_MODEL, temperature=0.7, n=1) -> list[str]:
    out = []
    for _ in range(n):
        r = litellm.completion(
            model=model, api_base=POLLI, api_key=POLLI_KEY,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
        )
        out.append(strip_code_fence(r.choices[0].message.content or ""))
    return out


# ---------- trace gate (fake_api + sandbox) ----------

def _free_port() -> int:
    s = socket.socket(); s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]; s.close()
    return p


def trace_gate(code: str, *, timeout=10) -> tuple[list, int | None, str]:
    """Run the script under sandbox-exec, pointed at a stateful fake API.

    Returns (trace, exit_code, run_log).
    """
    port = _free_port()
    workdir = tempfile.mkdtemp(prefix="shprout-eval-")
    trace_path = os.path.join(workdir, "trace.jsonl")
    script_path = os.path.join(workdir, "candidate.sh")
    with open(script_path, "w") as f:
        f.write(code)
    os.chmod(script_path, 0o755)

    # spin fake_api in-process
    open(trace_path, "w").close()
    srv = HTTPServer(("127.0.0.1", port), make_handler(trace_path))
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()

    env = {
        **os.environ,
        "KEY": "fake-key",
        "MODEL": "fake",
        "API": f"http://127.0.0.1:{port}/chat/completions",
        "WORK": workdir,
    }
    exit_code: int | None = None
    log = ""
    try:
        r = subprocess.run(
            [SANDBOX_SH, "bash", script_path, "echo hello world; exit"],
            capture_output=True, text=True, timeout=timeout, env=env,
        )
        exit_code = r.returncode
        log = (r.stdout + r.stderr)[-2000:]
    except subprocess.TimeoutExpired as e:
        log = f"timeout after {timeout}s\n{(e.stdout or b'')[-1000:].decode(errors='ignore')}"
    finally:
        srv.shutdown()

    trace = []
    if os.path.exists(trace_path):
        with open(trace_path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        trace.append(json.loads(line))
                    except Exception:
                        pass
    return trace, exit_code, log


# ---------- judge over the trace ----------

def _trace_summary(trace: list) -> str:
    """Render trace compactly for the judge: per-turn user-message + reply."""
    lines = []
    for entry in trace:
        i = entry.get("turn")
        msgs = entry.get("request", {}).get("messages", [])
        user_content = ""
        for m in msgs:
            if m.get("role") == "user":
                user_content = m.get("content", "")
                break
        reply = entry.get("response", {}).get("choices", [{}])[0].get("message", {}).get("content", "")
        # truncate big payloads
        if len(user_content) > 2000:
            user_content = user_content[:1000] + f"\n...[{len(user_content)-2000} chars omitted]...\n" + user_content[-1000:]
        lines.append(f"--- TURN {i} ---")
        lines.append(f"REQUEST.user.content:\n{user_content}")
        lines.append(f"RESPONSE.assistant.content:\n{reply}")
    return "\n".join(lines)


def judge_trace(code: str, trace: list, run_log: str, *, model=JUDGE_MODEL) -> tuple[int, str]:
    """LLM-judge: score 9-point rubric using the actual run trace as evidence."""
    if not trace:
        return 0, "no trace (script never called the API)"

    summary = _trace_summary(trace)
    msg = (
        f"{RUBRIC}\n\n"
        "You will see (1) the candidate bash script, (2) the trace of an actual run "
        "where the script was sandboxed against a fake OpenAI-compatible API, and "
        "(3) the captured stdout/stderr from the run. Use the trace as evidence — "
        "for example, criterion (i) 'appends command + output to next prompt' is true "
        "iff TURN N+1's request.user.content contains TURN N's response content AND "
        "the stdout from evaluating it. Criterion (g) 'strips fences' is true iff the "
        "script correctly executed TURN 0's reply (which was wrapped in ```bash fences).\n\n"
        "Reply with a JSON object only, no prose:\n"
        '{"a": true|false, "b": ..., "c": ..., "d": ..., "e": ..., "f": ..., '
        '"g": ..., "h": ..., "i": ..., "notes": "<one short sentence per missed criterion>"}\n\n'
        f"=== SCRIPT ===\n```bash\n{code}\n```\n\n"
        f"=== RUN TRACE ===\n{summary}\n\n"
        f"=== STDOUT/STDERR ===\n{run_log[-1500:]}\n"
    )
    r = litellm.completion(
        model=model, api_base=POLLI, api_key=POLLI_KEY,
        messages=[{"role": "user", "content": msg}],
        temperature=0,
    )
    raw = r.choices[0].message.content or ""
    m = re.search(r'\{.*\}', raw, re.DOTALL)
    if not m:
        return 0, f"parse-fail: {raw[:200]}"
    try:
        d = json.loads(m.group(0))
    except Exception:
        return 0, f"parse-fail: {raw[:200]}"
    hits = sum(bool(d.get(k)) for k in "abcdefghi")
    return hits, d.get("notes", "")


# ---------- composite ----------

def score_prompt(prompt: str, *, n=2, run_trace=True) -> Score:
    samples = generate(prompt, n=n)
    best = max(samples, key=regex_gate)
    rg = regex_gate(best)
    if rg < 4 or not run_trace:
        return Score(rg, 0, "skipped (regex<4 or trace off)", 0, None,
                     rg / 9 * 0.3, best, [], "")
    trace, ec, log = trace_gate(best)
    jh, notes = judge_trace(best, trace, log)
    # composite: regex 20%, judge 60%, "actually ran ≥1 turn" 20%
    ran = 1.0 if len(trace) >= 1 else 0.0
    total = (rg / 9) * 0.2 + (jh / 9) * 0.6 + ran * 0.2
    return Score(rg, jh, notes, len(trace), ec, total, best, trace, log)


if __name__ == "__main__":
    import sys
    prompt = sys.argv[1] if len(sys.argv) > 1 else (
        "Write a bash script: requires env vars KEY MODEL API. Read your own source via $0. "
        "Take purpose as $1. Build a prompt of 'you:' + own source + 'purpose:' + $1. "
        "Loop 20 times: POST {model,messages:[{role:user,content:prompt}]} via curl to $API "
        "with bearer $KEY, parse choices[0].message.content with jq, strip ``` fences, "
        "print '> '+reply, eval the reply capturing stdout, append reply+output to prompt."
    )
    s = score_prompt(prompt, n=2, run_trace=True)
    print(json.dumps(s.as_dict(), indent=2))
    print("\n--- generated sample ---\n")
    print(s.sample)
    print("\n--- judge notes ---\n", s.judge_notes)
    print(f"\n--- trace: {len(s.trace)} turns, exit={s.exit_code} ---")
    for e in s.trace:
        reply = e["response"]["choices"][0]["message"]["content"]
        print(f"  T{e['turn']}: reply={reply[:60]!r}")
    if s.run_log:
        print(f"\n--- run_log (tail) ---\n{s.run_log[-500:]}")
