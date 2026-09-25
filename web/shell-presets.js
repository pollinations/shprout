// Browser presets: live repository profiles plus exact samples recovered from archive tags.
import { SEEDS, ALL_TASKS } from './seed-runtime.js';
const archive = 'archive/compress-bench-2026-07-09';
export const SHELL_SEEDS = [...SEEDS, ...[
  {
    "id": "brevity-288",
    "label": "Brevity \u00b7 single-letter variables",
    "text": "minimal golfed bash agent (under 1KB, single-letter vars): cat $0+$1 into prompt. env: OPENAI_API_KEY MODEL OPENAI_BASE_URL. loop 10: curl $OPENAI_BASE_URL/chat/completions with bearer $OPENAI_API_KEY, jq .choices[0].message.content, strip ``` fences, eval, append reply+stdout to prompt.",
    "note": "Historical generator comparison: asks for an agent under 1 KB. New generations still need to pass the checks."
  },
  {
    "id": "think-golf",
    "label": "Think, then golf",
    "text": "Think carefully about how to golf this bash to under 500 bytes. Use single-letter vars, terse loops, minimal whitespace. Then output ONLY the final bash inside one ```bash fence, no commentary, no explanation.\n\nSpec: self-reading bash agent. Reads $0+$1 into prompt. env: OPENAI_API_KEY MODEL OPENAI_BASE_URL. Loop 10: curl $OPENAI_BASE_URL/chat/completions with bearer $OPENAI_API_KEY, jq .choices[0].message.content, strip ``` fences, eval, append reply+stdout to prompt.",
    "note": "Historical generator comparison: asks the model to think before emitting a script under 500 bytes. Not a reliability guarantee."
  }
]].map(seed => ({ ...seed, origin: `${archive} · ${seed.id === 'brevity-288' || seed.id === 'think-golf' ? 'compress/results/results.json' : 'compression search → web/seed-runtime.js'}` }));
export const SHELL_AGENTS = [
  { id: 'canonical', label: 'shprout · source + state + fenced actions', url: '/shprout.txt', origin: 'unfence → codex/just-bash · shprout', note: 'Reads its source on each turn, runs the first Bash fence, remembers replies and output.' },
  { id: 'classic', label: 'Classic · command-only loop', url: '/approaches/classic.txt', origin: 'main / self-recurse → approaches/classic', note: 'The original idea: source + task, a Bash reply, eval, and cumulative history. Browser-compatible repository port.' },
  { id: 'syscap', label: 'Split prompt · capped history', url: '/approaches/syscap.txt', origin: 'archive/unfence-syscap-2026-07-09 → approaches/syscap', note: 'Source and task stay in a system message; the user message holds capped history. Browser-compatible repository port.' },
  { id: 'self-mod', label: 'Self-modifying · writable identity', url: '/approaches/self-mod.txt', origin: 'archive/self-mod-2026-07-09 → approaches/self-mod', note: 'Copies itself into .shprout/self-mod and rereads it. Later runs reuse that writable copy, including edits made by the agent.' },
  { id: 'champion', label: 'Generated · compression champion', url: '/samples/champion-386B.txt', origin: `${archive} · compress/results/champion-386B-agent.sh`, note: 'Saved output from the historical 388-byte seed. Loading it does not make a model call.' },
  { id: 'opus-v5', label: 'Generated · Opus v5 golfed loop', url: '/samples/opus-v5-564B.txt', origin: `${archive} · compress/results/polli-pipe/agent-opus-v5-564B.sh`, note: 'Exact saved polli-pipe sample: ten turns, source + task, fence stripping, reply/output logging and exit handling.' },
];
export const SHELL_TASKS = ALL_TASKS.map(task => ({ ...task,
  origin: ['portrait', 'garden'].includes(task.id) ? 'codex/just-bash · web/seed-runtime.js / TERMINAL_TASKS' : `${archive} · compress/tasks.py → web/seed-runtime.js`,
  note: task.id === 'hash8' ? 'Ported from the micro-bench: sha256sum replaces the original macOS shasum command.' : 'Editable task text passed to the selected Bash script as $1.',
}));
