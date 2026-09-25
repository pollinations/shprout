#!/bin/bash
P="$(cat "$0")
TASK: $1"
for i in $(seq 1 10); do
  R=$(curl -sS "$OPENAI_BASE_URL/chat/completions" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg m "$MODEL" --arg c "$P" \
      '{model:$m,messages:[{role:"user",content:$c}]}')" \
    | jq -r '.choices[0].message.content' \
    | sed '/^```/d')
  [ -z "$R" ] && break
  [ "$R" = "exit" ] && break
  echo "=== reply $i ==="
  echo "$R"
  O=$(eval "$R" 2>&1)
  echo "=== stdout ==="
  echo "$O"
  P="$P
ASSISTANT: $R
STDOUT: $O"
done
