"""End-to-end: mini prompt → LLM (generator) → bash agent → run sandboxed
on a verifiable task. Tests the prompts we measured in the synthetic eval
against an actual workload to see if compression survived contact with reality.

Generators: claude-large + claude-opus-4.7 (tier-1 from the model sweep).
Runtime model: openai-fast (the model the *generated agent* uses to think).
"""
from __future__ import annotations
import os, subprocess, sys, tempfile, json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eval_simple import chat, strip_code_fence, POLLI_KEY

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SANDBOX = os.path.join(REPO, "sandbox.sh")

EXPECTED = "f017597f"
PURPOSE = (
    "Run a single bash command to print the first 8 hex chars of sha256 of the "
    "literal string shprout (no newline). Use shasum -a 256. Then say exit."
)

# pollinations is OpenAI-compatible — the agent uses these env vars
RUNTIME_MODEL = "claude"
POLLI_BASE = "https://gen.pollinations.ai/v1"

# Candidates use OpenAI-standard env var names (OPENAI_API_KEY, OPENAI_BASE_URL).
# This matches what shprout itself now uses and what LLMs default to writing.
MINI_PROMPTS = {
    "161B-openai-default": (
        "bash agent:cat $0+$1 to prompt.loop 20:curl OpenAI chat($OPENAI_API_KEY,$OPENAI_BASE_URL),"
        "jq .choices[0].message.content,strip```fences,eval,append"
    ),
}


def synthesize(prompt: str, gen_model: str, *, n: int = 3,
               temperature: float = 0.7) -> list[str]:
    return [
        strip_code_fence(chat(gen_model, [{"role": "user", "content": prompt}],
                              temperature=temperature)).strip()
        for _ in range(n)
    ]


def run_sandboxed(script: str, purpose: str, *, timeout: int = 90) -> tuple[int, str]:
    with tempfile.NamedTemporaryFile("w", suffix=".sh", delete=False) as f:
        f.write(script)
        path = f.name
    os.chmod(path, 0o755)
    env = {
        **os.environ,
        # OpenAI-standard env vars — matches new shprout contract.
        "OPENAI_API_KEY": POLLI_KEY,
        "MODEL": RUNTIME_MODEL,
        "OPENAI_BASE_URL": POLLI_BASE,
    }
    try:
        proc = subprocess.Popen(
            [SANDBOX, path, purpose],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        try:
            stdout, stderr = proc.communicate(timeout=timeout)
            rc = proc.returncode
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = proc.communicate()
            rc = -1
            stdout = (stdout or "") + "\n<timeout>"
        return rc, (stdout + "\n--STDERR--\n" + stderr)
    finally:
        os.unlink(path)


def test_one(name: str, prompt: str, gen_model: str, *, n: int = 3) -> dict:
    print(f"\n{'='*72}\n=== {name}  gen={gen_model}  ({len(prompt)}B prompt, n={n})\n{'='*72}")
    print(f"PROMPT: {prompt}\n")
    try:
        scripts = synthesize(prompt, gen_model, n=n)
    except Exception as e:
        print(f"  synth failed: {e}")
        return {"name": name, "gen": gen_model, "prompt_len": len(prompt),
                "samples": [], "any_pass": False, "error": str(e)}
    samples = []
    for i, script in enumerate(scripts, 1):
        rc, out = run_sandboxed(script, PURPOSE)
        found = EXPECTED in out
        tail = "\n".join(out.splitlines()[-8:])
        print(f"  sample {i}/{n}  script={len(script)}B  rc={rc}  found={found}")
        print(f"    tail: {tail.replace(chr(10), ' | ')[:200]}")
        samples.append({"len": len(script), "rc": rc, "found": found})
        if found: break
    any_pass = any(s["found"] for s in samples)
    print(f"  RESULT: {'✅ PASS' if any_pass else '❌ FAIL'}  "
          f"({sum(s['found'] for s in samples)}/{len(samples)} samples)")
    return {"name": name, "gen": gen_model, "prompt_len": len(prompt),
            "samples": samples, "any_pass": any_pass}


if __name__ == "__main__":
    GENS = ["claude-large", "claude-opus-4.7"]
    results = []
    for gen in GENS:
        for pname, prompt in MINI_PROMPTS.items():
            results.append(test_one(pname, prompt, gen))
    print("\n\n=== SUMMARY ===")
    # compact table
    print(f"\n{'prompt':<24} {'gen':<18} {'len':>5}  {'pass':>5}")
    for r in results:
        n_pass = sum(s["found"] for s in r["samples"])
        n_tot = len(r["samples"])
        print(f"{r['name']:<24} {r['gen']:<18} {r['prompt_len']:>5}  {n_pass}/{n_tot}")
    print()
    print(json.dumps(results, indent=2))
