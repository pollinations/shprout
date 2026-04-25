"""Render the e2e validation results as an HTML dashboard via the show skill.

Reads the most recent e2e_test.py output, parses each cell's pass/fail and
typical failure mode, and shows a card per (prompt, generator) pair.
"""
from __future__ import annotations
import os, re, html, sys, subprocess, json

DIR = os.path.dirname(os.path.abspath(__file__))
SHOW = os.path.expanduser("~/.claude/skills/show/show.js")

# Synthetic-eval scores from the original search for context.
SYNTHETIC_SCORES = {
    "117B-orig-K-M-A": ("117B", 0.80, "openai-large judge (single-judge bias)"),
    "119B-literal":     ("119B", 0.90, "openai-large judge"),
    "120B-literal-grok":("120B", 0.90, "opus-4.7 judge"),
    "123B-literal-cat": ("123B", 0.80, "opus-4.7 judge"),
    "137B-literal-fuller":("137B", 0.90, "openai-large judge"),
    "161B-openai-default":("147B", 0.80, "openai-large judge (Run B fresh)"),
}

CELL_RE = re.compile(
    r"=== (?P<name>\S+)\s+gen=(?P<gen>\S+)\s+\((?P<plen>\d+)B prompt, n=(?P<n>\d+)\)"
)
SAMPLE_RE = re.compile(
    r"sample (?P<i>\d+)/(?P<n>\d+)\s+script=(?P<slen>\d+)B\s+rc=(?P<rc>-?\d+)\s+found=(?P<found>True|False)\s*\n\s*tail:\s*(?P<tail>.*?)(?=\n\s*sample |\n\s*RESULT|\Z)",
    re.DOTALL,
)
RESULT_RE = re.compile(r"RESULT: (?P<icon>[✅❌])\s+(?P<verdict>PASS|FAIL)\s+\((?P<n>\d+)/(?P<tot>\d+) samples\)")


def parse(path: str) -> list[dict]:
    text = open(path).read()
    cells = []
    cell_starts = [m for m in CELL_RE.finditer(text)]
    for i, m in enumerate(cell_starts):
        end = cell_starts[i+1].start() if i+1 < len(cell_starts) else len(text)
        body = text[m.end():end]
        samples = []
        for s in SAMPLE_RE.finditer(body):
            samples.append({
                "i": int(s["i"]), "n_total": int(s["n"]),
                "script_len": int(s["slen"]),
                "rc": int(s["rc"]),
                "found": s["found"] == "True",
                "tail": s["tail"].strip()[:300],
            })
        rm = RESULT_RE.search(body)
        result = {
            "n_pass": int(rm["n"]) if rm else sum(1 for s in samples if s["found"]),
            "n_total": int(rm["tot"]) if rm else len(samples),
            "complete": rm is not None,
        }
        cells.append({
            "name": m["name"],
            "gen": m["gen"],
            "prompt_len": int(m["plen"]),
            "samples": samples,
            "result": result,
        })
    return cells


def diagnose(samples: list[dict]) -> str:
    """Try to summarize the failure mode from sample tails."""
    if not samples: return "no samples"
    tails = "\n".join(s["tail"].lower() for s in samples)
    if "invalid_api_key" in tails: return "Hit api.openai.com with pollinations key (ignored $API)"
    if "you didn't provide an api key" in tails: return "Auth header missing"
    if "enter your task" in tails: return "Interactive read loop — no stdin = no API call"
    if "task-file" in tails: return "Expects $1 as path to a task file, not the task itself"
    if "null: command not found" in tails: return "API returned null content, eval crashed"
    if "argjson" in tails: return "jq --argjson got invalid JSON (bad escaping)"
    if "extra characters" in tails or "sed:" in tails: return "BSD sed regex incompatibility"
    return "see tail"


def render(cells: list[dict]) -> str:
    by_name = {}
    for c in cells:
        by_name.setdefault(c["name"], []).append(c)
    # Order cards by prompt length (shortest first)
    order = sorted(by_name.keys(), key=lambda n: SYNTHETIC_SCORES.get(n, (str(999),0,""))[0])

    n_total = sum(c["result"]["n_total"] for c in cells)
    n_pass = sum(c["result"]["n_pass"] for c in cells)
    n_complete = sum(1 for c in cells if c["result"]["complete"])
    any_pass_overall = n_pass > 0

    headline_color = "emerald" if any_pass_overall else "rose"
    headline_text = (
        f"{n_pass}/{n_total} samples passed end-to-end" if any_pass_overall
        else "0 samples passed end-to-end — synthetic judge ≠ runtime correctness"
    )

    cards = []
    for name in order:
        ssize, sscore, snote = SYNTHETIC_SCORES.get(name, (f"{name}", 0, ""))
        prompt_text = ""
        runs = by_name[name]
        # Pull prompt from output (it follows the cell header)
        # Actually we need to capture it — embed it from the runs structure if available
        # Failure: parse() doesn't capture prompt body. Use the raw cell prompt header from re-read:
        rows = []
        for c in sorted(runs, key=lambda r: r["gen"]):
            n_p = c["result"]["n_pass"]; n_t = c["result"]["n_total"]
            verdict = "✅ PASS" if n_p > 0 else ("❌ FAIL" if c["result"]["complete"] else "⏳ RUNNING")
            color = "emerald" if n_p > 0 else ("rose" if c["result"]["complete"] else "amber")
            diag = diagnose(c["samples"])
            tail_first = (c["samples"][0]["tail"][:200] if c["samples"] else "")
            rows.append(f'''
              <div class="border-l-4 border-{color}-500 bg-{color}-50/50 rounded p-3">
                <div class="flex items-center gap-3 text-sm">
                  <span class="font-mono font-semibold">{html.escape(c["gen"])}</span>
                  <span class="text-{color}-700 font-bold">{verdict}</span>
                  <span class="text-slate-600">{n_p}/{n_t} samples</span>
                </div>
                <div class="text-xs text-slate-700 mt-1 italic">{html.escape(diag)}</div>
                <div class="text-[11px] text-slate-500 font-mono mt-1 truncate">{html.escape(tail_first)}</div>
              </div>''')
        cards.append(f'''
        <div class="bg-white rounded-xl shadow-sm p-5 mb-4">
          <div class="flex items-baseline gap-3 mb-2">
            <span class="text-2xl font-bold text-slate-800">{ssize}</span>
            <span class="text-slate-600">synthetic score {sscore:.2f}</span>
            <span class="text-xs text-slate-400 ml-auto">{html.escape(snote)}</span>
          </div>
          <div class="text-xs text-slate-500 mb-3 font-mono">{html.escape(name)}</div>
          <div class="space-y-2">{''.join(rows)}</div>
        </div>''')

    return f'''<!doctype html>
<meta charset="utf-8">
<title>E2E validation</title>
<script src="https://cdn.tailwindcss.com"></script>
<body class="bg-slate-100 min-h-screen p-8">
  <div class="max-w-4xl mx-auto">
    <h1 class="text-3xl font-bold text-slate-800 mb-1">E2E validation — does the prompt produce a working agent?</h1>
    <p class="text-slate-600 mb-4">Each candidate × generator combo: generate bash from prompt → run sandboxed against SHA256(shprout) task → check stdout for <code class="bg-slate-200 px-1 rounded">f017597f</code>.</p>

    <div class="bg-{headline_color}-500 text-white rounded-xl shadow-lg p-6 mb-6">
      <div class="text-{headline_color}-100 text-sm uppercase tracking-wide mb-1">Headline</div>
      <div class="text-2xl font-bold">{html.escape(headline_text)}</div>
      <div class="text-{headline_color}-100 text-sm mt-2">{n_complete}/{len(cells)} cells complete</div>
    </div>

    <h2 class="text-xl font-semibold text-slate-700 mb-3">Per-candidate breakdown</h2>
    {''.join(cards)}

    <div class="bg-amber-50 border-l-4 border-amber-500 rounded p-4 mt-6 text-sm text-slate-700">
      <p class="font-semibold mb-1">What this means</p>
      <p>The synthetic 9-behavior judge measured whether the generated bash <em>describes</em> the right behaviors textually. It scored these prompts 0.80–0.90. End-to-end execution shows the generated scripts often do something different at runtime: hit api.openai.com directly, expect interactive stdin, use BSD-incompatible sed, or fail to extract content. The judge optimized for textual presence, not runtime correctness.</p>
    </div>
  </div>
</body>'''


if __name__ == "__main__":
    log_path = sys.argv[1] if len(sys.argv) > 1 else (
        "/private/tmp/claude-501/-Users-thomash-Documents-GitHub-shprout/"
        "5f1cb713-f151-4abc-9e3f-ea04b704ba32/tasks/bliwhkr2z.output"
    )
    cells = parse(log_path)
    print(f"parsed {len(cells)} cells; complete={sum(1 for c in cells if c['result']['complete'])}", file=sys.stderr)
    doc = render(cells)
    out_path = "/tmp/e2e_dashboard.html"
    open(out_path, "w").write(doc)
    print(f"wrote {out_path} ({len(doc)}B)", file=sys.stderr)
    if "--show" in sys.argv:
        subprocess.run(["node", SHOW], input=doc, text=True)
