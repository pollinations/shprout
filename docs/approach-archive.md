# Shprout approach archive

This document preserves the useful ideas from the experimental branches while
the project converges on one agent implementation: the canonical `shprout`
script, executed by just-bash in the browser.

## Canonical behavior

The `unfence` branch is the behavioral base for the canonical agent.

- The model may think in prose before emitting one fenced bash block.
- No fenced block means the model is done.
- The complete response and command output are appended to history.
- Command failures are captured as output, so the next turn can recover.
- Generation stops at the first closing fence to avoid transcript spillover.
- Model prose is printed with a `> ` prefix so it cannot be confused with
  command output.

This script has been executed successfully through the `just-bash/browser`
entrypoint with a scripted two-turn model exchange.

## Branch findings

### `main`

The original command-only loop remains the conceptual core: self-read, task,
model call, eval, output, and cumulative history. Its comments-as-reasoning
protocol is smaller than the unfenced protocol, but modern models naturally
produce prose and fences, making `unfence` more tolerant in practice.

### `self-recurse`

Useful ideas:

- Separate the history marker from model output to reduce transcript
  hallucination.
- Use a stop sequence that cannot be mistaken for prior shell output.
- Keep the loop and prompt format legible to the model even when golfing.

This branch is already an ancestor of `main`; no unique code remains to port.

### `self-mod`

Useful idea: copy the agent into its workspace and reread its source on every
turn, allowing deliberate self-modification to affect later turns.

This remains a research idea rather than default behavior. It changes agent
identity during a run and makes evaluation less reproducible. just-bash's
in-memory filesystem would be a safe place to revisit it later.

### `unfence`

Useful ideas incorporated into the canonical behavior:

- Freeform reasoning plus one explicit fenced action.
- Prose-only completion.
- Full assistant response in history, not only the extracted command.
- Explicit output capture without relying on stderr tee behavior.

### `unfence-syscap`

Useful ideas:

- Keep the agent source and task in an untruncated system message.
- Keep execution history in a separate user message.
- Bound history size so long tool output cannot consume the entire context.

The branch uses process substitution, which just-bash 3.1.0 does not parse.
If log capping is adopted, use an intermediate variable and `tail -c` instead.
System/user separation should be benchmarked before changing the canonical
single-message protocol.

### `prompt-compression`

Useful ideas:

- Search for prompts that regenerate an agent instead of only golfing code.
- Score reconstruction and end-to-end behavior separately.
- Save generated samples and structured results rather than only a winner.

This work is fully contained in the later `compress-bench` branch.

### `compress-bench`

Useful ideas to preserve as tests:

- Tier 0 syntax and ingredient checks.
- Tier 1 scripted API responses with request-trace assertions.
- Tier 2 executed file, pipeline, multi-step, and recovery tasks.
- Tier 3 external Terminal-Bench runs for broader reality checks.
- Cache results by script, model, provider, and gate configuration.

The 386-byte prompt champion passed the six-task micro-bench, but both it and
the reference scored 0/10 on the sampled Terminal-Bench run. It is research
evidence, not a production replacement for the canonical script.

### `webcontainer`

Useful ideas:

- Browser OAuth callback handling and shared key storage.
- A terminal-first task interface.
- Persistent workspace files across turns.
- Abortable runs and visible run state.
- Deterministic fake-model gates before expensive live evaluation.
- Side-by-side model comparison with objective and model-based judging.

WebContainer boot, cross-origin isolation, shell shims, and parallel agent
implementations are retired. The browser now executes the canonical script in
just-bash.

### `jsprout`

Useful ideas:

- Inject a deliberately small tool scope into generated code.
- Include a DOM snapshot before each turn.
- Treat thrown errors as observations and allow a repair turn.
- Use an array return protocol for continuation and fan-out.

These ideas are recorded for future orchestration work. Direct AsyncFunction
execution is not part of the consolidated shell agent.

### `nodeprout`

Useful ideas:

- Persist files and globals between turns.
- Expose package use and subprocess execution as explicit tools.
- Keep the agent self-description next to the executor.

These require real Node semantics and are intentionally outside the just-bash
browser runtime.

### `evalprout`

Useful ideas:

- Trace model requests against scripted replies to verify task inclusion,
  action execution, cumulative history, and termination.
- Run cheap deterministic gates before live-model tasks.
- Store results in files rather than parsing interleaved terminal output.

The browser-specific Node candidate runner is retired. Its deterministic gate
is replaced by tests that execute the canonical script in just-bash.

### `arena`

Useful ideas:

- Run the same task and evaluation contract against two models.
- Combine objective artifact metrics with a model judge.
- Keep each run isolated and abortable.

The direct-DOM JavaScript agent is retired. A future arena should run two
instances of the same canonical shprout script in separate just-bash filesystems.

### `codex/polli-cli-webcontainer-demo`

Useful ideas:

- Reuse the website OAuth token instead of forcing a second login.
- Keep credentials out of generated command text.
- Offer a terminal and inspectable workspace around an agent run.
- Treat Polli as a composable model interface with explicit auth status.

Running the real npm Polli CLI requires Node and conflicts with the single
just-bash runtime. The consolidated browser calls the Pollinations API through
just-bash's allowlisted network layer and injects Authorization at the host
boundary, where shell code cannot read the real token.

## Consolidated architecture

1. `shprout` is the only agent implementation.
2. Real bash can execute it locally.
3. `just-bash/browser` executes the exact same file in the browser.
4. `shprout-polli` remains only a local auth/defaults launcher.
5. Browser credentials remain host-side and are injected into allowlisted
   Pollinations requests.
6. Deterministic tests run the canonical script with a scripted secure fetch.
7. Research harnesses evaluate this agent rather than creating replacement
   JavaScript or Node agents.
