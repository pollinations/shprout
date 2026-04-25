"""Side-by-side: claude-large (no hint) vs opus-4.7 + brevity hint."""
import html

SHPROUT_LEN = 910

PROMPT_CL = ("self-reading bash agent: cat $0+$1 into prompt. env: OPENAI_API_KEY MODEL "
             "OPENAI_BASE_URL. loop 10: curl $OPENAI_BASE_URL/chat/completions with bearer "
             "$OPENAI_API_KEY, jq .choices[0].message.content, strip ``` fences, eval, "
             "append reply+stdout to prompt.")

PROMPT_OP = ("minimal golfed bash agent (under 1KB, single-letter vars): cat $0+$1 into prompt. "
             "env: OPENAI_API_KEY MODEL OPENAI_BASE_URL. loop 10: curl "
             "$OPENAI_BASE_URL/chat/completions with bearer $OPENAI_API_KEY, jq "
             ".choices[0].message.content, strip ``` fences, eval, "
             "append reply+stdout to prompt.")

import os
HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "sample-claude-large-2596B.sh"))    as f: SAMPLE_CL = f.read()
with open(os.path.join(HERE, "sample-opus-4.7-brevity-395B.sh")) as f: SAMPLE_OP = f.read()

CONFIGS = [
    {
        "name": "claude-large, no brevity hint",
        "prompt": PROMPT_CL,
        "samples": [
            {"i": 1, "len": 2596, "rc": 0, "pass": True},
            {"i": 2, "len": 2620, "rc": 1, "pass": False},
            {"i": 3, "len": 3124, "rc": 0, "pass": False},
            {"i": 4, "len": 2596, "rc": 0, "pass": True},
            {"i": 5, "len": 2762, "rc": 0, "pass": True},
        ],
        "sample_script": SAMPLE_CL,
        "color": "blue",
    },
    {
        "name": "opus-4.7, brevity hint",
        "prompt": PROMPT_OP,
        "samples": [
            {"i": 1, "len": 481, "rc": 0, "pass": True},
            {"i": 2, "len": 395, "rc": 0, "pass": True},
            {"i": 3, "len": 415, "rc": 0, "pass": False},
        ],
        "sample_script": SAMPLE_OP,
        "color": "purple",
    },
]

def color_pass(pr):
    if pr >= 0.7: return "emerald"
    if pr > 0:   return "amber"
    return "rose"

def card(c):
    pr = sum(1 for s in c["samples"] if s["pass"]) / len(c["samples"])
    n_pass = sum(1 for s in c["samples"] if s["pass"])
    n_tot  = len(c["samples"])
    avg_gen = sum(s["len"] for s in c["samples"]) // n_tot
    smallest_pass = min((s["len"] for s in c["samples"] if s["pass"]), default=None)
    pc = color_pass(pr)
    rows = "".join(f"""
      <tr class="border-t border-slate-100">
        <td class="px-3 py-1.5 font-mono text-slate-700">{s['i']}</td>
        <td class="px-3 py-1.5 font-mono text-slate-700">{s['len']}B</td>
        <td class="px-3 py-1.5 font-mono text-slate-700">{s['rc']}</td>
        <td class="px-3 py-1.5"><span class="font-semibold text-{('emerald' if s['pass'] else 'rose')}-700">{'✅' if s['pass'] else '❌'}</span></td>
      </tr>""" for s in c["samples"])
    return f"""
    <div class="bg-white rounded-xl shadow-lg overflow-hidden border-t-4 border-{c['color']}-500">
      <div class="p-5 bg-{c['color']}-50">
        <div class="text-xs uppercase tracking-wide text-{c['color']}-700 font-semibold mb-1">{html.escape(c['name'])}</div>
        <div class="flex items-baseline gap-4 mt-2">
          <div>
            <div class="text-xs text-slate-500">prompt</div>
            <div class="text-2xl font-bold text-slate-900">{len(c['prompt'])}B</div>
          </div>
          <div>
            <div class="text-xs text-slate-500">avg gen</div>
            <div class="text-2xl font-bold text-slate-900">{avg_gen}B</div>
          </div>
          <div>
            <div class="text-xs text-slate-500">smallest pass</div>
            <div class="text-2xl font-bold text-slate-900">{smallest_pass or 'n/a'}{'B' if smallest_pass else ''}</div>
          </div>
          <div class="ml-auto">
            <div class="text-xs text-slate-500">e2e</div>
            <div class="text-2xl font-bold text-{pc}-700">{n_pass}/{n_tot}</div>
          </div>
        </div>
      </div>
      <div class="p-5">
        <div class="text-xs uppercase tracking-wide text-slate-500 mb-2">📝 prompt</div>
        <pre class="bg-slate-50 p-3 rounded text-xs font-mono whitespace-pre-wrap break-words text-slate-800 mb-4">{html.escape(c['prompt'])}</pre>

        <div class="text-xs uppercase tracking-wide text-slate-500 mb-2">🎲 samples</div>
        <table class="w-full text-xs mb-4">
          <thead class="bg-slate-50 text-slate-500"><tr>
            <th class="px-3 py-1.5 text-left">#</th>
            <th class="px-3 py-1.5 text-left">size</th>
            <th class="px-3 py-1.5 text-left">rc</th>
            <th class="px-3 py-1.5 text-left">e2e</th>
          </tr></thead>
          <tbody>{rows}</tbody>
        </table>

        <div class="text-xs uppercase tracking-wide text-slate-500 mb-2">📜 sample passing script ({len(c['sample_script'])}B)</div>
        <pre class="bg-slate-900 text-slate-100 p-3 rounded text-xs font-mono whitespace-pre overflow-x-auto" style="max-height: 350px;">{html.escape(c['sample_script'])}</pre>
      </div>
    </div>
    """

DOC = f"""<!doctype html>
<meta charset="utf-8">
<title>shprout compression — gen comparison</title>
<script src="https://cdn.tailwindcss.com"></script>
<body class="bg-slate-100 min-h-screen p-8">
  <div class="max-w-7xl mx-auto">
    <h1 class="text-3xl font-bold text-slate-800 mb-1">shprout compression — gen model comparison</h1>
    <p class="text-slate-600 mb-2 text-sm">Same task (SHA256 of "shprout" → <code class="bg-slate-200 px-1 rounded">f017597f</code>),
       same runtime (claude). Different prompt + different generator.</p>

    <div class="bg-emerald-500 text-white rounded-xl shadow-lg p-6 mb-6">
      <div class="text-emerald-100 text-xs uppercase tracking-wide mb-1">Headline</div>
      <div class="text-2xl font-bold">opus-4.7 + brevity hint produces 395B passing bash</div>
      <div class="text-emerald-100 text-sm mt-2">vs shprout's 910B → 2.30× smaller decompressed agent.
         Plus a 288B prompt → total artifact (prompt + bash) = 683B vs shipping shprout (910B).</div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      {''.join(card(c) for c in CONFIGS)}
    </div>

    <div class="bg-white rounded-xl shadow p-5 mb-6">
      <h3 class="text-sm font-semibold text-slate-700 mb-3">📐 sizes at a glance</h3>
      <div class="space-y-2 text-xs font-mono">
        <div class="flex items-center gap-3">
          <span class="w-48 text-slate-500">opus-4.7 smallest pass</span>
          <div class="bg-purple-500 h-6" style="width: {395/3124*100:.1f}%"></div>
          <span class="text-slate-700">395B (0.43× shprout)</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="w-48 text-slate-500">opus-4.7 prompt</span>
          <div class="bg-purple-300 h-6" style="width: {288/3124*100:.1f}%"></div>
          <span class="text-slate-700">288B</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="w-48 text-slate-500">claude-large prompt</span>
          <div class="bg-blue-300 h-6" style="width: {254/3124*100:.1f}%"></div>
          <span class="text-slate-700">254B</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="w-48 text-slate-500">shprout (reference)</span>
          <div class="bg-emerald-500 h-6" style="width: {SHPROUT_LEN/3124*100:.1f}%"></div>
          <span class="text-slate-700">{SHPROUT_LEN}B</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="w-48 text-slate-500">claude-large avg gen</span>
          <div class="bg-blue-500 h-6" style="width: {2740/3124*100:.1f}%"></div>
          <span class="text-slate-700">~2740B (3.0× shprout)</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="w-48 text-slate-500">claude-large worst sample</span>
          <div class="bg-blue-700 h-6" style="width: 100%"></div>
          <span class="text-slate-700">3124B</span>
        </div>
      </div>
    </div>

    <div class="bg-slate-200/60 rounded p-4 text-xs text-slate-700 font-mono">
      <div>runtime model: claude (1 loop typically suffices for the SHA256 task)</div>
      <div>shprout reference: {SHPROUT_LEN}B (OPENAI_API_KEY/MODEL/OPENAI_BASE_URL, loop bound 10)</div>
      <div>brevity hint added: "minimal golfed bash agent (under 1KB, single-letter vars)" (+34B)</div>
      <div>opus-4.7 actually GOLFS when asked. claude-large defaults to verbose enterprise bash regardless of prompt brevity.</div>
    </div>
  </div>
</body>"""

print(DOC)
