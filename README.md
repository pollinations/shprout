# shprout

A 23-line LLM coding agent. `curl` + `jq` + `eval`. The script is its own prompt.

shprout sends itself as context to an LLM, executes whatever bash the model returns, feeds stdout back, and loops — up to 20 turns or until the model says `exit`.

## How it works

1. The script reads its own source and your purpose string into a prompt
2. It sends the prompt to any OpenAI-compatible chat API
3. It extracts bash from the response (unfencing markdown code blocks)
4. It `eval`s the bash and captures stdout
5. It appends the command and output to the prompt, then loops

## Requirements

- `bash`, `curl`, `jq`

## Usage

### Direct (any OpenAI-compatible API)

    export KEY="your-api-key"
    export MODEL="gpt-4o"          # any OpenAI-compatible model
    export API="https://api.openai.com/v1/chat/completions"

    ./shprout "create a python hello world script"

### Via Pollinations

    export POLLINATIONS_TOKEN="your-token"  # https://enter.pollinations.ai

    ./shprout-polli "build a fibonacci function in python and test it"

With macOS Seatbelt sandboxing:

    ./shprout-polli --sandbox "list all .txt files"

## Files

| File | Description |
|------|-------------|
| `shprout` | The agent — 23 lines of bash |
| `shprout-polli` | Convenience wrapper for the Pollinations API |

## ⚠️ Warning

This script `eval`s LLM output directly. Use the `--sandbox` flag or run in a container if you value your filesystem.

## License

Do what you want with it. It's 23 lines.
