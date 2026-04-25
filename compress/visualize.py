"""Render candidates.jsonl as an HTML dashboard via the `show` skill.

Sorts candidates by length (ascending) within score tier, marks Pareto-optimal
points, shows the prompt text inline, and lets you click to expand the sample.
"""
from __future__ import annotations
import json, html, os, subprocess, sys

LOG = os.path.join(os.path.dirname(__file__), "candidates.jsonl")
SHOW = os.path.expanduser("~/.claude/skills/show/show.js")
SHPROUT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "shprout")
SHPROUT_BYTES = os.path.getsize(SHPROUT) if os.path.exists(SHPROUT) else 0
SHPROUT_LINES = sum(1 for _ in open(SHPROUT)) if os.path.exists(SHPROUT) else 0


def load() -> list[dict]:
    if not os.path.exists(LOG):
        return []
    out = []
    with open(LOG) as f:
        for line in f:
            line = line.strip()
            if line:
                try: out.append(json.loads(line))
                except Exception: pass
    return out


def pareto_front(rows: list[dict]) -> set[int]:
    """Indices on the (min length, max score) frontier."""
    front = set()
    for i, r in enumerate(rows):
        dominated = False
        for j, q in enumerate(rows):
            if i == j: continue
            if q["length"] <= r["length"] and q["mean"] >= r["mean"] and (
                q["length"] < r["length"] or q["mean"] > r["mean"]
            ):
                dominated = True; break
        if not dominated:
            front.add(i)
    return front


def render(rows: list[dict]) -> str:
    front = pareto_front(rows)
    # sort: pareto first, then by score desc, then length asc
    order = sorted(range(len(rows)),
                   key=lambda i: (i not in front, -rows[i]["mean"], rows[i]["length"]))

    cards = []
    for rank, i in enumerate(order):
        r = rows[i]
        on_front = i in front
        score = r["mean"]
        length = r["length"]
        scores = r["scores"]
        prompt = r["prompt"]
        sample = r.get("sample", "")
        verdicts = r.get("verdicts", [])
        missing = r.get("missing", [])
        it = r.get("iter", "?")

        # color by score
        if score >= 0.85: bar_color = "bg-emerald-500"
        elif score >= 0.6: bar_color = "bg-amber-500"
        elif score >= 0.3: bar_color = "bg-orange-500"
        else: bar_color = "bg-rose-500"

        sample_lines = sample.count("\n") + 1
        sample_chars = len(sample)

        cards.append(f"""
        <div class="bg-white rounded-lg shadow-sm border {'border-emerald-400 ring-2 ring-emerald-200' if on_front else 'border-slate-200'} overflow-hidden">
          <div class="flex items-stretch">
            <div class="px-3 py-3 bg-slate-50 border-r border-slate-200 flex flex-col items-center justify-center min-w-[4rem]">
              <div class="text-xs text-slate-400 uppercase tracking-wide">iter</div>
              <div class="text-lg font-bold text-slate-700">{it}</div>
              {('<div class="text-[10px] text-emerald-600 font-semibold mt-1">PARETO</div>' if on_front else '')}
            </div>
            <div class="flex-1 p-3 min-w-0">
              <div class="flex items-baseline gap-3 mb-2">
                <div class="text-xs text-slate-500">len</div>
                <div class="font-mono text-sm font-semibold">{length}<span class="text-slate-400 font-normal text-xs ml-0.5">B</span></div>
                <div class="text-[10px] text-slate-400">{(length/SHPROUT_BYTES*100):.0f}% of source</div>
                <div class="text-xs text-slate-500 ml-2">score</div>
                <div class="font-mono text-sm font-semibold">{score:.2f}</div>
                <div class="flex gap-1 ml-2">
                  {''.join(f'<span class="inline-block w-6 h-3 rounded-sm {bar_color} opacity-{int(s*10)*10 or 10}" title="sample {idx}: {s}/10"></span>' for idx, s in enumerate(scores))}
                </div>
                <div class="text-xs text-slate-400 ml-2">{', '.join(verdicts)}</div>
              </div>
              <div class="relative h-1.5 bg-slate-100 rounded mb-2 overflow-hidden">
                <div class="absolute inset-y-0 left-0 {bar_color} opacity-70" style="width:{min(100, length/SHPROUT_BYTES*100):.1f}%"></div>
                <div class="absolute inset-y-0 border-l-2 border-slate-400" style="left:100%; transform:translateX(-1px)" title="shprout source = {SHPROUT_BYTES}B"></div>
              </div>
              <div class="font-mono text-xs text-slate-700 whitespace-pre-wrap break-words bg-slate-50 rounded px-2 py-1.5 mb-2">{html.escape(prompt)}</div>
              <details class="text-xs text-slate-600">
                <summary class="cursor-pointer hover:text-slate-900">generated sample ({sample_lines} lines, {sample_chars} chars){' — missing: ' + ', '.join(missing[:3]) if missing else ''}</summary>
                <pre class="mt-2 bg-slate-900 text-slate-100 rounded p-2 overflow-x-auto text-[11px] leading-tight"><code>{html.escape(sample)}</code></pre>
              </details>
            </div>
          </div>
        </div>
        """)

    if not rows:
        body_inner = '<div class="text-center text-slate-500 py-12">No candidates yet. Run <code>uv run python search.py</code>.</div>'
    else:
        body_inner = "\n".join(cards)

    # summary stats
    if rows:
        best_score = max(r["mean"] for r in rows)
        shortest_passing = min((r["length"] for r in rows if r["mean"] >= 0.7), default=None)
        n_candidates = len(rows)
        n_pareto = len(front)
        ratio = (shortest_passing / SHPROUT_BYTES * 100) if (shortest_passing and SHPROUT_BYTES) else None
        ratio_str = f"{ratio:.0f}%" if ratio is not None else "—"
        summary = f"""
        <div class="grid grid-cols-5 gap-3 mb-6">
          <div class="bg-slate-900 text-slate-100 rounded-lg p-4">
            <div class="text-xs text-slate-400 uppercase">shprout source</div>
            <div class="text-2xl font-bold">{SHPROUT_BYTES}<span class="text-sm font-normal text-slate-400 ml-1">B</span></div>
            <div class="text-xs text-slate-500 mt-1">{SHPROUT_LINES} lines</div>
          </div>
          <div class="bg-white rounded-lg border border-slate-200 p-4"><div class="text-xs text-slate-500 uppercase">candidates</div><div class="text-2xl font-bold">{n_candidates}</div></div>
          <div class="bg-white rounded-lg border border-slate-200 p-4"><div class="text-xs text-slate-500 uppercase">on Pareto</div><div class="text-2xl font-bold">{n_pareto}</div></div>
          <div class="bg-white rounded-lg border border-slate-200 p-4"><div class="text-xs text-slate-500 uppercase">best score</div><div class="text-2xl font-bold">{best_score:.2f}</div></div>
          <div class="bg-emerald-50 rounded-lg border border-emerald-200 p-4">
            <div class="text-xs text-emerald-700 uppercase">shortest @ ≥0.7</div>
            <div class="text-2xl font-bold text-emerald-900">{shortest_passing or '—'}<span class="text-sm font-normal text-emerald-600 ml-1">B</span></div>
            <div class="text-xs text-emerald-700 mt-1">{ratio_str} of source</div>
          </div>
        </div>
        """
    else:
        summary = ""

    return f"""<!doctype html>
<meta charset="utf-8">
<title>shprout / prompt compression</title>
<script src="https://cdn.tailwindcss.com"></script>
<body class="bg-slate-100 min-h-screen">
  <div class="max-w-5xl mx-auto p-6">
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">shprout / prompt compression</h1>
        <p class="text-sm text-slate-600 mt-1">candidates ranked by Pareto position (length ↓, score ↑). emerald = on the frontier.</p>
      </div>
      <button onclick="fetch('/submit',{{method:'POST',headers:{{'content-type':'application/json'}},body:'{{}}'}});" class="px-3 py-1.5 text-sm bg-slate-200 hover:bg-slate-300 rounded">close</button>
    </div>
    {summary}
    <div class="space-y-2">
      {body_inner}
    </div>
  </div>
</body>
"""


def main():
    rows = load()
    htmlstr = render(rows)
    p = subprocess.Popen(["node", SHOW], stdin=subprocess.PIPE)
    p.communicate(htmlstr.encode())


if __name__ == "__main__":
    main()
