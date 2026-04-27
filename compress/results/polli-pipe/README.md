# polli-pipe — decompress-and-run experiment (2026-04-27)

Demonstrates: **a sub-400B natural-language prompt, piped through `polli gen text` and into `bash`, produces a working LLM coding agent at runtime.**

The compression target shifts from "shortest bash" to "shortest *spec* that reliably elicits a working agent." Bash output bytes are downstream — what matters is the prompt-to-capability ratio.

## The one-liner

```bash
echo "TASK" > /tmp/t.txt && \
  polli gen text --model claude-opus-4.7 'PROMPT_HERE' \
  | awk '/^```/{f=!f;next} f' \
  | tee /tmp/a.sh \
  | bash -s /tmp/t.txt
```

Verified on the right pane of the dev iTerm2: produced `f017597f` (correct sha256 of "shprout") in turns 2–3, runtime model `claude-large`, sandboxed via `sandbox.sh`.

See `oneliner.sh` for the canonical form.

## Prompt variants explored

All n=1 manual generations.

| variant | prompt B | gen model | agent B | works? | notes |
|---|---|---|---|---|---|
| v1 (288B brevity, no fence guard) | 288 | opus-4.7 | 2168 | n/a | full prose preamble; not pipeable |
| v2 ("output ONLY a bash fence") | 305 | opus-4.7 | 372 | yes | clean, but no break-on-exit |
| v3 (+break + per-step echo) | 339 | opus-4.7 | **496** | ✅ ran end-to-end | best opus-4.7 result; saved as `agent-opus-v3-496B.sh` |
| v3 same prompt | 339 | claude-large | 509 | n/a | claude-large will golf when given fence-only guard — earlier "refuses to golf" finding was prompt quality, not model |
| v4 (terser, ambiguous $1) | 277 | opus-4.7 | 633 | no | misread `$1` as logfile path |
| v5 ($1 explicitly = task) | 314 | opus-4.7 | **564** | ✅ ran | richest output: semantic labels, real newlines; saved as `agent-opus-v5-564B.sh` |
| backtick-free + claude-fast | 345 | claude-fast | **455** | ❌ | inlined raw JSON (not `jq -n --arg`), broke after turn 1 with `null` cascade. Saved as `agent-claude-fast-455B.sh` |

## Findings

1. **"output ONLY a bash fence, no prose"** is the unlock — turns 2168B prose tangle into 372B clean bash from the same model on the same spec.
2. **claude-large will golf** with that guard — previously documented "claude-large refuses to golf" (results.json) was a prompt-quality artifact.
3. **`$1 is task`** prevents the model from inventing a logfile interpretation. Costs 8B, removes a class of misreads.
4. **claude-fast inlines raw JSON** instead of using `jq -n --arg`. Once the prompt accumulates quotes/newlines from turn 2 onward, the body becomes invalid JSON, the API errors, `.choices[0].message.content` is `null`, and `R="null"` (literal string, not empty) so the empty-check never breaks the loop. Fix would be ~30B more prompt: explicit "build JSON via `jq -n --arg`" + "break on empty/null/exit".
5. **Sweet spot:** ~315B prompt → ~500–560B agent with v3/v5 quality (better than original 910B shprout: real per-step logging, exit-handling, real newlines).

## What stayed unsolved (we abandoned here)

- Reliability sweep (n≥3 per variant per model) never run — would establish pass-rate, not just one-shot.
- claude-fast variant could likely be fixed with the two prompt clauses above; not attempted.
- Earlier file-free pattern (`SRC=$(curl URL); SRC=$SRC bash -c "$SRC" -- "$1"`) works but is more fragile than just `curl | tee /tmp/a.sh | bash -s task`. Reframed as: don't optimize away the file, optimize the spec.

## Reproduce

```bash
bash compress/results/polli-pipe/polli-pipe-wrapper.sh "your task here"
# or paste the contents of oneliner.sh into your shell
```

Requires: `polli` CLI authenticated (`polli auth status`), `OPENAI_API_KEY` / `MODEL` / `OPENAI_BASE_URL` env vars set for the runtime agent (the spawned `bash -s` inherits them). Optionally run inside `./sandbox.sh` for write-jail.
