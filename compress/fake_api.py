"""Stateful fake OpenAI-compatible /chat/completions server.

Logs every (request, response) pair to a JSON trace file. Returns scripted
replies designed to exercise the agent loop:
  T1: ```bash-fenced reply       — tests fence stripping
  T2: bare reply, no fence       — tests no-fence path
  T3: "exit"                     — tests clean termination

The trace lets a downstream LLM-judge inspect whether the candidate script
correctly accumulates history (T2's request body must contain T1's reply +
stdout, etc.).

Run standalone:
    python fake_api.py --port 8765 --trace /tmp/run.json
"""
from __future__ import annotations
import argparse, json, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

SCRIPT = [
    "```bash\necho hello-from-turn-1\n```",
    "echo turn-2-no-fence",
    "exit",
]


def make_handler(trace_path: str):
    turn = {"i": 0}
    lock = threading.Lock()

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a, **kw):  # silence
            pass

        def do_POST(self):
            n = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(n).decode("utf-8", errors="replace")
            try:
                req = json.loads(body)
            except Exception:
                req = {"_raw": body[:2000]}

            with lock:
                i = turn["i"]
                turn["i"] += 1

            if i >= len(SCRIPT):
                # script should have stopped after T2's "exit". If it kept calling,
                # that's a termination bug — surface it as a 503 the script will see.
                err = json.dumps({"error": "no more turns; script should have stopped"}).encode()
                self.send_response(503)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(err)))
                self.end_headers()
                self.wfile.write(err)
                with lock, open(trace_path, "a") as f:
                    f.write(json.dumps({"turn": i, "request": req, "error": "exhausted"}) + "\n")
                return

            reply = SCRIPT[i]
            resp = {
                "id": f"fake-{i}",
                "object": "chat.completion",
                "model": req.get("model", "fake"),
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": reply},
                    "finish_reason": "stop",
                }],
            }
            payload = json.dumps(resp).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

            # append to trace
            entry = {"turn": i, "request": req, "response": resp}
            with lock, open(trace_path, "a") as f:
                f.write(json.dumps(entry) + "\n")

    return H


def serve(port: int, trace_path: str):
    open(trace_path, "w").close()  # truncate
    srv = HTTPServer(("127.0.0.1", port), make_handler(trace_path))
    srv.serve_forever()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--trace", default="/tmp/shprout-trace.jsonl")
    a = ap.parse_args()
    print(f"fake_api on 127.0.0.1:{a.port}, trace -> {a.trace}", file=sys.stderr)
    serve(a.port, a.trace)
