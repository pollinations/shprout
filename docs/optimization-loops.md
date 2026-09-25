# Optimization loops

The useful unit to optimize is not an isolated prompt string. It is the complete, executable contract between model and environment:

- the `shprout` source shown to the model,
- the runtime description,
- the optional state files,
- the action parser and bash environment,
- the task set, trajectories, and acceptance metrics.

This keeps the agent self-describing: it sees the actual harness it is operating inside, not a prose approximation maintained somewhere else.

## Implemented surfaces

- `shprout`: default unfenced/stateful profile.
- `approaches/classic`: original bare-command protocol.
- `approaches/syscap`: split system/user messages with bounded history.
- `approaches/self-mod`: writable source identity that refreshes each turn.
- `research/gate.mjs`: deterministic, offline behavioral gate for candidates.
- `research/arena.mjs`: isolated same-task comparison across two profiles/models.

The gate and arena are outer-loop infrastructure. They do not add tools or hidden behavior to the agent being measured.

## Minimal state contract

| File | Lifetime | Prompt policy | Purpose |
| --- | --- | --- | --- |
| `SOUL.md` | durable | always, when present | Principles, tone, and boundaries |
| `GOAL.md` | until achieved or replaced | always, when present | One active objective, constraints, definition of done |
| `RECENT.md` | short-lived | always, when present | Compact handoff from recent runs; never a raw transcript |
| `HEARTBEAT.md` | durable checklist | only when `SHPROUT_HEARTBEAT=1` | Cheap periodic review and alert conditions |

The current run log is already working memory. Copying it into `RECENT.md` would waste tokens. `RECENT.md` should contain only information another run would otherwise have to rediscover. A scheduler is outside the agent: it decides when to invoke a heartbeat, while `HEARTBEAT.md` decides what that invocation should check.

## Outer loop

1. Freeze a baseline candidate and a train/held-out task split.
2. Run each task in an isolated filesystem and save the complete trajectory.
3. Score correctness first with deterministic tests, then record turns, input tokens, latency, and cost.
4. Mine concrete failures from traces. Preserve exact command errors and failed assertions as textual feedback.
5. Ask a proposer for a small patch to the harness or one state prompt. Give it the candidate source, traces, and metric breakdown.
6. Run the candidate on the small train sample, then the held-out regression set.
7. Accept only externally measured improvements. Keep a Pareto set when quality, tokens, and latency trade off.
8. Repeat within a fixed rollout budget and retain every candidate, score, and lineage.

The model may edit the code that calls the model, but it must not edit the scorer, hidden tasks, or acceptance rule. Self-judgment can provide diagnostic feedback; it is not the merge gate.

## Compression

There are three distinct operations:

1. **Harness compression:** make the executable source smaller while preserving behavior. This repo should optimize here first because the source is injected every turn.
2. **State curation:** move detailed history out of always-loaded state and keep only durable or recent conclusions.
3. **Semantic prompt compression:** use another model to remove low-value tokens from large context. This can help long retrieved documents, but adds latency and can corrupt shell, JSON, paths, or constraints.

Do not reward byte count alone. A candidate wins only when held-out task quality stays level or improves. Track source bytes and input tokens as separate metrics because tokenizer behavior is not proportional to file size.

## Research basis

- [mini-SWE-agent](https://mini-swe-agent.com/) demonstrates that a small loop centered on bash and observations can remain competitive without a large framework.
- [OPRO](https://arxiv.org/abs/2309.03409) feeds prior candidates and measured values back to an LLM optimizer.
- [Promptbreeder](https://arxiv.org/abs/2309.16797) evolves both task prompts and the mutation prompts that generate them.
- [STOP](https://arxiv.org/abs/2310.02304) lets a model improve the scaffolding program that calls it, while keeping the utility function external.
- [GEPA](https://arxiv.org/abs/2507.19457) uses execution traces, textual feedback, minimal reflective mutations, and Pareto candidate retention.
- [Agentic Context Engineering](https://openreview.net/forum?id=eC4ygDs02R) separates generation, reflection, and curation so an evolving playbook does not grow without bound.
- [Meta-Harness](https://arxiv.org/abs/2603.28052) gives an optimizer filesystem access to harness source, scores, and prior traces rather than compressing all evidence into one prompt.
- [Self-Harness](https://arxiv.org/abs/2606.09498) uses weakness mining, minimal proposals, and regression-gated acceptance on the same model being improved.
- [LLMLingua](https://arxiv.org/abs/2310.05736) is evidence that semantic compression can reduce long prompts, but it is a separate, model-backed preprocessing stage rather than a free minifier.
- [OpenClaw workspace files](https://docs.openclaw.ai/concepts/agent-workspace), [memory](https://docs.openclaw.ai/concepts/memory), and [heartbeats](https://docs.openclaw.ai/gateway/heartbeat) motivate separating stable identity, curated memory, daily/recent detail, and a tiny opt-in periodic checklist.

## Next experiment

The first optimizer should remain deliberately small:

- candidate: `shprout` source plus optional seed `SOUL.md`,
- proposer: one model call that returns a unified diff,
- tasks: deterministic shell fixtures with hidden assertions,
- metrics: pass rate, median prompt tokens, median turns, and source bytes,
- search: baseline plus several independent minimal mutations,
- gate: no held-out regression and a measurable Pareto improvement.

Only after this loop produces repeatable gains should it be allowed to mutate the mutation prompt or its own search strategy.
