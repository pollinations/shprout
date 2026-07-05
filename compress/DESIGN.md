# Eval-gated compression search

Goal: **the smallest prompt that regenerates a working shprout** — where
"working" is decided by executed evidence and, at the top tier, by the same
benchmark used to score modern agent harnesses (terminal-bench via harbor).

## Why v2

The first-generation harness scored candidates with an LLM judge reading the
generated code (9-behavior rubric). That found a 117B "champion" that three
judges blessed — but judge score ≠ runs. The only execution test was a single
sha256 task. v2 inverts the priority: every score above tier 0 comes from
actually running the generated agent.

## The tier cascade (gate.py)

| tier | what | cost | catches |
|------|------|------|---------|
| 0 | `bash -n` + ingredient greps | <100ms, free | garbage, missing env vars/self-read/loop |
| 1 | scripted fake OpenAI server, in-process; trace-verified | ~2s, free | fence handling, eval, history accumulation, termination |
| 2 | 6-task micro-bench (tasks.py), Seatbelt sandbox, real model | ~1-2min, cheap | actual agency: files, pipes, multi-step, error recovery |
| 3 | terminal-bench@2.0 subset via harbor (bench/) | ~min/task, Docker | credible external number |

Tier 1 is the heart of the speedup: the protocol properties the old judge
guessed at (does it strip fences? append history? stop on "exit"?) are
asserted from the fake server's request trace — deterministic, offline, free.
The scripted conversation is T1 fenced command / T2 bare command / T3 "exit",
so both fence-tolerant and bare-reply agents are exercised.

Tier 2 scores = tasks passed / 6. Calibrate the pass bar against the repo's
reference shprout on the same provider + runtime model
(`python compress/gate.py --reference`). Tasks retry once to absorb
rate-limit flakes; results cache by script hash (temp-0 generation repeats).

## Search loop (bench_search.py)

Leaderboard-aware proposer (same pattern that worked in v1) but fitness =
gate cascade, and the leaderboard rows the proposer sees carry *executed
failure diagnostics* (`t1:no-termination`, `t2:mkfile`, …) instead of judge
prose. Objective: shortest prompt whose best sample clears the bar.

## Providers (provider.py)

Everything speaks OpenAI chat-completions through one resolver:
explicit `EVAL_BASE_URL`/`EVAL_API_KEY` → Pollinations key file → GitHub
Models via `gh auth token`. Auth is probed with an uncached request —
Pollinations serves cached bodies without auth, which masked a dead key.

Caveats discovered 2026-07-05:
- Both stored Pollinations keys are revoked (401 on any novel request);
  re-auth via `./shprout-polli` device login before real search runs.
- GitHub Models free tier rate-limits hard (~15 req/min + daily cap): fine
  for smoke tests, too noisy/capped for search runs. 429 bodies are non-JSON,
  which the *generated agents* see as jq parse errors → this shows up as
  tier-2 variance, not clean errors.

## terminal-bench integration (bench/)

`bench/shprout_agent.py` registers any shprout variant as a harbor
installed-agent: `install()` apt/apk/yum-installs curl+jq and heredocs the
script into the container; `run()` execs it with the instruction and the
resolved endpoint env vars. `SHPROUT_SCRIPT=<path>` selects the variant —
reference and champions get identical treatment.

Datasets in the packaged registry: `terminal-bench@2.0` (89 tasks),
`terminal-bench-sample@2.0` (smoke), `terminal-bench-pro@1.0`.
`bench/pick_subset.py` suggests the N cheapest tasks as `-i` flags.

## Running

```bash
python compress/gate.py --reference          # calibrate the bar
python compress/bench_search.py --seed-only  # score known seeds
python compress/bench_search.py --budget 20  # search
SHPROUT_SCRIPT=compress/results/champ.sh \
  harbor run -d terminal-bench@2.0 -a bench.shprout_agent:ShproutAgent \
  -i fix-git -n 2 --jobs-dir /tmp/harbor-jobs   # headline check
```
