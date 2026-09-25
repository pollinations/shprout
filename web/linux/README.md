# Browser guest tools

`jq-linux-i386` is the unmodified static jq 1.8.2 release binary:
https://github.com/jqlang/jq/releases/download/jq-1.8.2/jq-linux-i386

SHA-256, verified against the release's `sha256sum.txt`:
`ba996e8ce436973e2f39e2639405a37e8c81ba8c722b71c83996278ad0af16dd`

The corresponding license is `jq-COPYING`.

`curl-bridge.py` implements transport, not an agent loop. It accepts the
canonical agent's curl arguments and emits a private terminal control message.
The page calls only the Pollinations chat endpoint and places the response in
the VM's read-only DataDevice. Bash, jq, eval and history remain in the agent.
The guest's API-key variable is a placeholder. This adapter intentionally does
not implement all of curl or expose arbitrary networking.
