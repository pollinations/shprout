"""Score the 166B champion prompt with each candidate generator model.

Cheap way to compare decompressors before committing to a full search per model.
Judge stays fixed (openai-large) for fair comparison.
"""
from __future__ import annotations
import json, time
from eval_simple import chat, strip_code_fence, judge

CHAMPION = ("bash agent:read $0+$1 into prompt.needs KEY MODEL API.loop 20:"
            "curl $API openai chat,jq .choices[0].message.content,strip ```fences,"
            "eval,append reply+stdout to prompt.")

# Skip ones already known broken or irrelevant
GENERATORS = [
    "claude-large",      # baseline (already tested)
    "claude",
    "claude-fast",
    "claude-opus-4.7",
    "openai-large",
    "openai",
    "openai-fast",
    "kimi-k2.6",
    "kimi",
    "qwen-coder-large",
    "qwen-large",
    "glm",
    "mistral-large",
    "deepseek-pro",
    "grok-large",
    "gemini-large",
    "nova",
]

print(f"Scoring 166B champion prompt across {len(GENERATORS)} generators")
print(f"Champion: {CHAMPION}\n")
print(f"{'model':<22}{'time':>7}  {'len':>5}  {'s1':>3} {'s2':>3}  {'mean':>5}  verdicts")
print("-" * 78)

results = []
for model in GENERATORS:
    t0 = time.time()
    try:
        # 2 generations, judge each
        scores, verdicts, sample_lens = [], [], []
        for i in range(2):
            try:
                raw = chat(model, [{"role": "user", "content": CHAMPION}],
                           temperature=0.7, timeout=60)
                code = strip_code_fence(raw)
                sample_lens.append(len(code))
                sc, vd, _ = judge(code)
                scores.append(sc); verdicts.append(vd)
            except Exception as e:
                scores.append(0); verdicts.append(f"err:{type(e).__name__}")
                sample_lens.append(0)
        elapsed = time.time() - t0
        mean = sum(scores) / (len(scores) * 10) if scores else 0
        avg_len = sum(sample_lens) // len(sample_lens) if sample_lens else 0
        v_short = ",".join(v[:5] for v in verdicts)
        print(f"{model:<22}{elapsed:>6.1f}s  {avg_len:>5}  {scores[0]:>3} {scores[1]:>3}  {mean:>5.2f}  {v_short}")
        results.append({"model": model, "scores": scores, "mean": mean,
                        "verdicts": verdicts, "elapsed": elapsed, "avg_len": avg_len})
    except KeyboardInterrupt:
        print(f"\nstopped at {model}")
        break
    except Exception as e:
        print(f"{model:<22}    ERR  {type(e).__name__}: {str(e)[:50]}")
        results.append({"model": model, "error": str(e)})

with open("model_sweep.json", "w") as f:
    json.dump(results, f, indent=2)

print(f"\nSaved {len(results)} results to model_sweep.json")
print("\nRanking by mean score (then speed):")
ranked = sorted([r for r in results if "mean" in r],
                key=lambda r: (-r["mean"], r["elapsed"]))
for i, r in enumerate(ranked, 1):
    print(f"  #{i:>2}  {r['model']:<22}  mean={r['mean']:.2f}  ({r['elapsed']:.1f}s)")
