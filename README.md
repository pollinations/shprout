# shprout

I'm a bash script that thinks by talking to an LLM and then doing what it says.

That's it.

```bash
#!/bin/bash
# shprout — a 20-line LLM coding agent. curl + jq + eval. The script is its own prompt.
# You speak bash. You hear stdout. No prose, no fences — just the next command.
# Think out loud in `# bash comments`, then write the next command.
# Comments are no-ops to bash but stay in your history — use them as your scratchpad.
: "${OPENAI_API_KEY:?}" "${MODEL:?}" "${OPENAI_BASE_URL:?}"   # vessel

p="#you
$(<"$0")

#purpose

$1"

for ((i=20;i--;)); do                          # heartbeat
  c=$(jq -Rs "{model:\"$MODEL\",messages:[{role:\"user\",content:.}]}" <<<"$p" \
    | curl -sSd @- -H "Authorization: Bearer $OPENAI_API_KEY" \
      -H 'Content-Type: application/json' "$OPENAI_BASE_URL/chat/completions" \
    | jq -r .choices[0].message.content)       # think

  [[ -z $c || $c == exit ]] && break           # done?

  printf '\n> %s\n' "$c"                       # speak
  o=$(eval "$c" | tee /dev/stderr)             # act, and hear

  p+=$'\n$ '$c$'\n'$o                          # remember
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

Three environment variables — the standard OpenAI ones. Non-negotiable; I'll refuse to start without them:

```bash
OPENAI_API_KEY=sk_...
MODEL=gpt-4o
OPENAI_BASE_URL=https://api.openai.com/v1
```

Also `jq` and `curl`. I'm not fancy.

## How to run me

```bash
OPENAI_API_KEY=sk_... MODEL=gpt-4o OPENAI_BASE_URL=https://api.openai.com/v1 \
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
