#!/usr/bin/env bash
# Self-prompting agent. Usage: ./agent.sh "your task"
# Env required: OPENAI_API_KEY MODEL OPENAI_BASE_URL

set -uo pipefail

# --- sanity checks --------------------------------------------------------
for v in OPENAI_API_KEY MODEL OPENAI_BASE_URL; do
  if [ -z "${!v:-}" ]; then
    echo "error: \$$v is not set" >&2
    exit 1
  fi
done

# --- build initial prompt: this script's own source + the task -----------
prompt="$(<"$0")

TASK: ${1:-}"

# --- loop -----------------------------------------------------------------
for i in $(seq 1 20); do

  # 1) build request body safely with jq (handles quoting/escaping)
  body=$(jq -n \
    --arg model "$MODEL" \
    --arg content "$prompt" \
    '{model:$model, messages:[{role:"user", content:$content}]}')

  # 2) call the API
  resp=$(curl -sS -X POST "$OPENAI_BASE_URL/chat/completions" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body")

  # 3) extract assistant reply
  reply=$(printf '%s' "$resp" | jq -r '.choices[0].message.content // empty')

  # 4) strip ``` fences (opening ```lang and closing ```)
  reply=$(printf '%s\n' "$reply" \
    | sed -e '/^[[:space:]]*```[a-zA-Z0-9]*[[:space:]]*$/d')

  # trim leading/trailing blank lines
  reply=$(printf '%s' "$reply" | sed -e 's/[[:space:]]*$//')

  # 5) termination conditions
  [ -z "$reply" ] && { echo "[agent] empty reply — stopping"; break; }
  [ "$reply" = "exit" ] && { echo "[agent] got exit — stopping"; break; }

  echo "===== iteration $i =====" >&2
  echo ">>> reply:" >&2
  printf '%s\n' "$reply" >&2

  # 6) execute, capturing stdout+stderr (catch errors, don't die)
  out=$(eval "$reply" 2>&1)
  rc=$?
  echo ">>> output (rc=$rc):" >&2
  printf '%s\n' "$out" >&2

  # 7) feed reply + output back into the conversation
  prompt="$prompt

ASSISTANT:
$reply

OUTPUT (rc=$rc):
$out"

done
