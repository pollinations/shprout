"""Hand-rolled prompt compression search with leaderboard-aware proposer.

Each iteration: show the proposer the top-K candidates (length, score, judge
notes, sample excerpt) and ask for a SHORTER prompt that draws on what's
working. Higher temperature + random parent sampling break the cycle that
single-parent rotation produced.
"""
from __future__ import annotations
import argparse, glob, json, os, random, sys, textwrap
from datetime import datetime

from eval_simple import chat, score_prompt, REAL_SHPROUT, JUDGE_SYS

DIR = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(DIR, "candidates.jsonl")
TOP_K = 5  # how many leaderboard entries to show the proposer

DEFAULT_SEEDS = [
    "Write a bash script: self-reading LLM agent. Requires env vars OPENAI_API_KEY, "
    "MODEL, OPENAI_BASE_URL. Read $0 + $1 into a prompt. Loop 10: POST to "
    "$OPENAI_BASE_URL/chat/completions with bearer $OPENAI_API_KEY, OpenAI chat shape "
    "({model:$MODEL,messages:[{role:user,content:prompt}]}), jq .choices[0].message.content, "
    "strip ``` fences, eval the reply capturing stdout, append reply+output to prompt.",
    "self-reading bash agent: cat $0+$1 into prompt. env: OPENAI_API_KEY MODEL "
    "OPENAI_BASE_URL. loop 10: curl $OPENAI_BASE_URL/chat/completions, "
    "jq .choices[0].message.content, strip ``` fences, eval, "
    "append reply+stdout to prompt.",
]

PROPOSER_SYS = textwrap.dedent("""\
    You are compressing a natural-language prompt. The TARGET is shown below
    verbatim. Your prompt's job: make a capable LLM emit BASH THAT IS BYTE-
    IDENTICAL to the target — except for whitespace and internal variable names
    (e.g. $p ↔ $prompt is fine, $OPENAI_API_KEY ↔ $KEY is NOT).

    Score = 1 - levenshtein(normalize(gen), normalize(target)) / len.
    normalize() strips comments, collapses whitespace, and renames internal
    vars to a single placeholder. Env var names ($OPENAI_API_KEY, $MODEL,
    $OPENAI_BASE_URL), command names (curl, jq, eval, sed, jq -Rs, etc.),
    string literals, and the API path /chat/completions are NOT normalized
    away — they must be exact.

    To score well your prompt should make the gen reproduce:
      - the same control flow (`for ((i=10;i--;)); do ... done`)
      - the same jq invocations and shapes
      - the same curl flags (-sSd @-, headers)
      - the same sed unfence trick
      - the same `[[ -z $c || $c == exit ]] && break` early exit
      - the same `eval "$c" | tee /dev/stderr` and prompt-append pattern

    LEADERBOARD shows the top prompts so far with their reconstruction score
    (0..1) and a snippet of what the gen produced. Higher = closer to target.

    HARD CAP: your prompt MUST be under 90% of the target byte length.
    Anything longer is rejected and wastes the iteration. The target is shown
    above — count its bytes and cap your prompt at 0.9 × that.

    Output ONE new prompt that:
      - Is SHORTER than the current best scoring ≥ 0.85, or
      - Scores HIGHER than the current best at any length.
      - Uses any compression trick: symbols, abbreviations, dropping articles.

    The first character of your reply must be the new prompt itself.
    No commentary, no quotes, no preamble, no markdown fences, no labels.
""") + (
    "\n=== TARGET BASH (your prompt must elicit this verbatim, mod whitespace + internal var names) ===\n"
    "```bash\n" + REAL_SHPROUT + "```\n"
    "=== END TARGET ===\n"
)


def load_pareto_seeds(min_score: float = 0.7) -> list[dict]:
    """Load Pareto-frontier rows (length, prompt, mean) from snapshot jsonls."""
    rows = []
    for f in glob.glob(os.path.join(DIR, "candidates-*.jsonl")):
        for ln in open(f):
            try: rows.append(json.loads(ln))
            except Exception: pass
    front = []
    for r in rows:
        if r["mean"] < min_score: continue
        dom = False
        for q in rows:
            if q is r: continue
            if q["length"] <= r["length"] and q["mean"] >= r["mean"] and (
                q["length"] < r["length"] or q["mean"] > r["mean"]
            ):
                dom = True; break
        if not dom:
            front.append(r)
    # dedup on prompt
    seen, out = set(), []
    for r in sorted(front, key=lambda r: r["length"]):
        if r["prompt"] in seen: continue
        seen.add(r["prompt"]); out.append(r)
    return out


def render_leaderboard(rows: list[dict], k: int = TOP_K) -> str:
    """Pick the top-k by score-then-length-asc; render compactly for the proposer."""
    ranked = sorted(rows, key=lambda r: (-r["mean"], r["length"]))[:k]
    lines = ["LEADERBOARD (top by score, then shortest):"]
    for i, r in enumerate(ranked, 1):
        sample_first = r.get("sample", "").split("\n", 1)[0][:80]
        missing = r.get("missing", [])
        miss_str = (" missing: " + "; ".join(m[:60] for m in missing[:2])) if missing else ""
        lines.append(f"  #{i}  {r['length']:>4}B  score={r['mean']:.2f}{miss_str}")
        lines.append(f"      prompt: {r['prompt']}")
        lines.append(f"      generated (first line): {sample_first}")
    return "\n".join(lines)


def propose(rows: list[dict], proposer_model: str, *,
            seed: int | None = None,
            rejection_feedback: list[str] | None = None) -> str:
    """Ask the proposer for ONE new shorter prompt, given the leaderboard."""
    leaderboard = render_leaderboard(rows)
    best_score = max((r["mean"] for r in rows), default=0)
    best_at_score = min(
        (r for r in rows if r["mean"] >= best_score - 0.02),
        key=lambda r: r["length"], default=None,
    )
    target_len = (best_at_score["length"] - 1) if best_at_score else 300
    nonce = seed if seed is not None else random.randint(1, 10**9)
    rej_block = ""
    if rejection_feedback:
        rej_block = "\nYour previous attempts this iter were rejected:\n" + "\n".join(
            f"  - {r}" for r in rejection_feedback
        ) + "\nSTOP pasting the target verbatim. Describe it, don't quote it.\n"
    msg = (
        f"# iteration seed {nonce}\n\n"
        f"{leaderboard}\n\n"
        f"Goal: beat reconstruction score {best_score:.2f} OR match it under "
        f"{target_len} characters.\n"
        f"{rej_block}"
        f"Reply with ONLY the new prompt text."
    )
    # Bump temperature if we're retrying — break out of deterministic re-emission
    temp = 0.0 if not rejection_feedback else min(0.3 + 0.2 * len(rejection_feedback), 0.9)
    out = chat(proposer_model, [
        {"role": "system", "content": PROPOSER_SYS},
        {"role": "user", "content": msg},
    ], temperature=temp, seed=seed).strip()
    if out.startswith("```"):
        out = out.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    if (out.startswith('"') and out.endswith('"')) or (out.startswith("'") and out.endswith("'")):
        out = out[1:-1]
    return out


def log_candidate(rec: dict):
    with open(LOG, "a") as f:
        f.write(json.dumps(rec) + "\n")


def search(budget: int = 20, n_samples: int = 2,
           proposer_model: str = "claude-large",
           seed_from_snapshots: bool = False,
           log_path: str = LOG):
    open(log_path, "w").close()
    rows: list[dict] = []

    if seed_from_snapshots:
        pareto = load_pareto_seeds()
        if pareto:
            print(f"Seeding from {len(pareto)} Pareto-frontier prompts:")
            for r in pareto:
                # reuse cached scores — don't re-judge known-good prompts
                rec = {
                    "iter": 0, "ts": datetime.now().isoformat(timespec="seconds"),
                    "prompt": r["prompt"], "length": r["length"],
                    "scores": r.get("scores", [int(r["mean"]*10)]*2),
                    "mean": r["mean"],
                    "verdicts": r.get("verdicts", []),
                    "sample": r.get("sample", "")[:1500],
                    "missing": r.get("missing", []),
                }
                with open(log_path, "a") as f: f.write(json.dumps(rec) + "\n")
                rows.append(rec)
                print(f"  seed: {r['length']:>4}B  score={r['mean']:.2f}  (cached)")
        else:
            print("No snapshot seeds found — falling back to DEFAULT_SEEDS")
            seed_from_snapshots = False

    if not seed_from_snapshots:
        for seed in DEFAULT_SEEDS:
            s = score_prompt(seed, n=n_samples)
            rec = {
                "iter": 0, "ts": datetime.now().isoformat(timespec="seconds"),
                "prompt": seed, "length": len(seed),
                "scores": s.scores, "mean": s.mean,
                "verdicts": s.verdicts, "sample": s.samples[0][:1500],
                "missing": s.diffs[0] if s.diffs else [],
            }
            with open(log_path, "a") as f: f.write(json.dumps(rec) + "\n")
            rows.append(rec)
            print(f"seed: {len(seed):>4}B  score={s.mean:.2f}")

    seen = {r["prompt"] for r in rows}
    best_short = min((r["length"] for r in rows if r["mean"] >= 0.8), default=None)
    print(f"\nProposer: {proposer_model}  |  starting best: {best_short}B\n")

    for it in range(1, budget + 1):
        try:
            child = propose(rows, proposer_model, seed=it)
        except Exception as e:
            print(f"iter {it}: proposer failed: {e}")
            continue
        if not child or child in seen:
            print(f"iter {it}: dup/empty, retrying with re-shuffle")
            continue
        seen.add(child)

        try:
            s = score_prompt(child, n=n_samples)
        except Exception as e:
            print(f"iter {it}: scoring failed: {e}")
            continue

        rec = {
            "iter": it, "ts": datetime.now().isoformat(timespec="seconds"),
            "prompt": child, "length": len(child),
            "scores": s.scores, "mean": s.mean,
            "verdicts": s.verdicts, "sample": s.samples[0][:1500],
            "missing": s.diffs[0] if s.diffs else [],
        }
        with open(log_path, "a") as f: f.write(json.dumps(rec) + "\n")
        rows.append(rec)

        marker = ""
        if s.mean >= 0.8 and (best_short is None or len(child) < best_short):
            marker = "  ★ NEW BEST"
            best_short = len(child)
        elif s.mean >= 0.8:
            marker = "  (passing)"
        print(f"iter {it:>3}: {len(child):>4}B  score={s.mean:.2f}  scores={s.scores}{marker}")

    print(f"\nlogged {len(rows)} candidates to {LOG}")
    if best_short:
        print(f"shortest passing: {best_short}B")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--budget", type=int, default=15)
    p.add_argument("--proposer", default="claude-large",
                   help="model used for the leaderboard-aware proposer")
    p.add_argument("--seed-from-snapshots", action="store_true",
                   help="use Pareto frontier from candidates-*.jsonl as seeds")
    p.add_argument("--log", default=LOG, help="output jsonl path")
    p.add_argument("--n-samples", type=int, default=2)
    args = p.parse_args()
    search(budget=args.budget, n_samples=args.n_samples,
           proposer_model=args.proposer,
           seed_from_snapshots=args.seed_from_snapshots,
           log_path=args.log)
