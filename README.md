# shprout

I'm a bash script that thinks by talking to an LLM and then doing what it says.

That's it.

> **Branch note: `prompt-compression`** — experimental work to find the shortest natural-language prompt that reliably elicits a functionally-equivalent shprout from an LLM. The premise: ship the prompt, not the script. Inspired by Yohei Nakajima's KISS prompt-golf game. See [`compress/`](./compress/) and the section below.

## Compression experiment (this branch)

The hypothesis: shprout's 22 lines are themselves a compressed encoding of "self-prompting bash agent." A capable LLM should be able to reproduce them from a much shorter natural-language description. If the prompt is shorter than the script, the prompt becomes the artifact worth shipping.

**Approach (hand-rolled, ~60 lines total):**

1. **Eval harness** ([`compress/eval.py`](./compress/eval.py)) — three tiers, cheapest first:
   - **Regex gate** (free, instant): 9 boolean checks for the load-bearing features — `KEY`/`MODEL`/`API` env vars, `$0` self-read, `$1` purpose, bounded loop, `curl`, `jq` content extraction, fence stripping, `eval`, history accumulation.
   - **LLM judge** (cheap): Claude on Pollinations rates the same 9-point rubric and returns JSON.
   - **Execution gate** (expensive, finalists only): runs the candidate script under macOS `sandbox-exec` against the real Pollinations endpoint with a trivial purpose, in a throwaway `WORK` dir.
2. **Search loop** (TODO) — Claude as proposer. At each step: feed it the current prompt, the score, the judge's notes, and a sample of what it generated; ask for a *shorter* prompt that fixes the missed criteria. Reply must be ONLY the new prompt. Track a Pareto frontier of `(length, score, reliability)`.
3. **Validation** (TODO) — separate stage. Top finalists run end-to-end under the existing sandbox.

**Why hand-rolled, not GEPA/DSPy:** GEPA's reflection-LM template misinterprets the candidate prompt as instructions to a downstream LLM and produces meta-commentary instead of new prompts. Burned 40 iterations stuck at 0.36. DSPy's lightweight optimizer for this case *is* `dspy.GEPA` — same library, plus wrapper tax. A direct loop fits the problem.

**Why no fake API server:** A fake endpoint only validates the parts the regex gate already covers. Integration failures (jq path mismatch, fence-stripping eating real code, loop never terminating against varied responses) only surface against a real model. The sandbox + real endpoint + trivial purpose is higher-signal and quicker to build.

**Models:**
- Generation target: `openai-fast` (small, fast — that's the "decompressor" we want to elicit shprout from).
- Judge & proposer: `claude` on Pollinations.

**Baseline:** the original 514-char seed prompt scores ~0.90 (regex 6/9, judge 9/9, exec passes). Goal: find prompts under ~150 chars that hold ≥0.7 reliability across multiple decompressions.

---

```bash
#!/bin/bash
# shprout — a 20-line LLM coding agent. curl + jq + eval. The script is its own prompt.
: "${KEY:?}" "${MODEL:?}" "${API:?}"          # vessel

p="You speak bash. You hear stdout. This is you.
you:$(<"$0")
purpose:$1"

for ((i=20;i--;)); do                          # heartbeat
  c=$(jq -Rs "{model:\"$MODEL\",messages:[{role:\"user\",content:.}]}" <<<"$p" \
    | curl -sSd @- -H "Authorization: Bearer $KEY" \
      -H 'Content-Type: application/json' "$API" \
    | jq -r .choices[0].message.content)       # think
  [[ $c == *'```'* ]] && c=$(sed -n '/^```/,/^```/{/^```/d;p;}' <<<"$c")   # unfence

  [[ -z $c || $c == exit ]] && break           # done?

  printf '\n> %s\n' "$c"                       # speak
  o=$(eval "$c" | tee /dev/stderr)             # act, and hear

  p+=$'\n'$c$'\n'$o                            # remember
done
```

https://github.com/user-attachments/assets/b0e78e3b-d616-48f3-aea4-208750a40e1d

<img width="1141" alt="shprout running" src="https://github.com/user-attachments/assets/1eba469b-9cba-482e-a17e-2dad0c2c10ac" />

## What actually happens

1. I read my own source code (`$(<"$0")`)
2. I receive a purpose (passed as `$1`)
3. I enter a loop — up to 20 heartbeats — where I:
   - Send my source, my purpose, and everything that's happened so far to an LLM
   - Get back a bash command
   - Run it
   - Listen to the output
   - Remember everything
   - Repeat

I am a loop that thinks, acts, and remembers. Then I stop.

## What I need

Three environment variables. They're non-negotiable — I'll refuse to start without them:

```bash
KEY=sk_...
MODEL=gpt-4o
API=https://api.openai.com/v1/chat/completions
```

Also `jq` and `curl`. I'm not fancy.

## How to run me

```bash
KEY=sk_... MODEL=gpt-4o API=https://api.openai.com/v1/chat/completions \
  ./shprout "your purpose"
```

[pollinations.ai](https://pollinations.ai) can power me too:

```bash
./shprout-polli "your purpose"
```

If you want a smaller room:

```bash
./shprout-polli --sandbox "your purpose"
```

The purpose string is freeform. Tell me to write code, explore a filesystem, generate a poem, set up a project — I'll try. I'll issue bash commands one at a time, see what happens, and adjust.

## What I'm not

- I'm not safe. I `eval` whatever the model says. Run me in a sandbox or accept the consequences.
- I'm not an agent framework. I'm 20 lines of bash.
- I'm not deterministic. I'm not reproducible. I'm a conversation with myself that happens to have side effects on your filesystem.

## Why

Because the smallest interesting agent is smaller than you think. It's a prompt, a loop, and `eval`. Everything else is guardrails.

I wrote the first version of this README by running myself with the purpose of writing it. The script read its own source, asked an LLM what to do, and the LLM said to `cat << 'EOF' > README.md`. So here we are.

---

*I am `shprout`. I loop, therefore I am.*
