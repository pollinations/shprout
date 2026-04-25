#!/usr/bin/env bash
# Self-reading bash agent: reads itself + task, loops with LLM
# Usage: ./agent.sh "your task here"
# Env: OPENAI_API_KEY, MODEL (default: gpt-4o), OPENAI_BASE_URL (default: https://api.openai.com/v1)

set -euo pipefail

MODEL="${MODEL:-gpt-4o}"
OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://api.openai.com/v1}"

SELF=$(cat "$0")
TASK="${1:-Hello, what can you do?}"

# Build initial prompt: the agent's own source + the user's task
PROMPT="You are an autonomous bash agent. Below is your own source code, followed by a task.
You respond ONLY with a bash code block to execute. No explanation. Just \`\`\`bash ... \`\`\`.
If the task is complete, respond with exactly: DONE

=== AGENT SOURCE ===
$SELF
=== END SOURCE ===

=== TASK ===
$TASK
=== END TASK ===
"

MESSAGES=$(jq -n --arg sys "$PROMPT" '[{"role":"system","content":$sys}]')

for i in $(seq 1 10); do
  echo "=== LOOP $i/10 ==="

  # --- Call the LLM ---
  RESPONSE=$(curl -s "${OPENAI_BASE_URL}/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${OPENAI_API_KEY}" \
    -d "$(jq -n \
      --arg model "$MODEL" \
      --argjson msgs "$MESSAGES" \
      '{model: $model, messages: $msgs, temperature: 0.2}'
    )")

  # --- Extract reply ---
  REPLY=$(echo "$RESPONSE" | jq -r '.choices[0].message.content // "ERROR: no content"')

  echo "--- LLM REPLY ---"
  echo "$REPLY"
  echo "-----------------"

  # --- Check for DONE ---
  if [[ "$(echo "$REPLY" | tr -d '[:space:]')" == "DONE" ]]; then
    echo "Agent signaled DONE. Exiting."
    break
  fi

  # --- Strip ```bash fences, extract code ---
  CODE=$(echo "$REPLY" | sed -n '/^```bash/,/^```$/p' | sed '1d;$d')

  # Fallback: try generic ``` fences
  if [[ -z "$CODE" ]]; then
    CODE=$(echo "$REPLY" | sed -n '/^```/,/^```$/p' | sed '1d;$d')
  fi

  if [[ -z "$CODE" ]]; then
    echo "No code block found in reply. Skipping execution."
    STDOUT="(no code block found, nothing executed)"
  else
    echo "--- EXECUTING ---"
    echo "$CODE"
    echo "-----------------"

    # --- Eval and capture stdout+stderr ---
    STDOUT=$(eval "$CODE" 2>&1) || true
    echo "--- OUTPUT ---"
    echo "$STDOUT"
    echo "--------------"
  fi

  # --- Append assistant reply + execution result to messages ---
  MESSAGES=$(echo "$MESSAGES" | jq \
    --arg reply "$REPLY" \
    --arg stdout "$STDOUT" \
    '. + [
      {"role":"assistant","content":$reply},
      {"role":"user","content":("Execution output:\n" + $stdout + "\n\nContinue or respond DONE if task is complete.")}
    ]')

done

echo "=== AGENT FINISHED ==="