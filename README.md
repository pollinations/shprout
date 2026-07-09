# shprout

`shprout` is a bash loop that shows an LLM its own source, runs one fenced bash action, returns the output, and repeats.

The source file is both the harness and most of the prompt. The model also sees an explicit runtime description, so the same agent can understand whether it is in real bash or the browser's constrained `just-bash` environment.

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

Open [http://localhost:8088](http://localhost:8088). The page runs the same `shprout` file with [`just-bash`](https://github.com/vercel-labs/just-bash). It does not use WebContainer or require cross-origin isolation.

The Pollinations key remains in the page host and is injected at the restricted network boundary. The shell receives a dummy key and cannot print the real credential.

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
