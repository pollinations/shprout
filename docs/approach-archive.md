# Shprout approach archive

This document preserves the useful ideas from the experimental branches while
the project converges on one browser shell runtime: just-bash. Distinct
shell-agent profiles remain runnable because they test materially different
harness ideas. The direct-DOM experiment remains separate because its tool is a
live browser subtree rather than a shell.

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

This is available as `approaches/self-mod`. It copies itself once into the
virtual workspace and proves through the deterministic gate that a source edit
is visible on the following turn. It remains non-default because changing agent
identity makes evaluation less reproducible.

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

This is available as `approaches/syscap`. Its process substitution was replaced
with an intermediate value and `tail -c`, which just-bash supports. The gate
checks both the system/user split and the configured history limit.

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

The 386-byte prompt produced one passing sample out of two; the selected agent
passed the six-task micro-bench. Both it and the reference scored 0/10 on the
sampled Terminal-Bench run. The evidence and prompt are restored under
`research/compression`, while `research/gate.mjs` ports the deterministic tiers
to just-bash.

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

Useful ideas retained in the active `domprout` experiment:

- Inject a deliberately small tool scope into generated code.
- Include a DOM snapshot before each turn.
- Treat thrown errors as observations and allow a repair turn.
- Use an array return protocol for continuation and fan-out.
- Let a branch delegate work recursively to specific parts of its own subtree.
- Run independent child branches concurrently.

The archived progression was reconstructed from the branch history rather than
from one snapshot: loop and console-error repair, recursive self-calls, message
history, scoped `AsyncFunction` injection, array fan-out, a unified child
protocol, fresh DOM snapshots, and finally abort/budget/retry handling.

`domprout` modernizes that line with deterministic branch paths, global step and
depth limits, capped current-only DOM snapshots, and a single return contract:
`[]` finishes, `[{}]` continues or repairs the same subtree, and
`[{ task, target }]` delegates to a selector relative to the current subtree.
Parallel selectors must resolve exactly once and cannot overlap.

Generated code now runs in a visible opaque-origin iframe with network access
disabled. The parent page owns OAuth credentials and model requests, so an
action cannot inspect the Pollinations key or the host page. The model still
sees the orchestrator and sandbox source, preserving the self-describing
runtime idea. The deterministic `/domprout.html?demo=1` path exercises the real
iframe bridge, parallel siblings, and nested recursion without an API call.

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

The old direct-DOM arena's subtree fan-out is preserved in `domprout`. Model and
profile comparison remains a separate concern: the current arena runs two
canonical shell profiles in isolated just-bash filesystems.

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

1. just-bash is the only browser shell execution substrate.
2. `shprout` is the default unfenced/stateful profile.
3. Classic, split/capped, and self-modifying profiles live under `approaches/`.
4. Every profile remains executable by real bash and just-bash.
5. `shprout-polli` remains only a local auth/defaults launcher.
6. Browser credentials remain host-side and are injected into allowlisted
   Pollinations requests.
7. The deterministic gate executes all shell profiles with scripted secure
   fetch and profile-specific assertions.
8. `domprout` is a separate, sandboxed direct-DOM harness, not an alternative
   shell implementation.
9. Arena and optimization workflows compare or mutate harnesses through shared
   result formats rather than coupling their runtimes.
