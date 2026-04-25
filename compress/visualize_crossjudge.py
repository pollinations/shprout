"""Cross-judge dashboard: Pareto frontier + cross-judge matrix + per-run breakdown.

Loads all candidates-*.jsonl and embeds the cross-judge results from bhuehfscl
to show which short candidates survive multi-judge agreement.
"""
from __future__ import annotations
import glob, json, html, os, subprocess

DIR = os.path.dirname(os.path.abspath(__file__))
SHOW = os.path.expanduser("~/.claude/skills/show/show.js")
SHPROUT = os.path.join(os.path.dirname(DIR), "shprout")
SHPROUT_BYTES = os.path.getsize(SHPROUT)
SHPROUT_LINES = sum(1 for _ in open(SHPROUT))


# Cross-judge results — the candidates re-judged across all three judges.
CROSSJUDGE = [
    {"length": 117,
     "prompt": "bash agent:read $0+$1 to p.needs K M A.loop 20:curl $API oai chat,jq .ch[0].msg.cnt,strip ```fcs,eval,app both to p",
     "scores": {"openai-large": 8, "claude-large": 8, "claude-opus-4.7": 8}},
    {"length": 119,
     "prompt": "bash agent:p=$0+$1.env KEY MODEL API.loop 20:curl $API openai chat,jq .choices[0].message.content,strip ```,eval,append",
     "scores": {"openai-large": 9, "claude-large": 7, "claude-opus-4.7": 9}},
    {"length": 122,
     "prompt": "bash agent:read $0+$1 to prompt.KEY MODEL API.loop 20:curl $API oai chat,jq .ch[0].msg.cnt,strip ```fcs,eval,app both to p",
     "scores": {"openai-large": 7, "claude-large": 8, "claude-opus-4.7": 9}},
]


def load() -> list[dict]:
    out = []
    for path in sorted(glob.glob(os.path.join(DIR, "candidates-*.jsonl"))):
        run = os.path.basename(path).replace("candidates-", "").replace(".jsonl", "")
        for line in open(path):
            line = line.strip()
            if not line: continue
            try:
                r = json.loads(line); r["_run"] = run; out.append(r)
            except Exception: pass
    return out


def pareto_front(rows: list[dict]) -> set[int]:
    front = set()
    for i, r in enumerate(rows):
        dom = False
        for j, q in enumerate(rows):
            if i == j: continue
            if q["length"] <= r["length"] and q["mean"] >= r["mean"] and (
                q["length"] < r["length"] or q["mean"] > r["mean"]
            ):
                dom = True; break
        if not dom and r["mean"] >= 0.6:
            front.add(i)
    return front


def render():
    rows = load()
    front = pareto_front(rows)

    # Per-run summary
    by_run: dict[str, list[dict]] = {}
    for r in rows: by_run.setdefault(r["_run"], []).append(r)

    run_html = []
    for run_name in sorted(by_run.keys()):
        rs = by_run[run_name]
        passing = [r for r in rs if r["mean"] >= 0.8]
        perfect = [r for r in rs if r["mean"] >= 1.0]
        shortest_passing = min((r["length"] for r in passing), default=None)
        shortest_perfect = min((r["length"] for r in perfect), default=None)
        # extract proposer/judge from name
        parts = run_name.replace("fan-", "").replace("run", "")
        run_html.append(f"""
        <div class="bg-white rounded border border-slate-200 p-3">
          <div class="font-mono text-xs text-slate-700 truncate font-semibold">{html.escape(run_name)}</div>
          <div class="flex flex-wrap gap-3 mt-1.5 text-xs">
            <span class="text-slate-500">n=<span class="font-mono font-semibold text-slate-700">{len(rs)}</span></span>
            <span class="text-slate-500">≥0.8: <span class="font-mono font-semibold text-emerald-700">{(str(shortest_passing)+'B') if shortest_passing else '—'}</span></span>
            <span class="text-slate-500">1.00: <span class="font-mono font-semibold text-emerald-700">{(str(shortest_perfect)+'B') if shortest_perfect else '—'}</span></span>
          </div>
        </div>""")

    # Cross-judge cards (the headline)
    cj_html = []
    for cj in sorted(CROSSJUDGE, key=lambda c: c["length"]):
        scores = cj["scores"]
        mn = min(scores.values())
        mean = sum(scores.values()) / len(scores)
        # color the row by minimum score (the conservative metric)
        if mn >= 8:
            border = "border-emerald-400 ring-2 ring-emerald-100"
            badge = '<span class="text-[10px] font-bold uppercase text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">All judges ≥ 0.80</span>'
        elif mn >= 7:
            border = "border-amber-300"
            badge = '<span class="text-[10px] font-bold uppercase text-amber-700 bg-amber-50 px-2 py-0.5 rounded">Mixed agreement</span>'
        else:
            border = "border-rose-300"
            badge = '<span class="text-[10px] font-bold uppercase text-rose-700 bg-rose-50 px-2 py-0.5 rounded">Single-judge bias</span>'

        score_bars = ""
        for judge, sc in scores.items():
            color = "bg-emerald-500" if sc >= 8 else ("bg-amber-500" if sc >= 7 else "bg-rose-500")
            score_bars += f'''
            <div class="flex items-center gap-2 text-xs">
              <span class="font-mono w-32 text-slate-600 truncate">{html.escape(judge)}</span>
              <div class="flex-1 h-4 bg-slate-100 rounded overflow-hidden relative">
                <div class="absolute inset-y-0 left-0 {color}" style="width:{sc*10}%"></div>
                <span class="absolute inset-0 flex items-center justify-end pr-2 font-mono font-semibold text-slate-700">{sc}/10</span>
              </div>
            </div>'''

        ratio = SHPROUT_BYTES / cj["length"]
        cj_html.append(f"""
        <div class="bg-white rounded-lg border-2 {border} p-4">
          <div class="flex items-baseline gap-3 mb-3">
            <div class="text-3xl font-bold text-slate-900 font-mono">{cj['length']}<span class="text-sm font-normal text-slate-400 ml-0.5">B</span></div>
            <div class="text-xl font-mono text-slate-600">{ratio:.2f}×</div>
            <div class="ml-auto">{badge}</div>
          </div>
          <div class="font-mono text-xs bg-slate-900 text-emerald-300 rounded p-2 mb-3 break-all">{html.escape(cj['prompt'])}</div>
          <div class="space-y-1.5">{score_bars}</div>
          <div class="flex justify-between mt-3 pt-2 border-t border-slate-100 text-xs text-slate-500">
            <span>min: <span class="font-mono font-semibold">{mn}/10</span></span>
            <span>mean: <span class="font-mono font-semibold">{mean:.1f}/10</span></span>
          </div>
        </div>""")

    # Pareto cards from raw runs
    pareto_html = []
    for i in sorted(front, key=lambda i: rows[i]["length"]):
        r = rows[i]
        score = r["mean"]
        length = r["length"]
        if score >= 1.0: bar_color = "bg-emerald-500"
        elif score >= 0.85: bar_color = "bg-emerald-400"
        elif score >= 0.7: bar_color = "bg-amber-500"
        else: bar_color = "bg-rose-400"
        ratio = SHPROUT_BYTES / length
        pareto_html.append(f"""
        <div class="bg-white rounded border border-emerald-300 p-2.5 flex items-center gap-3">
          <div class="font-mono text-base font-bold text-slate-800 w-14">{length}<span class="text-[10px] text-slate-400">B</span></div>
          <div class="font-mono text-xs text-slate-500 w-12">{ratio:.2f}×</div>
          <div class="flex items-center gap-1 w-20">
            <div class="h-2 w-12 bg-slate-100 rounded overflow-hidden"><div class="h-full {bar_color}" style="width:{score*100}%"></div></div>
            <span class="font-mono text-xs font-semibold">{score:.2f}</span>
          </div>
          <div class="flex-1 font-mono text-xs text-slate-700 truncate">{html.escape(r['prompt'])}</div>
          <div class="text-[10px] font-mono text-slate-400 w-40 truncate text-right">{html.escape(r['_run'])}</div>
        </div>""")

    # Headline stats
    n_rows = len(rows)
    n_runs = len(by_run)
    best_perfect = min((r["length"] for r in rows if r["mean"] >= 1.0), default=None)
    best_passing = min((r["length"] for r in rows if r["mean"] >= 0.8), default=None)
    best_crossjudge = min((c["length"] for c in CROSSJUDGE if min(c["scores"].values()) >= 8), default=None)

    return f"""<!doctype html>
<meta charset="utf-8">
<title>shprout / prompt compression / cross-judge</title>
<script src="https://cdn.tailwindcss.com"></script>
<body class="bg-slate-100 min-h-screen">
  <div class="max-w-5xl mx-auto p-6">

    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">shprout / prompt compression</h1>
        <p class="text-sm text-slate-600">Cross-judge agreement reveals the real Pareto frontier vs. single-judge artifacts.</p>
      </div>
      <button onclick="fetch('/submit',{{method:'POST',headers:{{'content-type':'application/json'}},body:'{{}}'}})"
              class="px-3 py-1.5 text-sm bg-slate-200 hover:bg-slate-300 rounded">close</button>
    </div>

    <div class="grid grid-cols-5 gap-3 mb-6">
      <div class="bg-slate-900 text-slate-100 rounded-lg p-4">
        <div class="text-xs text-slate-400 uppercase">shprout source</div>
        <div class="text-2xl font-bold">{SHPROUT_BYTES}<span class="text-sm font-normal text-slate-400 ml-1">B</span></div>
        <div class="text-xs text-slate-500 mt-1">{SHPROUT_LINES} lines bash</div>
      </div>
      <div class="bg-emerald-50 rounded-lg border-2 border-emerald-300 p-4">
        <div class="text-xs text-emerald-700 uppercase font-semibold">cross-judge champ</div>
        <div class="text-2xl font-bold text-emerald-900">{best_crossjudge or '—'}<span class="text-sm font-normal text-emerald-600 ml-1">B</span></div>
        <div class="text-xs text-emerald-700 mt-1">{(SHPROUT_BYTES/best_crossjudge):.2f}× verified</div>
      </div>
      <div class="bg-white rounded-lg border border-slate-200 p-4">
        <div class="text-xs text-slate-500 uppercase">single-judge ≥0.8</div>
        <div class="text-2xl font-bold text-slate-700">{best_passing or '—'}<span class="text-sm font-normal text-slate-500 ml-1">B</span></div>
        <div class="text-xs text-slate-500 mt-1">{(SHPROUT_BYTES/best_passing):.2f}×</div>
      </div>
      <div class="bg-white rounded-lg border border-slate-200 p-4">
        <div class="text-xs text-slate-500 uppercase">candidates</div>
        <div class="text-2xl font-bold">{n_rows}</div>
        <div class="text-xs text-slate-500 mt-1">{n_runs} runs</div>
      </div>
      <div class="bg-white rounded-lg border border-slate-200 p-4">
        <div class="text-xs text-slate-500 uppercase">single-judge 1.00</div>
        <div class="text-2xl font-bold">{best_perfect or '—'}<span class="text-sm font-normal text-slate-500 ml-1">B</span></div>
      </div>
    </div>

    <h2 class="text-lg font-semibold text-slate-900 mb-3">Cross-judge validation</h2>
    <p class="text-sm text-slate-600 mb-3">Each candidate re-judged by all three judges (claude-large generated the script).
       The <strong>min</strong> across judges is the honest score — anything one judge dislikes can't be called equivalent.</p>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
      {''.join(cj_html)}
    </div>

    <h2 class="text-lg font-semibold text-slate-900 mb-3">Pareto frontier (single-judge scores)</h2>
    <p class="text-sm text-slate-600 mb-3">{len(front)} prompts on the (length ↓, score ↑) frontier across all {n_runs} runs.</p>
    <div class="space-y-1.5 mb-8">
      {''.join(pareto_html)}
    </div>

    <h2 class="text-lg font-semibold text-slate-900 mb-3">Per-run summary</h2>
    <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
      {''.join(run_html)}
    </div>

  </div>
</body>
"""


def main():
    htmlstr = render()
    p = subprocess.Popen(["node", SHOW], stdin=subprocess.PIPE)
    p.communicate(htmlstr.encode())


if __name__ == "__main__":
    main()
