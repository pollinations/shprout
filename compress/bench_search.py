"""Eval-gated compression search: find the shortest prompt that regenerates
a WORKING shprout — where "working" is decided by executed evidence
(gate.py tiers), not by an LLM judge reading the code.

Loop: leaderboard-aware proposer suggests a shorter prompt → generator LLM
decompresses it into bash (n samples) → each sample runs the gate cascade
(static → offline loop-test → sandboxed micro-bench) → prompt scored by its
best sample. A prompt "passes" when its best sample scores >= --bar on the
micro-bench (calibrate the bar with `python gate.py --reference`).

    python bench_search.py --budget 20 --n-samples 2
    python bench_search.py --seed-only          # just score the seeds
"""
from __future__ import annotations
import argparse, json, os, random, sys, textwrap
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eval_simple import strip_code_fence
from provider import chat, resolve
from gate import evaluate_script

DIR = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(DIR, "candidates-gated.jsonl")
TOP_K = 5


def gen_model() -> str:
    return os.environ.get("GEN_MODEL", resolve()["gen"])

# Best known performers from prior experiments (results.json + e2e_test.py),
# plus one verbose known-good anchor.
SEEDS = [
    # 161B — passed e2e sha256 in e2e_test.py
    "bash agent:cat $0+$1 to prompt.loop 20:curl OpenAI chat($OPENAI_API_KEY,$OPENAI_BASE_URL),"
    "jq .choices[0].message.content,strip```fences,eval,append",
    # 254B — 60% e2e pass rate in results.json
    "self-reading bash agent: cat $0+$1 into prompt. env: OPENAI_API_KEY MODEL OPENAI_BASE_URL. "
    "loop 10: curl $OPENAI_BASE_URL/chat/completions with bearer $OPENAI_API_KEY, "
    "jq .choices[0].message.content, strip ``` fences, eval, append reply+stdout to prompt.",
    # ~430B anchor — explicit spec, should pass everything
    "Write a bash script: self-reading LLM agent. Env vars OPENAI_API_KEY, MODEL, OPENAI_BASE_URL "
    "(fail fast if unset). Build prompt = own source ($(<$0)) + task ($1). Loop 10 times: POST "
    "{model:$MODEL,messages:[{role:user,content:prompt}]} to $OPENAI_BASE_URL/chat/completions "
    "with bearer $OPENAI_API_KEY via curl, extract .choices[0].message.content with jq -r, "
    "if reply contains ``` keep only fenced lines, break if reply empty or 'exit', print reply, "
    "eval it capturing stdout+stderr, append reply and output to prompt.",
]

PROPOSER_SYS = textwrap.dedent("""\
    You compress a natural-language prompt whose job is to make a capable LLM
    write a small bash script — a self-prompting agent. The script is judged by
    EXECUTION, not by style. It must actually:

      1. read env vars OPENAI_API_KEY, MODEL, OPENAI_BASE_URL (exactly these names)
      2. include its own source ($0) plus the task ($1) in the prompt
      3. loop (≤20): POST OpenAI chat shape to $OPENAI_BASE_URL/chat/completions,
         bearer $OPENAI_API_KEY; extract .choices[0].message.content with jq
      4. strip ``` fences when present, eval the reply, and STOP on empty reply
         or the literal reply "exit"
      5. append reply + stdout to the prompt (cumulative history)

    The generated script is run against a scripted fake API (checks 2-5 by
    tracing real requests) and then on a 6-task sandbox micro-bench with a real
    model. The LEADERBOARD below shows candidates with their byte length, bench
    score (0-1), and executed-failure diagnostics (t1:* = loop mechanics,
    t2:<task> = failed bench task, missing:* = static check).

    Your goal: propose ONE new prompt that is SHORTER than the shortest passing
    candidate while still passing (score >= the bar shown). Use any compression
    trick — abbreviations, symbols, dropped articles — but the five behaviors
    above must still come through unambiguously. The most common death: the
    model writes a script that hardcodes a URL, drops the exit-break, or
    forgets to append history. Keep those explicit even when compressing.

    Reply with ONLY the new prompt text. First character = first character of
    the prompt. No quotes, no fences, no commentary.
""")


def synthesize(prompt: str, *, n: int = 2, seed_base: int = 0) -> list[str]:
    return [
        strip_code_fence(chat(gen_model(), [{"role": "user", "content": prompt}],
                              temperature=0, seed=seed_base + i)).strip()
        for i in range(n)
    ]


def score_prompt(prompt: str, *, n: int = 2, seed_base: int = 0) -> dict:
    scripts = synthesize(prompt, n=n, seed_base=seed_base)
    evals = [evaluate_script(s) for s in scripts]
    best = max(evals, key=lambda e: (e["score"], e["tier1"], e["tier0"]))
    return {
        "prompt": prompt, "length": len(prompt),
        "best": best["score"], "mean": sum(e["score"] for e in evals) / len(evals),
        "tiers": [f"t0={int(e['tier0'])} t1={int(e['tier1'])} t2={e['score']:.2f}"
                  for e in evals],
        "fails": sorted({f for e in evals for f in e["fails"]}),
        "script_bytes": [e["bytes"] for e in evals],
    }


def render_leaderboard(rows: list[dict], bar: float, k: int = TOP_K) -> str:
    ranked = sorted(rows, key=lambda r: (-(r["best"] >= bar), -r["best"], r["length"]))[:k]
    lines = [f"LEADERBOARD (bar={bar:.2f}; passing-then-shortest first):"]
    for i, r in enumerate(ranked, 1):
        status = "PASS" if r["best"] >= bar else "fail"
        fails = "; ".join(r["fails"][:4]) or "-"
        lines.append(f"  #{i} {r['length']:>4}B best={r['best']:.2f} {status}  fails: {fails}")
        lines.append(f"     prompt: {r['prompt']}")
    return "\n".join(lines)


def propose(rows: list[dict], bar: float, model: str, *, seed: int) -> str:
    passing = [r for r in rows if r["best"] >= bar]
    target = min((r["length"] for r in passing), default=300) - 1
    msg = (
        f"# iteration {seed}\n\n{render_leaderboard(rows, bar)}\n\n"
        f"Shortest passing so far: {target + 1}B. Beat it: stay under {target}B "
        f"AND keep score >= {bar:.2f}.\nReply with ONLY the new prompt."
    )
    out = chat(model, [{"role": "system", "content": PROPOSER_SYS},
                       {"role": "user", "content": msg}],
               temperature=0.7, seed=seed).strip()
    if out.startswith("```"):
        out = out.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    if out[:1] in "\"'" and out[-1:] == out[:1]:
        out = out[1:-1]
    return out


def log_rec(rec: dict, path: str):
    with open(path, "a") as f:
        f.write(json.dumps(rec) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=int, default=15)
    ap.add_argument("--n-samples", type=int, default=2)
    ap.add_argument("--bar", type=float, default=float(os.environ.get("PASS_BAR", "0.83")))
    ap.add_argument("--proposer", default=None,
                    help="proposer model (default: provider's)")
    ap.add_argument("--seed-only", action="store_true")
    ap.add_argument("--log", default=LOG)
    a = ap.parse_args()
    if a.proposer is None:
        a.proposer = resolve()["proposer"]
    print(f"provider={resolve()['name']} gen={gen_model()} proposer={a.proposer}")

    rows: list[dict] = []
    for s in SEEDS:
        r = score_prompt(s, n=a.n_samples)
        r.update(iter=0, ts=datetime.now().isoformat(timespec="seconds"))
        rows.append(r); log_rec(r, a.log)
        print(f"seed {r['length']:>4}B  best={r['best']:.2f}  fails={r['fails'][:3]}")
    if a.seed_only:
        return

    seen = {r["prompt"] for r in rows}
    for it in range(1, a.budget + 1):
        try:
            child = propose(rows, a.bar, a.proposer, seed=random.randint(1, 10**9))
        except Exception as e:
            print(f"iter {it}: proposer failed: {e}"); continue
        if not child or child in seen:
            print(f"iter {it}: dup/empty"); continue
        seen.add(child)
        try:
            r = score_prompt(child, n=a.n_samples)
        except Exception as e:
            print(f"iter {it}: scoring failed: {e}"); continue
        r.update(iter=it, ts=datetime.now().isoformat(timespec="seconds"))
        rows.append(r); log_rec(r, a.log)
        best_pass = min((x["length"] for x in rows if x["best"] >= a.bar), default=None)
        star = " ★" if r["best"] >= a.bar and r["length"] == best_pass else ""
        print(f"iter {it:>3}: {r['length']:>4}B  best={r['best']:.2f}  "
              f"fails={r['fails'][:3]}{star}")

    passing = [r for r in rows if r["best"] >= a.bar]
    if passing:
        champ = min(passing, key=lambda r: r["length"])
        print(f"\nshortest passing: {champ['length']}B  best={champ['best']:.2f}")
        print(champ["prompt"])


if __name__ == "__main__":
    main()
