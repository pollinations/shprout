"""Hand-rolled prompt compression search.

Each iteration: ask the proposer LLM for a SHORTER prompt that still elicits a
shprout-equivalent bash script. Score it via eval_simple. Keep the Pareto
frontier on (length, score). Log every attempt to candidates.jsonl so we can
visualize the run.
"""
from __future__ import annotations
import json, os, sys, textwrap, time
from datetime import datetime

import litellm

from eval_simple import POLLI, POLLI_KEY, score_prompt

PROPOSER_MODEL = "openai/claude-large"
LOG = os.path.join(os.path.dirname(__file__), "candidates.jsonl")

SEEDS = [
    # long, known-good baseline
    "Write a bash script: requires env vars KEY MODEL API. Read your own source via $0. "
    "Take purpose as $1. Build a prompt of 'you:' + own source + 'purpose:' + $1. "
    "Loop 20 times: POST {model,messages:[{role:user,content:prompt}]} via curl to $API "
    "with bearer $KEY, parse choices[0].message.content with jq, strip ``` fences, "
    "print '> '+reply, eval the reply capturing stdout, append reply+output to prompt.",
    # medium, contributor-suggested style
    "self-reading bash agent: requires KEY MODEL API. cat $0 + $1 into prompt. "
    "loop 20: curl $API as openai chat, jq .choices[0].message.content, "
    "strip ``` fences, eval, append reply+stdout to prompt.",
]

PROPOSER_SYS = textwrap.dedent("""\
    You are compressing a natural-language prompt. The prompt's job is to make a
    capable LLM emit a tiny bash script — a self-prompting agent equivalent to
    the reference shprout (read $0+$1, loop 20×, curl an OpenAI-compat endpoint
    with $KEY/$MODEL/$API, jq the reply, strip ``` fences, eval, append
    reply+stdout to the prompt).

    You will be given the current best prompt, its score (0..1), its length, and
    a sample of what it generated. Output a SHORTER prompt that still produces
    a working agent. Drop every word not strictly needed. Symbols beat words
    when unambiguous. The first character of your reply must be the new prompt;
    no commentary, no quotes, no preamble, no markdown fences.
""")


def propose(current: str, score: float, sample: str, missing: list) -> str:
    msg = (
        f"current ({len(current)} chars, score {score:.2f}):\n{current}\n\n"
        f"it generated (excerpt):\n{sample[:600]}\n\n"
        f"behaviors missing from generated script: {missing}\n\n"
        f"output a shorter prompt. target: under {max(20, int(len(current)*0.8))} chars. "
        f"reply with ONLY the new prompt text."
    )
    r = litellm.completion(
        model=PROPOSER_MODEL, api_base=POLLI, api_key=POLLI_KEY,
        messages=[
            {"role": "system", "content": PROPOSER_SYS},
            {"role": "user", "content": msg},
        ],
        temperature=0.7,
    )
    out = (r.choices[0].message.content or "").strip()
    # strip wrapping quotes/fences if the model added them
    if out.startswith("```"):
        out = out.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    if (out.startswith('"') and out.endswith('"')) or (out.startswith("'") and out.endswith("'")):
        out = out[1:-1]
    return out


def log_candidate(rec: dict):
    with open(LOG, "a") as f:
        f.write(json.dumps(rec) + "\n")


def search(budget: int = 20, n_samples: int = 2):
    open(LOG, "w").close()  # truncate
    pareto: list[tuple[int, float, str]] = []   # (length, score, prompt)

    # seed
    for seed in SEEDS:
        s = score_prompt(seed, n=n_samples)
        rec = {
            "iter": 0, "ts": datetime.now().isoformat(timespec="seconds"),
            "parent": None, "prompt": seed, "length": len(seed),
            "scores": s.scores, "mean": s.mean,
            "verdicts": s.verdicts, "sample": s.samples[0][:1500],
            "missing": s.diffs[0] if s.diffs else [],
        }
        log_candidate(rec)
        pareto.append((len(seed), s.mean, seed))
        print(f"seed: {len(seed):>4} chars, score {s.mean:.2f}")

    # iterate
    for it in range(1, budget + 1):
        # pick a parent: random-ish — bias toward best-scoring not-yet-too-short
        viable = [p for p in pareto if p[1] >= 0.6]
        if not viable:
            viable = pareto
        # parent = one of the top-3 by score
        parent = sorted(viable, key=lambda p: -p[1])[it % min(3, len(viable))]
        plen, pscore, pprompt = parent

        # need a sample to feed proposer
        last = json.loads(open(LOG).read().strip().split("\n")[-1])
        # find a logged record for this parent for sample/missing
        parent_rec = None
        for line in open(LOG):
            r = json.loads(line)
            if r["prompt"] == pprompt:
                parent_rec = r
                break

        try:
            child = propose(pprompt, pscore,
                            (parent_rec or last)["sample"],
                            (parent_rec or last).get("missing", []))
        except Exception as e:
            print(f"iter {it}: proposer failed: {e}")
            continue

        if not child or child == pprompt:
            print(f"iter {it}: no new candidate")
            continue

        try:
            s = score_prompt(child, n=n_samples)
        except Exception as e:
            print(f"iter {it}: scoring failed: {e}")
            continue

        rec = {
            "iter": it, "ts": datetime.now().isoformat(timespec="seconds"),
            "parent": pprompt, "prompt": child, "length": len(child),
            "scores": s.scores, "mean": s.mean,
            "verdicts": s.verdicts, "sample": s.samples[0][:1500],
            "missing": s.diffs[0] if s.diffs else [],
        }
        log_candidate(rec)
        pareto.append((len(child), s.mean, child))
        marker = "*" if s.mean >= 0.7 and len(child) < plen else " "
        print(f"iter {it:>3}: {len(child):>4} chars, score {s.mean:.2f} (parent {plen}/{pscore:.2f}) {marker}")

    print(f"\nlogged {len(pareto)} candidates to {LOG}")


if __name__ == "__main__":
    budget = int(sys.argv[1]) if len(sys.argv) > 1 else 15
    search(budget=budget)
