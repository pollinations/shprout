# Prompt compression evidence

The `compress-bench` branch searched for a short natural-language prompt that could regenerate a working shprout agent. Its best late candidate was this 386-byte prompt:

~~~text
Bash self-prompting agent. Env: OPENAI_API_KEY MODEL OPENAI_BASE_URL. prompt=$(<$0)+task $1. Loop <=20: curl POST {model:$MODEL,messages:[{role:user,content:prompt}]} to $OPENAI_BASE_URL/chat/completions, header Authorization: Bearer $OPENAI_API_KEY; reply=$(jq -r .choices[0].message.content); strip ``` fences; break if reply empty or =="exit"; eval reply, catch out; append reply+out.
~~~

One of two generated samples passed the old deterministic gate and six-task micro-bench. The selected generated agent was 1,891 bytes. Both that agent and the 910-byte reference later scored `0/10` on `terminal-bench-sample@2.0`, although the generated candidate made more partial progress on several tasks.

The result is evidence for an optimization workflow, not evidence that the compressed prompt is a better production harness. Exact historical code and results remain at tag `archive/compress-bench-2026-07-09`.

The current branch ports the cheap deterministic part of that workflow to the shared runtime:

```bash
npm run gate -- shprout
npm run gate -- approaches/classic --classic
npm run gate -- approaches/syscap --split-capped
npm run gate -- approaches/self-mod --self-mod
```

`research/gate.mjs` executes each candidate inside `just-bash`, scripts three model replies, and checks task injection, command execution, cumulative history, termination, source refresh, and capped split messages where applicable.
