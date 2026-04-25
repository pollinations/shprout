# shprout

I'm a bash script that thinks by talking to an LLM and then doing what it says.

That's it.

> **Branch note: `prompt-compression`** — experimental work to find the shortest natural-language prompt that reliably elicits a functionally-equivalent shprout from an LLM. The premise: ship the prompt, not the script. Inspired by Yohei Nakajima's KISS prompt-golf game. See [`compress/`](./compress/).

## Compression experiment (this branch)

The hypothesis: shprout's 22 lines are themselves a compressed encoding of "self-prompting bash agent." A capable LLM should be able to reproduce them from a much shorter natural-language description. If the prompt is shorter than the script, the prompt becomes the artifact worth shipping.

### Headline result

A **117-byte** prompt elicits a functionally-equivalent shprout — **7.32× compression** vs the 856-byte source — and survives multi-judge agreement (openai-large, claude-large, claude-opus-4.7 all rate it ≥ 0.80):

```
bash agent:read $0+$1 to p.needs K M A.loop 20:curl $API oai chat,jq .ch[0].msg.cnt,strip ```fcs,eval,app both to p
```

### Approach

1. **Comparison judge** ([`compress/eval_simple.py`](./compress/eval_simple.py)) — feed the candidate prompt to a generator LLM, then ask a judge LLM whether the resulting bash matches the reference shprout on 9 observable behaviors (env vars, self-read, purpose arg, bounded loop, OpenAI-shape POST, jq content extract, fence strip, eval, history accumulation). Returns 0–10. Pure stdlib — no litellm, no DSPy.
2. **Leaderboard-aware proposer** ([`compress/search.py`](./compress/search.py)) — at each iteration, show the proposer the top-K candidates with their length, score, missing behaviors, and a snippet of what they generated. Ask for a strictly-shorter prompt. Random parent sampling + temperature 1.0 break the cycling that single-parent rotation produces.
3. **Multi-judge cross-validation** — re-judge the shortest survivors with all three judges to filter out single-judge bias. The visible 119/122B prompts pass under one judge but fall to 0.70 under another; only 117B is unanimous.
4. **Model sweep** ([`compress/model_sweep.py`](./compress/model_sweep.py)) — score the champion across 17 generators to find which decompressors are reliable. Tier 1 (perfect): `claude-large`, `claude-opus-4.7`. Tier 2 (≥ 0.85): `grok-large`, `kimi`, `gemini-large`.

### What we learned

- **Generator quality dominates judge quality.** Swapping the proposer model from `openai-large` to `claude-large` pushed the floor from 195B to 149B without other changes. Cheap models (claude-fast, openai, mistral-large) plateau at 0.40–0.50 — they consistently miss "history accumulation" and stuff the prompt elsewhere.
- **Leaderboard awareness > single-parent rotation.** Single-parent runs cycled the same 251/312/332-byte variants. Showing 5 candidates side-by-side broke through to 166B at perfect score and 149B at passing.
- **Single-judge bias is real.** Three of the shortest passing candidates (117/119/122B) all looked equivalent under one judge, but only 117B held under all three. Without cross-judging we'd be claiming 119B; with it we have an honest 117B.
- **Reasoning models are slow but precise.** `claude-opus-4.7` matches `claude-large` at perfect score; the price is the `temperature` parameter being deprecated (the wrapper retries without it on 400). `kimi-k2.6`/`deepseek-pro`/`qwen-large`/`glm` all hang past 120s on long prompts.
- **The 9-behavior rubric is the right granularity.** Coarser (single yes/no) loses the "this is missing one specific thing" signal the proposer needs; finer (line-by-line diff) lets cosmetic differences sink the score.

### Files

```
compress/
  eval_simple.py          # comparison judge + chat() helper (stdlib only)
  search.py               # leaderboard-aware proposer + Pareto seeding
  model_sweep.py          # 17-model decompressor benchmark
  head_to_head.py         # n×n generator/judge grid for two models
  visualize.py            # multi-run dashboard via the show skill
  visualize_crossjudge.py # cross-judge dashboard with min/mean per candidate
  eval.py                 # earlier 3-tier eval (regex+judge+sandbox-exec)
  fake_api.py             # stateful fake endpoint (used by eval.py)
  sandbox.sh / sandbox.sb # macOS sandbox-exec wrapper
```

Snapshots of each search run are kept locally in `compress/candidates-*.jsonl` (gitignored — regenerable + sometimes echo bearer tokens back from the model).

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
