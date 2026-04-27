#!/bin/bash
P="$(cat "$1")"
for((i=0;i<10;i++));do
R=$(curl -s "$OPENAI_BASE_URL/chat/completions" -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"$P\"}]}" | jq -r '.choices[0].message.content')
[[ -z "$R" ]] && break
C=$(sed '/^```/d' <<<"$R")
O=$(eval "$C" 2>&1)
P+=$'\n---\n'"$C"$'\n---\n'"$O"
echo "Turn $((i+1)): $C"
[[ $? -ne 0 ]] && break
done
