# DOM REPL

Open `/repl.html`. Sign in with Pollinations, describe a page, then submit
follow-up changes against the same running workspace.

This variant uses a fixed, inspectable JavaScript agent loop. The model writes
REPL cells; it does not regenerate this loop from a seed. The Bash version at
`/` remains the prompt-to-harness experiment.

Each cell is an async function body with three bindings:

```js
state.count = 0;
stage.innerHTML = '<button>Grow</button><output>0</output>';
state.grow = () => {
  stage.querySelector('output').textContent = ++state.count;
};
stage.querySelector('button').onclick = state.grow;
console.log(stage.outerHTML);
```

The DOM, event listeners, and `state` object persist across cells and tasks.
Store reusable functions and references on `state`. Local `let`/`const` bindings
do not persist. `console.log` and returned values become observations. Thrown
errors are fed back so the next cell can repair the page without resetting it.

Before every model request, the runner reads a fresh DOM and state summary.
It includes its actual loop, fence parser and evaluator as self-description.
This is a DOM observation, not a screenshot or proof of visual correctness.
Only the latest 18 history messages and bounded current observations are sent;
the current task remains explicit.

The evaluator lives in an opaque-origin `sandbox="allow-scripts"` iframe.
Credentials and model calls stay in the parent. CSP restricts ordinary network
APIs and external assets. Generated code is not trusted with host operations.
This is browser isolation, not a hardened hostile-code VM: arbitrary synchronous
JavaScript can block its renderer, and wall-clock timers cannot preempt a busy
JavaScript thread. Do not describe the time limits as a hard CPU quota.

A run stops after 8 model calls or 90 seconds. An awaited cell has a 10-second
response timeout. Stop and timeout discard the iframe and its state. Successful
completion keeps it alive, including its event handlers and animations. Reset
explicitly discards that workspace.

Implementation:

- `web/repl-engine.js`: the sequential model/evaluate/observe loop.
- `web/repl-sandbox.js`: evaluator and persistent state, serialized into iframe.
- `web/repl-runtime.js`: parent/iframe request bridge and lifecycle.
- `web/repl.js`: UI, live API adapter and follow-up tasks.

Verification: unit tests cover repair observations, fresh snapshots, follow-up
history, cancellation, limits, persistent state/functions and message-source
filtering. The separate browser fixture at `test/browser-fixture.mjs` exercises
real iframe execution using explicitly scripted model responses: create a
counter, throw an error, repair it, click the live button, then add ten in a
follow-up cell. The count progresses from 0 to 1 to 11. Access to the parent
document is blocked. These fixtures do not establish live model quality and
are not served as a replay mode by the public demo.

## Three interaction versions

Start at `/repl-versions.html`. The original `/repl.html` and the prompt-grown Bash demo at `/` remain available.

- `/repl-console.html`: dark command console beside the live page. Enter submits, Shift+Enter inserts a newline; `/inspect` reads the DOM and state without calling the model, `/reset` clears the workspace, `/help` lists commands.
- `/repl-canvas.html`: full-page output with a floating prompt dock. Follow-up buttons send real instructions; the execution log is collapsed until requested.
- `/repl-notebook.html`: the agent proposes editable JavaScript cells. Each waits for “Run cell.” Edited code is recorded in model history before execution. Stop cancels a pending cell and resets the workspace. Time spent reviewing a cell does not consume the 90-second active-work budget.

All three use `repl.js`, `repl-engine.js`, and the same isolated iframe evaluator. These variants generate JavaScript cells using a fixed runner; the Bash demo separately generates its harness from a prompt. Drafts are stored separately per interface. Sign-in remains the Pollinations redirect flow without a client ID.

Validation: 68 passing tests, one skipped local Lisp test; static build emits 38 files. Browser integration fixture verified edited-cell execution and cancellation, automatic repair, state persistence through a clicked button and follow-up, and console inspection without an extra model call. Browser model responses were mocked; no paid live model session was used for this verification. The fixture is excluded from production routes.
