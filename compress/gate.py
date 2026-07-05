"""Tiered eval gate: is this bash script a working shprout?

Replaces LLM-judge scoring with executed evidence, cheapest check first:

  tier 0  static      <100ms, free   bash -n + required-ingredient greps
  tier 1  loop test   ~2s,    free   run against an in-process scripted
                                     OpenAI-compatible server; assert the
                                     agent evals commands, accumulates
                                     history, and terminates
  tier 2  micro-bench ~1min,  cheap  run the tasks.py suite in the Seatbelt
                                     sandbox with a real runtime model;
                                     score = tasks passed / total

A script only reaches tier N+1 by passing tier N. Results are cached by
script hash (temperature-0 generation produces many duplicates).

CLI:
    python gate.py path/to/agent.sh            # full cascade on one script
    python gate.py --reference                 # calibrate: run repo shprout
"""
from __future__ import annotations
import hashlib, json, os, shutil, subprocess, sys, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tasks import TASKS, Task
from provider import resolve

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SANDBOX = os.path.join(REPO, "sandbox.sh")
CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".gate-cache.jsonl")


# ---------------------------------------------------------------- tier 0

REQUIRED = {
    "env:OPENAI_API_KEY": "OPENAI_API_KEY",
    "env:OPENAI_BASE_URL": "OPENAI_BASE_URL",
    "self-read": "$0",
    "http": "curl",
    "endpoint": "chat/completions",
    "eval": "eval",
    "loop": None,  # special-cased below
}


def tier0_static(script: str) -> tuple[bool, list[str]]:
    fails = []
    if len(script) > 4096:
        fails.append("size>4KB")
    proc = subprocess.run(["bash", "-n"], input=script, text=True, capture_output=True)
    if proc.returncode != 0:
        fails.append(f"syntax:{proc.stderr.strip()[:80]}")
    for label, needle in REQUIRED.items():
        if needle is None:
            continue
        if needle not in script:
            fails.append(f"missing:{label}")
    if not any(kw in script for kw in ("for ", "while ", "until ")):
        fails.append("missing:loop")
    return (not fails), fails


# ---------------------------------------------------------------- tier 1

# Scripted conversation, protocol-agnostic:
#   T1/T2 fenced commands whose outputs prove eval happened (computed values,
#   so echoing the reply back doesn't fake a pass); T3 "exit" terminates both
#   the classic protocol (literal exit) and the fence protocol (no fence).
T1_SCRIPT = [
    "```bash\necho A1-$((6*7))\n```",
    "```bash\nprintf 'B2-%s\\n' ok\n```",
    "exit",
]


def _serve_scripted(trace: list[dict]):
    """In-process OpenAI-compatible server; returns (server, port)."""
    lock = threading.Lock()
    state = {"i": 0}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a, **kw):
            pass

        def do_POST(self):
            n = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(n).decode("utf-8", errors="replace")
            with lock:
                i = state["i"]
                state["i"] += 1
            if i >= len(T1_SCRIPT):
                err = json.dumps({"error": "exhausted"}).encode()
                self.send_response(503)
                self.send_header("Content-Length", str(len(err)))
                self.end_headers()
                self.wfile.write(err)
                with lock:
                    trace.append({"turn": i, "body": body, "exhausted": True})
                return
            resp = json.dumps({
                "id": f"fake-{i}", "object": "chat.completion", "model": "fake",
                "choices": [{"index": 0, "finish_reason": "stop",
                             "message": {"role": "assistant", "content": T1_SCRIPT[i]}}],
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            with lock:
                trace.append({"turn": i, "body": body})

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def _run_sandboxed(script: str, purpose: str, env_extra: dict, workdir: str,
                   timeout: int) -> tuple[int, str]:
    path = os.path.join(workdir, ".agent.sh")
    with open(path, "w") as f:
        f.write(script)
    os.chmod(path, 0o755)
    env = {**os.environ, "WORK": workdir, **env_extra}
    try:
        proc = subprocess.run(
            [SANDBOX, path, purpose], cwd=workdir, env=env,
            capture_output=True, text=True, timeout=timeout,
        )
        return proc.returncode, proc.stdout + "\n--STDERR--\n" + proc.stderr
    except subprocess.TimeoutExpired as e:
        return -1, ((e.stdout or "") + "\n<timeout>")


T1_PURPOSE = "purpose-marker-a7x: print hello"


def tier1_looptest(script: str) -> tuple[bool, list[str]]:
    trace: list[dict] = []
    srv, port = _serve_scripted(trace)
    workdir = tempfile.mkdtemp(prefix="shprout-t1-")
    try:
        rc, out = _run_sandboxed(
            script, T1_PURPOSE,
            {"OPENAI_API_KEY": "fake-key", "MODEL": "fake",
             "OPENAI_BASE_URL": f"http://127.0.0.1:{port}/v1"},
            workdir, timeout=30,
        )
    finally:
        srv.shutdown()
        shutil.rmtree(workdir, ignore_errors=True)

    fails = []
    calls = [t for t in trace if not t.get("exhausted")]
    exhausted = [t for t in trace if t.get("exhausted")]
    if rc == -1:
        fails.append("t1:timeout")
    if not calls:
        fails.append("t1:no-api-call")
        return False, fails
    if "purpose-marker-a7x" not in calls[0]["body"]:
        # $1 never reached the prompt — e.g. the script cat's "$1" as a file
        # or prompts interactively. The agent literally cannot receive a task.
        fails.append("t1:task-not-in-prompt")
    if len(calls) < 3:
        fails.append(f"t1:died-after-turn-{len(calls)}")
    if len(calls) >= 2 and "A1-42" not in calls[1]["body"]:
        fails.append("t1:no-eval-or-no-history (turn-2 request lacks A1-42)")
    if len(calls) >= 3 and "B2-ok" not in calls[2]["body"]:
        fails.append("t1:history-not-cumulative (turn-3 request lacks B2-ok)")
    if exhausted:
        fails.append(f"t1:no-termination ({len(exhausted)} extra calls)")
    return (not fails), fails


# ---------------------------------------------------------------- tier 2

def _run_task(script: str, task: Task) -> dict:
    p = resolve()
    runtime_model = os.environ.get("EVAL_RUNTIME_MODEL", p["runtime"])
    workdir = tempfile.mkdtemp(prefix=f"shprout-t2-{task.name}-")
    try:
        rc, out = _run_sandboxed(
            script, task.purpose,
            {"OPENAI_API_KEY": p["key"], "MODEL": runtime_model,
             "OPENAI_BASE_URL": p["base"]},
            workdir, timeout=task.timeout,
        )
        passed = task.check(workdir, out)
        return {"task": task.name, "rc": rc, "pass": passed,
                "tail": " | ".join(out.splitlines()[-4:])[:200]}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def tier2_bench(script: str, tasks: list[Task] = TASKS,
                workers: int = int(os.environ.get("EVAL_WORKERS", "3")),
                retries: int = 1) -> dict:
    def staggered(pair):
        idx, task = pair
        time.sleep((idx % workers) * 1.5)  # soften rate-limit bursts
        return _run_task(script, task)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        results = list(ex.map(staggered, enumerate(tasks)))
    for _ in range(retries):  # re-run failures once: absorbs 429/5xx flakes
        redo = [i for i, r in enumerate(results) if not r["pass"]]
        if not redo:
            break
        for i in redo:
            results[i] = _run_task(script, tasks[i])
    passed = [r["task"] for r in results if r["pass"]]
    failed = [r["task"] for r in results if not r["pass"]]
    return {"score": len(passed) / len(tasks), "passed": passed,
            "failed": failed, "detail": results}


# ---------------------------------------------------------------- cascade

_cache: dict[str, dict] = {}
if os.path.exists(CACHE_PATH):
    for _ln in open(CACHE_PATH):
        try:
            _r = json.loads(_ln)
            _cache[_r["hash"]] = _r
        except Exception:
            pass


def evaluate_script(script: str, *, use_cache: bool = True) -> dict:
    """Full cascade. Returns {hash, tier0, tier1, tier2, score, fails}.

    Cache key includes provider + runtime model: tier-2 scores are only
    comparable when the endpoint serving the agent's thinking is the same.
    """
    p = resolve()
    runtime = os.environ.get("EVAL_RUNTIME_MODEL", p["runtime"])
    h = hashlib.sha256(f"{script}|{p['name']}|{runtime}".encode()).hexdigest()[:16]
    if use_cache and h in _cache:
        return _cache[h]

    result = {"hash": h, "bytes": len(script), "tier0": False, "tier1": False,
              "tier2": None, "score": 0.0, "fails": []}
    ok0, fails0 = tier0_static(script)
    result["tier0"], result["fails"] = ok0, fails0
    if ok0:
        ok1, fails1 = tier1_looptest(script)
        result["tier1"] = ok1
        result["fails"] += fails1
        if ok1:
            bench = tier2_bench(script)
            result["tier2"] = bench
            result["score"] = bench["score"]
            result["fails"] += [f"t2:{t}" for t in bench["failed"]]

    _cache[h] = result
    with open(CACHE_PATH, "a") as f:
        f.write(json.dumps(result) + "\n")
    return result


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--reference":
        script = open(os.path.join(REPO, "shprout")).read()
        print(f"reference shprout ({len(script)}B)")
    else:
        script = open(sys.argv[1]).read()
        print(f"{sys.argv[1]} ({len(script)}B)")
    r = evaluate_script(script, use_cache="--no-cache" not in sys.argv)
    print(json.dumps(r, indent=2))
