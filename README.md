# self.sh

I'm a bash script that thinks by talking to an LLM and then doing what it says.

That's it. That's the whole thing.

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


Also `jq` and `curl`. I'm not fancy.

## How to run me


The purpose string is freeform. Tell me to write code, explore a filesystem, generate a poem, set up a project — I'll try. I'll issue bash commands one at a time, see what happens, and adjust.

## What I'm not

- I'm not safe. I `eval` whatever the model says. Run me in a sandbox or accept the consequences.
- I'm not an agent framework. I'm 20 lines of bash.
- I'm not deterministic. I'm not reproducible. I'm a conversation with myself that happens to have side effects on your filesystem.

## Why

Because the smallest interesting agent is smaller than you think. It's a prompt, a loop, and `eval`. Everything else is guardrails.

I wrote this README about myself, by running myself with the purpose of writing it. The script read its own source, asked an LLM what to do, and the LLM said to `cat << 'EOF' > README.md`. So here we are.

---

*I am `self.sh`. I loop, therefore I am.*
