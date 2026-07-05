"""Endpoint resolution + stdlib chat client for the eval harness.

Resolution order (first that authenticates wins):
  1. EVAL_BASE_URL + EVAL_API_KEY env vars (explicit override)
  2. Pollinations key at ~/.pollinations/shprout.json
  3. GitHub Models via `gh auth token` (free tier; low rate limits — fine for
     smoke runs, re-auth Pollinations for real search runs)

Each provider carries its own model names for the three roles:
  gen      — decompressor: turns a candidate prompt into a bash agent
  runtime  — the model generated agents think with during the micro-bench
  proposer — leaderboard-aware prompt compressor
"""
from __future__ import annotations
import json, os, subprocess, time, urllib.error, urllib.request

PROVIDERS = {
    "pollinations": {
        "base": "https://gen.pollinations.ai/v1",
        "gen": "claude-large", "runtime": "claude", "proposer": "claude-large",
    },
    "github": {
        "base": "https://models.github.ai/inference",
        "gen": "openai/gpt-4o", "runtime": "openai/gpt-4o-mini",
        "proposer": "openai/gpt-4o",
    },
}


def _polli_key() -> str | None:
    p = os.path.expanduser("~/.pollinations/shprout.json")
    try:
        return json.load(open(p))["apiKey"]
    except Exception:
        return None


def _gh_token() -> str | None:
    try:
        t = subprocess.run(["gh", "auth", "token"], capture_output=True,
                           text=True, timeout=10).stdout.strip()
        return t or None
    except Exception:
        return None


def _auth_ok(base: str, key: str, model: str) -> bool:
    """One tiny uncached request; cached 200s can mask dead keys."""
    body = json.dumps({"model": model, "max_tokens": 8, "messages": [
        {"role": "user", "content": f"say ok {time.time()}"}]}).encode()
    req = urllib.request.Request(
        f"{base}/chat/completions", data=body, method="POST",
        headers={"Authorization": f"Bearer {key}",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return "choices" in json.loads(r.read())
    except Exception:
        return False


_resolved: dict | None = None


def resolve(force: str | None = None) -> dict:
    """Returns {name, base, key, gen, runtime, proposer}."""
    global _resolved
    if _resolved is not None and force is None:
        return _resolved
    if os.environ.get("EVAL_BASE_URL") and os.environ.get("EVAL_API_KEY"):
        name = os.environ.get("EVAL_PROVIDER", "pollinations")
        cfg = {**PROVIDERS.get(name, PROVIDERS["pollinations"]),
               "base": os.environ["EVAL_BASE_URL"]}
        _resolved = {"name": f"env({name})", "key": os.environ["EVAL_API_KEY"], **cfg}
        return _resolved
    candidates = []
    if force in (None, "pollinations") and (k := _polli_key()):
        candidates.append(("pollinations", k))
    if force in (None, "github") and (k := _gh_token()):
        candidates.append(("github", k))
    for name, key in candidates:
        cfg = PROVIDERS[name]
        if _auth_ok(cfg["base"], key, cfg["runtime"]):
            _resolved = {"name": name, "key": key, **cfg}
            return _resolved
    raise RuntimeError(
        "no working LLM endpoint: pollinations key invalid/missing and "
        "GitHub Models unavailable. Re-auth with ./shprout-polli (device "
        "login) or set EVAL_BASE_URL + EVAL_API_KEY.")


def chat(model: str, messages: list, *, temperature: float | None = 0,
         timeout: float = 120, seed: int | None = None, retries: int = 5) -> str:
    """POST chat/completions on the resolved provider. Retries 429/5xx."""
    p = resolve()
    payload: dict = {"model": model, "messages": messages}
    if temperature is not None:
        payload["temperature"] = temperature
    if seed is not None:
        payload["seed"] = seed
    body = json.dumps(payload).encode()
    for attempt in range(retries):
        req = urllib.request.Request(
            f"{p['base']}/chat/completions", data=body, method="POST",
            headers={"Authorization": f"Bearer {p['key']}",
                     "Content-Type": "application/json",
                     "User-Agent": "shprout-compress/0.2"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())["choices"][0]["message"]["content"] or ""
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:200]
            if e.code == 400 and "temperature" in detail and "deprecated" in detail:
                payload.pop("temperature", None)
                body = json.dumps(payload).encode()
                continue
            if e.code in (429, 500, 502, 503) and attempt < retries - 1:
                wait = int(e.headers.get("Retry-After") or 0) or min(10 * (attempt + 1), 60)
                time.sleep(wait)
                continue
            raise RuntimeError(f"chat {e.code}: {detail}") from e


if __name__ == "__main__":
    p = resolve()
    print(f"provider: {p['name']}  base: {p['base']}")
    print(f"models: gen={p['gen']} runtime={p['runtime']} proposer={p['proposer']}")
    print("ping:", chat(p["runtime"], [{"role": "user", "content": "say ready"}])[:60])
