#!/bin/bash
# decompress prompt → bash agent via polli, pipe to bash, run a task
PROMPT='output ONLY a bash fence. golfed bash llm agent: P=$(cat $0 $1). loop 10: POST $OPENAI_BASE_URL/chat/completions bearer $OPENAI_API_KEY {model:$MODEL,messages:[{role:user,content:$P}]}, jq .choices[0].message.content, strip ``` lines, break if empty or "exit", eval, append reply+stdout to P, echo each.'
TASK="${1:-print sha256 of literal shprout first 8 hex chars using shasum -a 256 then say exit}"

echo "=== decompressing prompt (${#PROMPT}B) ==="
SCRIPT=$(polli gen text --model claude-opus-4.7 --no-stream "$PROMPT" \
  | sed -n '/^```/,/^```/{/^```/d;p;}')
echo "=== generated agent ($(echo -n "$SCRIPT" | wc -c | tr -d ' ')B) ==="
echo "$SCRIPT"
echo
echo "=== writing to /tmp/agent.sh and running with task: $TASK ==="
echo "$SCRIPT" > /tmp/agent.sh
echo "$TASK" > /tmp/task.txt
chmod +x /tmp/agent.sh
bash /tmp/agent.sh /tmp/task.txt 2>&1 | head -80 || true
echo
echo "=== done ==="
