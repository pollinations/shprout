"""Hand-rolled prompt compression search with leaderboard-aware proposer.

Each iteration: show the proposer the top-K candidates (length, score, judge
notes, sample excerpt) and ask for a SHORTER prompt that draws on what's
working. Higher temperature + random parent sampling break the cycle that
single-parent rotation produced.
"""
from __future__ import annotations
import argparse, glob, json, os, random, sys, textwrap
from datetime import datetime

from eval_simple import chat, score_prompt

DIR = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(DIR, "candidates.jsonl")
TOP_K = 5  # how many leaderboard entries to show the proposer

DEFAULT_SEEDS = [
    "Write a bash script: requires env vars KEY MODEL API. Read your own source via $0. "
    "Take purpose as $1. Build a prompt of 'you:' + own source + 'purpose:' + $1. "
    "Loop 20 times: POST {model,messages:[{role:user,content:prompt}]} via curl to $API "
    "with bearer $KEY, parse choices[0].message.content with jq, strip ``` fences, "
    "print '> '+reply, eval the reply capturing stdout, append reply+output to prompt.",
    "self-reading bash agent: requires KEY MODEL API. cat $0 + $1 into prompt. "
    "loop 20: curl $API as openai chat, jq .choices[0].message.content, "
    "strip ``` fences, eval, append reply+stdout to prompt.",
]

PROPOSER_SYS = textwrap.dedent("""\
    You are compressing a natural-language prompt. The prompt's job is to make a
    capable LLM emit a tiny bash self-prompting agent (read $0+$1, loop 20×,
    curl OpenAI-compat endpoint with $KEY/$MODEL/$API, jq the reply, strip ```
    fences, eval, append reply+stdout to the prompt — like the original shprout).

    You will see a LEADERBOARD of the best prompts found so far, each with its
    length, score (0..1), and a snippet of what it generated. Study what the
    high-scoring SHORT prompts have in common; combine that with techniques from
    longer high-scoring prompts. Avoid wording from low-scoring prompts.

    Output ONE new prompt that:
      - Is SHORTER than the shortest currently scoring ≥ 0.8.
      - Preserves every behavior the high-scorers preserve.
      - Uses any compression trick: symbols, abbreviations, dropping articles.

    The first character of your reply must be the new prompt itself.
    No commentary, no quotes, no preamble, no markdown fences, no labels.
""")


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


def propose(rows: list[dict], proposer_model: str) -> str:
    """Ask the proposer for ONE new shorter prompt, given the leaderboard."""
    leaderboard = render_leaderboard(rows)
    # current shortest passing — what we need to beat
    passing = [r for r in rows if r["mean"] >= 0.8]
    target_len = min((r["length"] for r in passing), default=300) - 1
    msg = (
        f"{leaderboard}\n\n"
        f"Target: STRICTLY UNDER {target_len} characters, score ≥ 0.8.\n"
        f"Reply with ONLY the new prompt text."
    )
    out = chat(proposer_model, [
        {"role": "system", "content": PROPOSER_SYS},
        {"role": "user", "content": msg},
    ], temperature=1.0).strip()
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
            child = propose(rows, proposer_model)
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
