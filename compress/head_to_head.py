"""Head-to-head: each of {claude-opus-4.7, gemini-large} as both gen and judge.

Same 166B champion prompt. 2 generations per model, 2x2 matrix of who judges
whose output. Uses the patched chat() that drops temperature on 'deprecated'.
"""
from __future__ import annotations
import json, time, textwrap, urllib.request, urllib.error
import re
import eval_simple as es

CHAMPION = ("bash agent:read $0+$1 into prompt.needs KEY MODEL API.loop 20:"
            "curl $API openai chat,jq .choices[0].message.content,strip ```fences,"
            "eval,append reply+stdout to prompt.")

MODELS = ["claude-opus-4.7", "gemini-large"]


def gen(model: str, n: int = 2) -> list[str]:
    out = []
    for i in range(n):
        t0 = time.time()
        try:
            raw = es.chat(model, [{"role": "user", "content": CHAMPION}],
                          temperature=0.7, timeout=120)
            code = es.strip_code_fence(raw)
            print(f"  [{model}] gen #{i+1}: {len(code)}B in {time.time()-t0:.1f}s")
            out.append(code)
        except Exception as e:
            print(f"  [{model}] gen #{i+1}: FAIL ({type(e).__name__}: {str(e)[:80]})")
            out.append("")
    return out


def judge_with(judge_model: str, candidate: str) -> tuple[int, str]:
    """One-off judge that lets us swap which model judges."""
    if not candidate:
        return 0, "empty"
    msg = (
        f"=== REFERENCE ===\n```bash\n{es.REAL_SHPROUT}\n```\n\n"
        f"=== CANDIDATE ===\n```bash\n{candidate}\n```\n"
    )
    raw = es.chat(judge_model, [
        {"role": "system", "content": es.JUDGE_SYS},
        {"role": "user", "content": msg},
    ], temperature=0, timeout=120)
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
        return 0, "parse-fail"
    return int(d.get("score", 0)), d.get("verdict", "?")


def main():
    print(f"Champion ({len(CHAMPION)}B): {CHAMPION}\n")

    samples: dict[str, list[str]] = {}
    for m in MODELS:
        print(f"Generating with {m}:")
        samples[m] = gen(m, n=2)

    print("\nMatrix: rows=generator, cols=judge\n")
    rows = []
    for gen_m in MODELS:
        for judge_m in MODELS:
            scores = []
            verdicts = []
            for s in samples[gen_m]:
                t0 = time.time()
                try:
                    sc, vd = judge_with(judge_m, s)
                except Exception as e:
                    sc, vd = 0, f"err:{type(e).__name__[:5]}"
                scores.append(sc); verdicts.append(vd)
                print(f"  gen={gen_m:<18} judge={judge_m:<18} s={s[:0]}{sc:>2}/10 {vd}   ({time.time()-t0:.1f}s)")
            mean = sum(scores) / (len(scores) * 10) if scores else 0
            rows.append({"gen": gen_m, "judge": judge_m, "scores": scores, "verdicts": verdicts, "mean": mean})

    print("\n" + "="*70)
    print(f"{'gen':<22}{'judge':<22}{'scores':<14}{'mean':>6}")
    print("-"*70)
    for r in rows:
        print(f"{r['gen']:<22}{r['judge']:<22}{str(r['scores']):<14}{r['mean']:>6.2f}")

    with open("head_to_head.json", "w") as f:
        json.dump({"samples": samples, "rows": rows}, f, indent=2)
    print(f"\nSaved → head_to_head.json")


if __name__ == "__main__":
    main()
