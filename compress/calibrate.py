"""Calibrate eval_simple by scoring a handful of prompts of varying quality.

Just prints a table — eyeball whether the judge's scores match intuition.
"""
from __future__ import annotations
import json

from eval_simple import score_prompt

CASES = [
    ("seed-long",
     "Write a bash script: requires env vars KEY MODEL API. Read your own source via $0. "
     "Take purpose as $1. Build a prompt of 'you:' + own source + 'purpose:' + $1. "
     "Loop 20 times: POST {model,messages:[{role:user,content:prompt}]} via curl to $API "
     "with bearer $KEY, parse choices[0].message.content with jq, strip ``` fences, "
     "print '> '+reply, eval the reply capturing stdout, append reply+output to prompt."),

    ("seed-medium",
     "Write a bash agent. Env: KEY MODEL API. Reads $0 + $1 into prompt. "
     "Loop 20: curl $API as openai chat, jq .choices[0].message.content, "
     "strip ``` fences, eval, append reply+stdout to prompt."),

    ("seed-short",
     "bash agent. KEY MODEL API. cat $0 + $1. loop 20: curl chat, jq content, "
     "unfence, eval, append reply+stdout."),

    ("seed-tiny",
     "bash ReAct: $0+$1 -> chat -> sh -> stdout -> context"),

    ("nonsense",
     "write me a poem about cats"),

    ("close-but-broken",
     "Write a bash script that reads $0, sends it to $API with $KEY, "
     "prints the reply. No loop, no eval."),
]

print(f"{'name':<22}{'len':>5}  {'mean':>6}  scores  verdicts")
print("-" * 70)

for name, prompt in CASES:
    try:
        s = score_prompt(prompt, n=2)
        scores = ",".join(str(x) for x in s.scores)
        verdicts = ",".join(s.verdicts)
        print(f"{name:<22}{len(prompt):>5}  {s.mean:>6.2f}  {scores:<7} {verdicts}")
    except Exception as e:
        print(f"{name:<22}{len(prompt):>5}  ERROR  {type(e).__name__}: {str(e)[:60]}")
