# shprout

[`shprout`](shprout) is a 33-line bash loop that shows an LLM its own source,
runs one fenced bash action, returns the output, and repeats.

The source file is both the harness and most of the prompt. The model also sees an explicit runtime description, so the same agent can understand whether it is in real bash or the browser's constrained `just-bash` environment.

## The loop

The center of the agent is deliberately ordinary shell:

```bash
p="<you>$(<"$0")</you> ... <task>$task</task> ... $history"
body=$(jq -Rs "{model:\"$MODEL\",messages:[{role:\"user\",content:.}]}" <<<"$p")
rsp=$(curl ... -d "$body" ... | jq -er '.choices[0].message.content|strings') \
  || { echo 'shprout: model request failed' >&2; exit 1; }
cmd=$(awk '/^```/{if(f)exit;f=1;next} f' <<<"$rsp")
out=$(eval "$cmd" </dev/null 2>&1)
history+=$'\n--- you ---\n'$rsp$'\n--- bash ---\n'$out
```

`p` is the complete world the model sees. `jq -Rs` reads that world as one raw
string and constructs the request body structurally, so the shell never has to
escape prompt text as JSON by hand. The response's first fenced block is the
action; its output becomes the next observation. Everything else in the repo is
an execution surface, experiment, or evaluator around this loop.

## Run locally

```bash
OPENAI_API_KEY=sk_... \
MODEL=gpt-4o \
OPENAI_BASE_URL=https://api.openai.com/v1 \
./shprout "your task"
```

Pollinations can provide the defaults and authentication:

```bash
./shprout-polli "your task"
./shprout-polli --sandbox "your task"
```

Local runs need bash, `jq`, and `curl`. They execute model output with `eval`; use the sandbox launcher or another isolated environment for untrusted tasks.

## Run in a browser

```bash
npm install
npm run dev
```

Open the [experiment index](http://localhost:8088), then enter the
[shell workshop](http://localhost:8088/workshop.html). The workshop runs the
same `shprout` file with [`just-bash`](https://github.com/vercel-labs/just-bash).
It does not use WebContainer or require cross-origin isolation.

The Pollinations key remains in session storage in the page host and is injected
at the restricted network boundary. The OAuth callback is checked against a
one-time state value. The shell receives a dummy key and cannot print the real
credential.

The workshop keeps the shell loop visible without replacing it with browser-specific
agent code:

- `Preview` renders the first HTML artifact in an opaque, network-disabled iframe.
- `Activity` shows each model thought and fenced bash action at the API boundary.
- `Workspace` edits both generated files and `SOUL`, `GOAL`, `RECENT`, and opt-in `HEARTBEAT` state through one file browser.
- `Transcript` preserves the exact stdout, stderr, and exit status for debugging.
- `Source` shows the exact shell harness mounted into the virtual filesystem.

A deterministic [`?demo=1`](http://localhost:8088/workshop.html?demo=1) run drives the real
shell loop through three scripted model turns, builds an interactive artifact,
and verifies it without authentication. The classic, capped-history, and
self-modifying harness experiments remain available through the gate and arena;
they are not separate browser applications.

There is also a local-only Common Lisp experiment inspired by
[An Agent in 100 Lines of Lisp](https://thebeach.dev/posts/lisp-agent/):

```bash
./shprout-polli --lisp --sandbox "compute something, then reuse the function"
```

It requires SBCL, `curl`, and `jq`. The model emits one fenced Lisp form per
turn; `eval` runs it in the agent's live image, so definitions persist for the
rest of the run. This is the property under test, not recursion by itself.
Unlike the browser harness, the evaluated form can inspect process state and
credentials. The `--sandbox` example uses the bundled macOS Seatbelt wrapper,
which limits writes but is not a disposable isolation boundary; do not expose
credentials or readable files you are unwilling to give the generated code.

The separate [DOM agent](http://localhost:8088/domprout.html) runs generated
JavaScript against assigned page subtrees. It can delegate non-overlapping DOM
regions to parallel child branches and recurse further within a region. Model
access and the Pollinations key stay in the parent page; actions run in an
opaque-origin iframe with network access disabled. A deterministic
[`?demo=1`](http://localhost:8088/domprout.html?demo=1) run exercises the real
sandbox and recursive fan-out without authentication.

## Optional state

Create any of these files under `.shprout/`:

- `SOUL.md`: stable principles, tone, and boundaries.
- `GOAL.md`: the persistent objective and current definition of done.
- `RECENT.md`: a short cross-run handoff, not a transcript.
- `HEARTBEAT.md`: a tiny periodic checklist, included only with `SHPROUT_HEARTBEAT=1`.

State is read again before every model turn, so the agent can update it with ordinary bash. The run log stays separate and contains the full current trajectory.

```bash
mkdir -p .shprout
printf '%s\n' 'Prefer small, testable changes.' > .shprout/SOUL.md
printf '%s\n' 'Make the test suite pass.' > .shprout/GOAL.md
./shprout-polli "continue toward the goal"
```

See [Optimization loops](docs/optimization-loops.md) for the evaluation and self-improvement design, and [Approach archive](docs/approach-archive.md) for the useful ideas retained from earlier branches.

## Evaluate an approach

The deterministic gate runs an agent against scripted model replies inside `just-bash`:

```bash
npm run gate -- shprout
npm run gate -- approaches/classic --classic
npm run gate -- approaches/syscap --split-capped
npm run gate -- approaches/self-mod --self-mod
```

It verifies task injection, action execution, cumulative history, termination, and each profile-specific contract. The original compression-search result and its limitations are recorded in [research/compression](research/compression/README.md).

The arena runs any two profiles and models concurrently in isolated virtual filesystems:

```bash
OPENAI_API_KEY=sk_... OPENAI_BASE_URL=https://gen.pollinations.ai/v1 \
MODEL_A=claude-large MODEL_B=openai-fast \
npm run arena -- "your task" shprout approaches/syscap
```

It emits structured JSON containing each source size, elapsed time, exit code, stdout, and stderr. A scorer or judge can consume that artifact without being coupled to the agent runtime.
