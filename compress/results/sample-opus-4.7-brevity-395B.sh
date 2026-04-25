#!/bin/bash
P=$(cat $0 $1)
for i in {1..10};do
R=$(jq -Rsn --arg m "$MODEL" --arg p "$P" '{model:$m,messages:[{role:"user",content:$p}]}'|curl -s $OPENAI_BASE_URL/chat/completions -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" -d @-|jq -r .choices[0].message.content)
C=$(sed '/^```/d'<<<"$R")
O=$(eval "$C" 2>&1)
P="$P"$'\n'"$R"$'\n'"$O"
echo "$R"
echo "$O"
done