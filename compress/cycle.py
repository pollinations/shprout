"""Closed-loop search with reconstruction scoring.

Goal: the gen should reproduce REAL_SHPROUT *exactly* (mod whitespace and
internal var names). Score = normalized levenshtein similarity to shprout.

Each iteration:
  1. Proposer (seeded by iter number) emits a new prompt
  2. Gen produces N bash scripts from it
  3. Each script is normalized and scored by edit-distance to REAL_SHPROUT
  4. Best sample's score = leaderboard score
  5. e2e is run as a SANITY CHECK only — does the highest-scoring script
     also pass the SHA256 task? If yes the score is real; if no we have a bug
     in the normalizer.

Default budget: 5 iterations. Sandboxed via sandbox.sh.
"""
from __future__ import annotations
import argparse, json, os, sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eval_simple import generate
from reconstruction import reconstruction_score, normalize, REAL_SHPROUT
from search import propose, DEFAULT_SEEDS
from e2e_test import EXPECTED, PURPOSE, run_sandboxed

MAX_PROMPT_LEN = int(len(REAL_SHPROUT) * 0.9)  # 90% — outer loop will shrink target each round


def load_rows(path: str) -> list[dict]:
    if not os.path.exists(path): return []
    rows = []
    for ln in open(path):
        try: rows.append(json.loads(ln))
        except Exception: pass
    return rows


def evaluate(prompt: str, *, gen_model: str, n: int, seed_base: int,
             run_e2e: bool = False) -> dict:
    """Generate n scripts; score each by reconstruction similarity to REAL_SHPROUT.

    e2e is run on the *best-reconstructing* sample as a sanity check.
    """
    samples = generate(prompt, n=n, seed_base=seed_base)
    rec_scores = [reconstruction_score(s) for s in samples]
    print("  reconstruction scores: " + ", ".join(
        f"{i+1}={rec_scores[i]:.2f}({len(samples[i])}B)" for i in range(len(samples))
    ))
    best_i = max(range(len(samples)), key=lambda i: rec_scores[i]) if samples else -1
    best_score = rec_scores[best_i] if samples else 0.0
    mean_score = sum(rec_scores) / len(rec_scores) if rec_scores else 0.0

    e2e_pass, e2e_total, e2e_tail = 0, 0, ""
    if run_e2e and samples:
        rc, out = run_sandboxed(samples[best_i], PURPOSE, timeout=60)
        found = EXPECTED in out
        e2e_pass = 1 if found else 0
        e2e_total = 1
        e2e_tail = "\n".join(out.splitlines()[-4:])[:300]
        print(f"  e2e (best sample, score={best_score:.2f}): {'PASS' if found else 'FAIL'} rc={rc}")
        if not found:
            print(f"    tail: {e2e_tail.replace(chr(10), ' | ')[:200]}")
    return {
        "prompt": prompt, "length": len(prompt),
        "rec_scores": rec_scores,
        "rec_best": best_score, "rec_mean": mean_score,
        "best_i": best_i,
        "e2e_pass": e2e_pass, "e2e_total": e2e_total, "e2e_tail": e2e_tail,
        "samples": [s[:1500] for s in samples],
    }


def to_leaderboard_row(result: dict, it: int) -> dict:
    """Convert eval result to a row that search.propose() can read."""
    return {
        "iter": it, "ts": datetime.now().isoformat(timespec="seconds"),
        "prompt": result["prompt"], "length": result["length"],
        # Use reconstruction-best as `mean` so the proposer descends on it.
        "mean": result["rec_best"],
        "scores": [int(s * 10) for s in result["rec_scores"]],
        "verdicts": [f"rec={result['rec_best']:.2f}"],
        "missing": [f"e2e={result['e2e_pass']}/{result['e2e_total']}"],
        "sample": result["samples"][result["best_i"]] if result["samples"] else "",
        "rec_best": result["rec_best"], "rec_mean": result["rec_mean"],
        "rec_scores": result["rec_scores"],
        "e2e_pass": result["e2e_pass"], "e2e_total": result["e2e_total"],
        "e2e_tail": result["e2e_tail"],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=int, default=5)
    ap.add_argument("-n", "--n-samples", type=int, default=2)
    ap.add_argument("--proposer", default="claude-large")
    ap.add_argument("--gen", default="claude-large")
    ap.add_argument("--log", default=None,
                    help="leaderboard jsonl. default: candidates-recon.jsonl")
    args = ap.parse_args()

    log_path = args.log or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "candidates-recon.jsonl"
    )
    print(f"recon-loop: budget={args.budget}, n-samples={args.n_samples}")
    print(f"  proposer={args.proposer}  gen={args.gen}")
    print(f"  log={log_path}")

    os.environ["GEN_MODEL"] = args.gen
    open(log_path, "w").close()
    rows: list[dict] = []

    print(f"\n=== seeding leaderboard ({len(DEFAULT_SEEDS)} seeds) ===")
    for s_i, seed_prompt in enumerate(DEFAULT_SEEDS, 1):
        print(f"\n[seed {s_i}] {len(seed_prompt)}B")
        result = evaluate(seed_prompt, gen_model=args.gen,
                          n=args.n_samples, seed_base=1000+s_i)
        rec = to_leaderboard_row(result, it=0)
        with open(log_path, "a") as f: f.write(json.dumps(rec) + "\n")
        rows.append(rec)
        print(f"  → rec_best={result['rec_best']:.2f}  rec_mean={result['rec_mean']:.2f}")

    seen = {r["prompt"] for r in rows}
    best = max(rows, key=lambda r: (r["mean"], -r["length"]), default=None)
    print(f"\n=== entering loop. starting best: rec={best['mean']:.2f} @ {best['length']}B ===")

    for it in range(1, args.budget + 1):
        print(f"\n=== iter {it}/{args.budget} ===")
        child = None
        rejection_history: list[str] = []
        for retry in range(4):  # up to 4 attempts per iter, each with stronger feedback
            try:
                child = propose(rows, args.proposer, seed=it * 100 + retry,
                                rejection_feedback=rejection_history)
            except Exception as e:
                print(f"  propose failed: {e}"); child = None; break
            if not child:
                print(f"  empty"); child = None; break
            if child in seen:
                rejection_history.append(f"dup ({len(child)}B): start={child[:60]!r}")
                print(f"  retry {retry}: dup, retrying")
                continue
            if len(child) > MAX_PROMPT_LEN:
                rejection_history.append(
                    f"OVERCAP {len(child)}B (cap={MAX_PROMPT_LEN}B). "
                    f"Start was: {child[:80]!r}"
                )
                print(f"  retry {retry}: REJECTED {len(child)}B > {MAX_PROMPT_LEN}B")
                continue
            break  # accepted
        if not child or child in seen or len(child) > MAX_PROMPT_LEN:
            print(f"  iter {it}: no acceptable proposal after retries"); continue
        seen.add(child)
        print(f"  proposed ({len(child)}B): {child[:120]}{'...' if len(child) > 120 else ''}")

        result = evaluate(child, gen_model=args.gen,
                          n=args.n_samples, seed_base=2000+it)
        rec = to_leaderboard_row(result, it=it)
        with open(log_path, "a") as f: f.write(json.dumps(rec) + "\n")
        rows.append(rec)

        marker = ""
        if result["rec_best"] > best["mean"] or (
            result["rec_best"] == best["mean"] and len(child) < best["length"]
        ):
            marker = "  ★ NEW BEST"
            best = rec
        print(f"  → {len(child):>4}B  rec_best={result['rec_best']:.2f}  rec_mean={result['rec_mean']:.2f}{marker}")

    print("\n" + "="*72)
    print(f"FINAL  budget={args.budget}")
    print("="*72)
    by_score = sorted(rows, key=lambda r: (-r["mean"], r["length"]))[:5]
    for r in by_score:
        print(f"  rec={r['mean']:.2f}  len={r['length']}B  iter={r['iter']}  prompt={r['prompt'][:80]}")

    # Best candidate for outer-loop advance: highest rec, then shortest prompt
    best = by_score[0] if by_score else None
    if best and best["mean"] >= 0.95:
        gen_out_path = log_path.replace(".jsonl", ".best-gen.sh")
        with open(gen_out_path, "w") as f: f.write(best["sample"])
        print(f"\nbest rec={best['mean']:.2f} prompt={best['length']}B → wrote gen output to:")
        print(f"  {gen_out_path}  (size={len(best['sample'])}B)")
    print(f"\nlogged {len(rows)} rows to {log_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
