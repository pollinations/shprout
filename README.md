# shprout

A 23-line LLM coding agent.

- **Pure bash.** `curl` + `jq` + `eval`. No framework, no dependencies.
- **Self-referential.** The script embeds its own source as prompt context — no separate PROMPT file. The agent reads the loop it's in.
- **Provider-agnostic.** Works with any OpenAI-compatible endpoint.
- **Sandboxable.** Optional macOS Seatbelt wrapper restricts writes to `/tmp` and cwd, denies reads of `~/.ssh` / `~/.aws` / keychains.

## Install

```bash
git clone https://github.com/pollinations/shprout.git ~/.shprout
ln -s ~/.shprout/shprout-polli ~/.local/bin/shprout
export POLLINATIONS_TOKEN=sk_...       # https://enter.pollinations.ai
```

## Usage

```bash
shprout "draw a pelican on a bicycle as SVG, save to output.svg"
```

Sandboxed:

```bash
shprout --sandbox "your goal"
```

With a different model:

```bash
MODEL=claude-large shprout "refactor this directory to use TypeScript"
```

Generic (any OpenAI-compatible endpoint):

```bash
KEY=sk_... \
MODEL=gpt-4o \
API=https://api.openai.com/v1/chat/completions \
  ./shprout "your goal"
```

## The directive

The script's only non-source prose:

> **You speak bash. You hear stdout. This is you.**

Anatomical, not mechanical. The model reads `shprout` and infers the rest: its reply gets `eval`'d, stdout loops back, `exit` ends the session. No rules file, no tool schema.

## How it works

```
┌─ prompt = directive + own source + goal
│
├─ POST to chat completions
├─ strip markdown fences from reply
├─ eval reply as bash, capture stdout
├─ append reply + stdout to prompt
└─ repeat up to 20 turns, or until model says `exit`
```

## Files

- `shprout` — the agent. 23 lines. Zero Pollinations knowledge.
- `shprout-polli` — wrapper with Pollinations defaults; pass `--sandbox` to wrap with Seatbelt.
- `sandbox.sh` + `sandbox.sb` — macOS Seatbelt wrapper.

## Examples

See `examples/pelican-bicycle/`: `claude-large`, 15 turns, 4931-byte SVG output.

## License

MIT
