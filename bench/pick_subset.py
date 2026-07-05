"""List terminal-bench-2 tasks with difficulty + timeouts; suggest a smoke subset.

Reads task.toml files straight from the laude-institute/terminal-bench-2 repo
via the GitHub API (no clone). Prints a table sorted easy-first and a ready
`-i task ...` flag string for the N cheapest tasks.

    python bench/pick_subset.py            # table + suggested 8-task subset
    python bench/pick_subset.py 5          # suggest 5 tasks
"""
from __future__ import annotations
import json, re, sys, urllib.request

API = "https://api.github.com/repos/laude-institute/terminal-bench-2"
RAW = "https://raw.githubusercontent.com/laude-institute/terminal-bench-2/main"


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "shprout-bench"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def task_names() -> list[str]:
    tree = json.loads(fetch(f"{API}/git/trees/main"))
    return sorted(e["path"] for e in tree["tree"]
                  if e["type"] == "tree" and not e["path"].startswith("."))


def task_meta(name: str) -> dict:
    try:
        toml = fetch(f"{RAW}/{name}/task.toml").decode()
    except Exception:
        return {"name": name, "difficulty": "?", "timeout": None}
    def grab(key, default=None):
        m = re.search(rf'^{key}\s*=\s*"?([\w.-]+)"?', toml, re.M)
        return m.group(1) if m else default
    return {
        "name": name,
        "difficulty": grab("difficulty", "?"),
        "timeout": float(grab("timeout_sec") or 0) or None,
        "expert_min": float(grab("expert_time_estimate_min") or 0) or None,
    }


DIFF_ORDER = {"easy": 0, "medium": 1, "hard": 2, "?": 3}

if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    metas = [task_meta(t) for t in task_names()]
    metas.sort(key=lambda m: (DIFF_ORDER.get(m["difficulty"], 3),
                              m["expert_min"] or 99, m["timeout"] or 9999))
    print(f"{'task':<38}{'difficulty':<12}{'timeout':<10}expert_min")
    for m in metas:
        print(f"{m['name']:<38}{m['difficulty']:<12}"
              f"{str(m['timeout'] or '-'):<10}{m['expert_min'] or '-'}")
    subset = [m["name"] for m in metas[:n]]
    print(f"\nsuggested smoke subset ({n} easiest):")
    print("  " + " ".join(f"-i {t}" for t in subset))
