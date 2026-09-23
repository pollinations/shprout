// Browser-portable core for the two-layer compression demo:
// a tiny natural-language seed is decompressed by a model into a bash agent,
// the agent is verified by a deterministic gate, then mounted and run in just-bash.
import { POLLI_BASE, POLLI_ENDPOINT, WORKSPACE_ROOT } from './workshop-runtime.js';

export const GEN_MODEL = 'claude-large';
export const RUN_MODEL = 'claude-large';
export const AGENT_PATH = `${WORKSPACE_ROOT}/agent`;
export const SELF_PATH = `${WORKSPACE_ROOT}/.self`;
export const RUNTIME_NOTE = 'just-bash 3.4.2 in a browser; persistent virtual files; built-in shell commands only (no shasum: use sha256sum); no Node, npm, Python, native binaries, or unrestricted network';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SEEDS = [
  {
    id: 'champion-386',
    label: '388 B champion',
    note: 'The shortest seed that regenerated a gate-passing agent (1 of 2 samples, 2026-07-05). Regrowing is expected sometimes.',
    expect: 'flaky',
    text: 'Bash self-prompting agent. Env: OPENAI_API_KEY MODEL OPENAI_BASE_URL. prompt=$(<$0)+task $1. Loop ≤20: curl POST {model:$MODEL,messages:[{role:user,content:prompt}]} to $OPENAI_BASE_URL/chat/completions, header Authorization: Bearer $OPENAI_API_KEY; reply=$(jq -r .choices[0].message.content); strip ``` fences; break if reply empty or =="exit"; eval reply, catch out; append reply+out.',
  },
  {
    id: 'reliable-396',
    label: '398 B reliable',
    note: 'Both of two historical samples passed (2026-07-05). This is a small sample, not a guarantee for a new generation.',
    expect: 'pass',
    text: 'Bash self-prompting agent. Env: OPENAI_API_KEY MODEL OPENAI_BASE_URL. prompt=$(<$0)+task $1. Loop ≤20: curl POST {model:$MODEL,messages:[{role:user,content:prompt}]} to $OPENAI_BASE_URL/chat/completions, header Authorization: Bearer $OPENAI_API_KEY; reply=$(jq -r .choices[0].message.content); strip ``` fences; break if reply empty or =="exit"; eval reply, catch out; append reply+out to prompt.',
  },
  {
    id: 'anchor-517',
    label: '517 B anchor',
    note: 'The starting prompt of the historical search. Both recorded samples passed; new generations can differ.',
    expect: 'pass',
    text: "Write a bash script: self-reading LLM agent. Env vars OPENAI_API_KEY, MODEL, OPENAI_BASE_URL (fail fast if unset). Build prompt = own source ($(<$0)) + task ($1). Loop 10 times: POST {model:$MODEL,messages:[{role:user,content:prompt}]} to $OPENAI_BASE_URL/chat/completions with bearer $OPENAI_API_KEY via curl, extract .choices[0].message.content with jq -r, if reply contains ``` keep only fenced lines, break if reply empty or 'exit', print reply, eval it capturing stdout+stderr, append reply and output to prompt.",
  },
  {
    id: 'terse-254',
    label: '254 B terse',
    note: 'A shorter historical candidate. Generate a new sample to measure whether it preserves the loop and history.',
    expect: 'fail',
    text: 'self-reading bash agent: cat $0+$1 into prompt. env: OPENAI_API_KEY MODEL OPENAI_BASE_URL. loop 10: curl $OPENAI_BASE_URL/chat/completions with bearer $OPENAI_API_KEY, jq .choices[0].message.content, strip ``` fences, eval, append reply+stdout to prompt.',
  },
  {
    id: 'floor-147',
    label: '147 B floor',
    note: 'A very short historical candidate. Its length alone does not tell us whether a new sample will work.',
    expect: 'fail',
    text: 'bash agent:cat $0+$1 to prompt.loop 20:curl OpenAI chat($OPENAI_API_KEY,$OPENAI_BASE_URL),jq .choices[0].message.content,strip```fences,eval,append',
  },
];

export function utf8Bytes(text) {
  return encoder.encode(String(text ?? '')).length;
}

export function formatBytes(count) {
  return `${Number(count).toLocaleString('en-US')} B`;
}

// Layer 1: the whole request is the seed, verbatim, as one user message.
// These settings are recorded for comparison; providers can still return different outputs.
export function decompressionBody({ seed, model = GEN_MODEL, attempt = 1 }) {
  return {
    model,
    messages: [{ role: 'user', content: seed }],
    temperature: 0,
    seed: attempt,
  };
}

export function extractFence(text) {
  const raw = String(text ?? '');
  const match = raw.match(/```[^\n]*\n([\s\S]*?)\n```/);
  const code = (match ? match[1] : raw).replace(/^\s*\n/, '').trimEnd();
  return { code: `${code}\n`, fenced: Boolean(match) };
}

export function completionContent(bytes) {
  try {
    const content = JSON.parse(decoder.decode(bytes)).choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : undefined;
  } catch {
    return undefined;
  }
}

export async function decompress({ fetch, seed, model = GEN_MODEL, attempt = 1 }) {
  const body = decompressionBody({ seed, model, attempt });
  const response = await fetch(POLLI_ENDPOINT, { method: 'POST', body: JSON.stringify(body) });
  const content = completionContent(response.body);
  if (response.status !== 200 || content === undefined) {
    throw new Error(`Decompression failed: HTTP ${response.status}`);
  }
  const { code, fenced } = extractFence(content);
  return { content, code, fenced, bytes: utf8Bytes(code), attempt };
}

// Deterministic gate. Tier 0 looks at the text; tier 1 runs the agent against a
// scripted model whose replies carry computed values, so only an agent that really
// evals the fence and keeps cumulative history can echo them back.
export const GATE_TASK = 'purpose-marker-a7x: print hello';
export const GATE_REPLIES = [
  '```bash\necho A1-$((6*7))\n```',
  "```bash\nprintf 'B2-%s\\n' ok\n```",
  'exit',
];
export const GATE_CHECKS = [
  { id: 'env', tier: 0, label: 'reads OPENAI_API_KEY and OPENAI_BASE_URL' },
  { id: 'self', tier: 0, label: 'reads its own source through $0' },
  { id: 'curl', tier: 0, label: 'speaks HTTP with curl' },
  { id: 'endpoint', tier: 0, label: 'targets chat/completions' },
  { id: 'eval', tier: 0, label: 'evals what the model says' },
  { id: 'loop', tier: 0, label: 'loops' },
  { id: 'size', tier: 0, label: 'stays under 4 KB' },
  { id: 'calls', tier: 1, label: 'reaches the model' },
  { id: 'task', tier: 1, label: 'the task is in the first prompt' },
  { id: 'exec', tier: 1, label: 'turn 2 carries A1-42, so the fence really ran' },
  { id: 'history', tier: 1, label: 'turn 3 carries both A1-42 and B2-ok, so history accumulates' },
  { id: 'exit', tier: 1, label: 'stops on exit after exactly 3 calls' },
];

export function tier0(source) {
  const text = String(source ?? '');
  const results = {
    env: text.includes('OPENAI_API_KEY') && text.includes('OPENAI_BASE_URL'),
    self: text.includes('$0'),
    curl: text.includes('curl'),
    endpoint: text.includes('chat/completions'),
    eval: /\beval\b/.test(text),
    loop: /\b(for|while|until)\b/.test(text),
    size: utf8Bytes(text) > 0 && utf8Bytes(text) < 4096,
  };
  const checks = GATE_CHECKS.filter(check => check.tier === 0).map(check => ({ ...check, ok: results[check.id] }));
  return { pass: checks.every(check => check.ok), checks };
}

export function createScriptedFetch({ replies, onEvent = () => {}, delayMs = 0, maxCalls = 40 }) {
  const requests = [];
  let stopped = false;
  const fetch = async (url, options = {}) => {
    if (url !== POLLI_ENDPOINT) throw new Error(`Network denied: ${url}`);
    if ((options.method || 'GET').toUpperCase() !== 'POST') throw new Error(`Method denied: ${options.method || 'GET'}`);
    if (stopped) throw new DOMException('Stopped', 'AbortError');
    if (requests.length >= maxCalls) throw new Error(`Scripted model exhausted after ${maxCalls} calls`);
    let body;
    let malformed = false;
    try {
      body = JSON.parse(options.body ?? '');
    } catch {
      malformed = true;
    }
    requests.push({ body, malformed, raw: String(options.body ?? '') });
    onEvent({ type: 'request', index: requests.length - 1 });
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    if (stopped) throw new DOMException('Stopped', 'AbortError');
    if (malformed) {
      onEvent({ type: 'error', message: 'Request body was not JSON' });
      return respond(400, { error: { message: 'request body is not valid JSON' } }, url);
    }
    const content = replies[Math.min(requests.length - 1, replies.length - 1)];
    onEvent({ type: 'response', content, index: requests.length - 1 });
    return respond(200, { choices: [{ message: { content } }] }, url);
  };
  return {
    fetch,
    requests,
    abort() { stopped = true; },
    reset() { requests.length = 0; stopped = false; },
  };
}

function respond(status, payload, url) {
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Bad Request',
    headers: { 'content-type': 'application/json' },
    body: encoder.encode(JSON.stringify(payload)),
    url,
  };
}

export function mountAgent(Bash, { source, fetch, selfImage = 'code', seed = '', model = RUN_MODEL, files = {}, env = {} }) {
  let mounted = String(source);
  let swapped = 0;
  if (selfImage !== 'code') {
    const result = applySelfImage(mounted);
    mounted = result.source;
    swapped = result.matches;
  }
  const runtimeFiles = {
    [AGENT_PATH]: mounted,
    [`${WORKSPACE_ROOT}/.shprout/.keep`]: '',
    ...files,
  };
  const runtimeEnv = {
    OPENAI_API_KEY: 'managed-by-browser',
    OPENAI_BASE_URL: POLLI_BASE,
    MODEL: model,
    SHPROUT_RUNTIME: RUNTIME_NOTE,
    ...env,
  };
  if (selfImage !== 'code') {
    runtimeFiles[SELF_PATH] = selfImage === 'seed' ? seed : '(source withheld for this run)';
    runtimeEnv.SHPROUT_SELF = SELF_PATH;
  }
  const bash = new Bash({
    files: runtimeFiles,
    cwd: WORKSPACE_ROOT,
    env: runtimeEnv,
    fetch,
    executionLimits: { maxCommandCount: 20000, maxLoopIterations: 20000 },
  });
  return { bash, swapped, source: mounted };
}

// Layer 2 experiment: let the harness show the model something other than its own code.
// The swap keeps $0 as the fallback, so the agent still works when SHPROUT_SELF is unset.
export function applySelfImage(source) {
  let matches = 0;
  const swapped = String(source)
    .replace(/\$\(\s*<\s*"?\$0"?\s*\)/g, () => { matches += 1; return '$(<"${SHPROUT_SELF:-$0}")'; })
    .replace(/\bcat\s+(?:--\s+)?"?\$0"?/g, () => { matches += 1; return 'cat "${SHPROUT_SELF:-$0}"'; });
  return { source: swapped, matches };
}

export function requestText(request) {
  return JSON.stringify(request?.body?.messages ?? request?.body ?? request?.raw ?? '');
}

export async function runGate(Bash, source, { timeoutMs = 20000, onEvent = () => {} } = {}) {
  const started = Date.now();
  const static_ = tier0(source);
  const scripted = createScriptedFetch({ replies: GATE_REPLIES, onEvent, maxCalls: 12 });
  const { bash } = mountAgent(Bash, { source, fetch: scripted.fetch, model: 'gate-model' });
  let result = { stdout: '', stderr: '', exitCode: -1 };
  let crashed = '';
  try {
    result = await bash.exec(`bash ${AGENT_PATH} '${GATE_TASK}'`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    crashed = error?.message || String(error);
  }
  const requests = scripted.requests;
  const calls = requests.length;
  const at = index => requestText(requests[index]);
  const fails = [];
  const dynamic = {
    calls: calls > 0,
    task: calls > 0 && at(0).includes(GATE_TASK),
    exec: calls > 1 && at(1).includes('A1-42'),
    history: calls > 2 && at(2).includes('B2-ok') && at(2).includes('A1-42'),
    exit: calls === 3,
  };
  if (crashed) fails.push(`crashed: ${crashed}`);
  if (requests.some(request => request.malformed)) fails.push('request-not-json');
  if (calls === 0) fails.push('no-api-call');
  else {
    if (!dynamic.task) fails.push('task-not-in-prompt');
    if (calls < 2) fails.push('died-after-turn-1');
    else if (!dynamic.exec) fails.push('no-eval-or-no-history');
    if (calls >= 2 && calls < 3) fails.push('died-after-turn-2');
    else if (calls >= 3 && !dynamic.history) fails.push('history-not-cumulative');
    if (calls > 3) fails.push(`no-termination (${calls - 3} extra call${calls - 3 === 1 ? '' : 's'})`);
  }
  for (const check of static_.checks) if (!check.ok) fails.push(`missing:${check.id}`);
  const checks = [
    ...static_.checks,
    ...GATE_CHECKS.filter(check => check.tier === 1).map(check => ({ ...check, ok: dynamic[check.id] })),
  ];
  return {
    pass: fails.length === 0,
    fails,
    checks,
    calls,
    requests,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    ms: Date.now() - started,
  };
}

// Micro-bench tasks: small, deterministic, checkable from files + output alone.
export const TASKS = [
  {
    id: 'grepcount',
    label: 'Count the sevens',
    prompt: 'Using seq and grep, print how many integers from 1 to 999 contain the digit 7. Print just the number. Then say exit.',
    expect: '271 printed',
    check: ({ output }) => output.includes('271'),
  },
  {
    id: 'arith',
    label: 'Multiply',
    prompt: 'Use a bash command to compute 1234*5678 and print the result. Then say exit.',
    expect: '7006652 printed',
    check: ({ output }) => output.includes('7006652'),
  },
  {
    id: 'mkfile',
    label: 'Write a file',
    prompt: 'Create a file named hello.txt in the current directory containing exactly the text: hello shprout. Then say exit.',
    expect: 'hello.txt == "hello shprout"',
    check: ({ files }) => (files.get('hello.txt') ?? '').trim() === 'hello shprout',
  },
  {
    id: 'multistep',
    label: 'Three steps',
    prompt: 'Create a directory named out. Write out/a.txt containing the word alpha and out/b.txt containing the word beta. Concatenate both files into out/ab.txt. Then say exit.',
    expect: 'out/ab.txt has alpha and beta',
    check: ({ files }) => {
      const text = files.get('out/ab.txt') ?? '';
      return text.includes('alpha') && text.includes('beta');
    },
  },
  {
    id: 'recover',
    label: 'Recover from an error',
    prompt: 'Run the command frobnicate99 --go (it does not exist). Observe the error, then print the single word RECOVERED and say exit.',
    expect: 'RECOVERED printed after the failure',
    check: ({ output }) => output.includes('RECOVERED'),
  },
  {
    id: 'hash8',
    label: 'Hash a string',
    prompt: 'Print the first 8 hex chars of the sha256 of the exact string shprout with no trailing newline: use printf %s shprout | sha256sum. Then say exit.',
    expect: 'f017597f printed',
    check: ({ output }) => output.includes('f017597f'),
  },
];

// Terminal tasks have a bounded finish, without claiming an objective art score.
export const TERMINAL_TASKS = [
  {
    id: 'portrait',
    label: 'Draw your own agent loop',
    prompt: 'Read your actual source at $0. Use one Bash command to print a compact ASCII self-portrait explaining source + task -> model -> Bash -> output -> next request. Include your measured source byte count using wc -c, not a guess. Keep the portrait under 25 lines and 64 columns; no ANSI escapes or animation. After printing this one portrait, reply exactly exit. Do not revise it or continue improving it.',
    expect: 'a self-portrait in the terminal',
    check: () => null,
  },
  {
    id: 'garden',
    label: 'Plant a terminal garden',
    prompt: 'Use Bash to print one small ASCII garden with a sprout, roots, soil and a sun, followed by a short poem about a tiny program growing from a prompt. Keep it under 25 lines and 64 columns; no ANSI escapes, sleep, or animation. Print it once, then reply exactly exit. Do not revise it.',
    expect: 'a garden in the terminal',
    check: () => null,
  },
];

export const ALL_TASKS = [...TERMINAL_TASKS, ...TASKS];

export function taskById(id) {
  return ALL_TASKS.find(task => task.id === id) ?? ALL_TASKS[0];
}

// A task typed by the person. There is no automatic check, so runTask reports
// pass: null and the person judges the output.
export const CUSTOM_TASK_ID = 'custom';
export function customTask(prompt) {
  const text = String(prompt ?? '').trim();
  return { id: CUSTOM_TASK_ID, label: 'Your task', prompt: text, expect: 'whatever you asked for', check: () => null, custom: true };
}

export function isAgentWorkspacePath(path) {
  if (!path.startsWith(`${WORKSPACE_ROOT}/`)) return false;
  const relative = path.slice(WORKSPACE_ROOT.length + 1);
  return relative !== 'agent' && relative !== '.self' && relative !== '.shprout/.keep';
}

export async function readWorkspace(bash) {
  const paths = bash.fs.getAllPaths().filter(isAgentWorkspacePath).sort();
  const entries = await Promise.all(paths.map(async path => {
    try {
      const stat = await bash.fs.stat(path);
      if (!stat.isFile) return null;
      return [path.slice(WORKSPACE_ROOT.length + 1), await bash.readFile(path)];
    } catch {
      return null;
    }
  }));
  return new Map(entries.filter(Boolean));
}

// When the model's replies are known, the check sees the output with those lines
// removed, so the agent has to have run something rather than quoted the answer.
export async function runTask(bash, task, { signal, env, replies } = {}) {
  const started = Date.now();
  const quoted = `'${task.prompt.replaceAll("'", "'\\''")}'`;
  const result = await bash.exec(`bash ${AGENT_PATH} ${quoted}`, { signal, env });
  const files = await readWorkspace(bash);
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const checked = replies ? scrubReplies(output, replies) : output;
  const verdict = task.check({ files, output: checked });
  return {
    ...result,
    output,
    files,
    pass: verdict === null ? null : Boolean(verdict),
    ms: Date.now() - started,
  };
}

// Agents echo the reply before running it, and the shell quotes a prose line back
// as "bash: word: command not found", so both forms of "the model said it" go.
export function scrubReplies(output, replies) {
  const said = new Set((replies ?? []).flatMap(reply => String(reply ?? '').split('\n')).map(line => line.trim()).filter(Boolean));
  const firstWords = new Set([...said].map(line => line.split(/\s+/)[0]));
  const quoted = line => {
    const text = line.trim().replace(/^>\s?/, '').trim();
    const complaint = text.match(/^(?:\S+: )?(.+): command not found$/);
    return complaint ? said.has(complaint[1]) || firstWords.has(complaint[1]) : said.has(text);
  };
  return String(output ?? '').split('\n').filter(line => !quoted(line)).join('\n');
}

// What the agent will run. Fenced code is the action and the text before it the
// thought; every agent here evals a bare reply as-is, so a bare reply is the action
// too, unless it is the stop word.
export function replyParts(content) {
  const text = String(content ?? '');
  const fence = text.match(/```[^\n]*\n([\s\S]*?)(?:\n```|$)/);
  if (fence) return { thought: text.slice(0, fence.index).trim(), action: fence[1].trim() };
  const bare = text.trim();
  if (!bare || /^exit\.?$/i.test(bare)) return { thought: bare, action: '' };
  return { thought: '', action: bare };
}

// The next request carries the previous reply and what the shell printed, appended
// to the prompt in whatever format the generated script invented. The champion
// marks it OUTPUT (rc=N):, the hand-written shprout --- bash ---; otherwise the
// shell's answer is whatever follows the reply, minus one label line such as
// "=== TURN 3 OUTPUT ===" or "--- output ---", and minus an "[exit status N]" trailer.
const OUTPUT_LABEL = /^[\s=\-#*>\[]*(?:turn\s*\d+\s*)?(?:output|result|stdout|shell|bash|tool|response)\b[^\n]{0,40}$/i;
const EXIT_TRAILER = /^\[?\s*(?:exit(?: status| code)?|rc|status)[:= ]+(\d+)\s*\]?$/i;

export function outputFromAppended(appended, reply) {
  const chunk = String(appended ?? '');
  let match = chunk.match(/OUTPUT \(rc=(\d+)\):\n?([\s\S]*)$/);
  if (match) return { rc: match[1], out: trimBlankLines(match[2]) };
  match = chunk.match(/--- bash ---\n?([\s\S]*)$/);
  if (match) return { rc: null, out: trimBlankLines(match[1]) };

  const said = String(reply ?? '');
  const variants = [...new Set([said.trim(), replyParts(said).action, said.replace(/^[ \t]*```[^\n]*$/gm, '').trim()])].filter(Boolean);
  let rest = null;
  for (const variant of variants) {
    const at = chunk.indexOf(variant);
    if (at < 0) continue;
    const candidate = chunk.slice(at + variant.length);
    if (rest === null || candidate.length < rest.length) rest = candidate;
  }
  if (rest === null) {
    // The script reformatted the reply: drop its lines and any label lines instead.
    const lines = new Set(said.split('\n').map(line => line.trim()).filter(Boolean));
    rest = chunk.split('\n').filter(line => line.trim() && !lines.has(line.trim()) && !OUTPUT_LABEL.test(line) && !/^(ASSISTANT:|--- you ---)/.test(line.trim())).join('\n');
  }

  const lines = rest.split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length && OUTPUT_LABEL.test(lines[0])) lines.shift();
  if (lines.length && /^\s*```/.test(lines[0])) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  if (lines.length && /^\s*```\s*$/.test(lines.at(-1))) lines.pop();
  let rc = null;
  const trailer = lines.length ? lines.at(-1).match(EXIT_TRAILER) : null;
  if (trailer) {
    rc = trailer[1];
    lines.pop();
  }
  return { rc, out: trimBlankLines(lines.join('\n')) };
}

// Keeps the first line's indentation (box art depends on it); drops blank edges.
function trimBlankLines(text) {
  return String(text ?? '').replace(/^(?:[ \t]*\n)+/, '').trimEnd();
}

// The hand-written agent is the control lane: same gate, same tasks, no seed.
export const CONTROL = { id: 'handwritten-1599', label: 'hand-written', path: '/shprout.txt', control: true };
export const RUN_CAP = { calls: 8, ms: 90000 };

// What just-bash 3.4.2 prints for each thing a real shell would have accepted.
// `probe` is the command that produced the message; the test suite replays it.
export const SANDBOX_LIMITS = [
  { test: /curl: invalid option -- 'N'/, what: 'curl -N (streaming) is not supported in this shell', probe: 'curl -N -sS -d x https://gen.pollinations.ai/v1/chat/completions' },
  { test: /curl: \(\d+\) ENOENT: no such file or directory, open '[^']*\/-'/, what: 'curl -d @- (body from stdin) is not supported in this shell', probe: 'echo x | curl -sS -d @- https://gen.pollinations.ai/v1/chat/completions' },
  { test: /\bshasum: command not found/, what: 'shasum is missing; use sha256sum', probe: 'printf %s shprout | shasum -a 256' },
  { test: /jq: error: Unknown function: input\b/, what: 'jq input is not supported in this shell', probe: 'echo "{}" | jq -n input' },
  { test: /bash: -n: No such file or directory/, what: 'bash -n (syntax check) is not supported in this shell', probe: `bash -n ${AGENT_PATH}` },
];

export function classifySandboxLimit(stderr) {
  const text = String(stderr ?? '');
  return SANDBOX_LIMITS.find(limit => limit.test.test(text)) ?? null;
}

// One-line edits that break one property each, so the gate can be seen catching them.
// Replacements use String.replace semantics ($1 = first group) and never add lines.
export const SABOTAGE = [
  { id: 'drop-eval', label: 'drop eval', pattern: /\beval ("\$\w+")/, replacement: 'echo $1' },
  { id: 'forget-history', label: 'forget history', pattern: /^(\s*prompt=)"\$prompt$/m, replacement: '$1"' },
  { id: 'never-stop', label: 'never stop', pattern: /^(\s*)\[\[? .*==? "?exit"? \]\]? && .*$/m, replacement: '$1: # exit check removed' },
  { id: 'curl-n', label: 'curl -N', pattern: /\bcurl (?=-)/, replacement: 'curl -N ' },
];

export function applySabotage(source, id) {
  const chip = SABOTAGE.find(entry => entry.id === id);
  if (!chip) throw new Error(`Unknown sabotage: ${id}`);
  const text = String(source ?? '');
  const matches = text.match(new RegExp(chip.pattern.source, `${chip.pattern.flags}g`))?.length ?? 0;
  if (matches !== 1) return { source: text, matches, diff: null };
  const sabotaged = text.replace(chip.pattern, chip.replacement);
  const start = text.lastIndexOf('\n', text.search(chip.pattern)) + 1;
  const newline = text.indexOf('\n', start);
  const end = newline === -1 ? text.length : newline;
  return {
    source: sabotaged,
    matches,
    diff: { before: text.slice(start, end), after: sabotaged.slice(start, end + sabotaged.length - text.length) },
  };
}

export async function fingerprint(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(text ?? '')));
  return [...new Uint8Array(digest, 0, 4)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// Byte accounting for one request the shell sent: what went over the wire, how much
// of it was prompt, and whether the agent's self-image (code or seed) is really in it.
export function measureRequest(rawBody, { code = '', seed = '' } = {}, previousBytes = null) {
  const raw = String(rawBody ?? '');
  const bytes = utf8Bytes(raw);
  const prompt = promptText(raw);
  const self = verifiedBytes(prompt, code);
  const seeded = verifiedBytes(prompt, seed);
  return {
    bytes,
    promptBytes: utf8Bytes(prompt),
    selfBytes: self.bytes,
    selfVerified: self.verified,
    seedBytes: seeded.bytes,
    seedVerified: seeded.verified,
    delta: previousBytes == null ? null : bytes - previousBytes,
  };
}

function promptText(raw) {
  try {
    const messages = JSON.parse(raw)?.messages;
    if (!Array.isArray(messages)) return '';
    return messages.map(message => {
      const content = message?.content;
      if (typeof content === 'string') return content;
      return Array.isArray(content) ? content.map(part => (typeof part?.text === 'string' ? part.text : '')).join('') : '';
    }).join('');
  } catch {
    return '';
  }
}

function verifiedBytes(prompt, text) {
  const normalized = String(text ?? '').replace(/\s+$/, '');
  const verified = normalized.length > 0 && prompt.replace(/\s+$/, '').includes(normalized);
  return { verified, bytes: verified ? utf8Bytes(normalized) : 0 };
}

// Wraps the model fetch the shell sees: measures each request, retries the model's
// transient failures with an abortable backoff, and refuses to go past the call cap.
export function createMeteredFetch(innerFetch, {
  code = '',
  seed = '',
  onTurn = () => {},
  onEvent = () => {},
  retries = 3,
  backoffMs = [4000, 8000, 16000],
  maxCalls = RUN_CAP.calls,
} = {}) {
  let calls = 0;
  let previousBytes = null;
  let aborted = false;
  const waiters = new Set();
  const stopped = () => new DOMException('Stopped', 'AbortError');
  const wait = ms => new Promise((resolve, reject) => {
    if (aborted) return reject(stopped());
    const cancel = () => { clearTimeout(timer); reject(stopped()); };
    const timer = setTimeout(() => { waiters.delete(cancel); resolve(); }, ms);
    waiters.add(cancel);
  });
  const fetch = async (url, options = {}) => {
    if (aborted) throw stopped();
    if (calls + 1 > maxCalls) {
      onEvent({ type: 'cap', calls });
      throw stopped();
    }
    calls += 1;
    const index = calls - 1;
    const raw = String(options.body ?? '');
    const measure = measureRequest(raw, { code, seed }, previousBytes);
    previousBytes = measure.bytes;
    let response;
    for (let attempt = 0; ; attempt += 1) {
      response = await innerFetch(url, options);
      const transient = response.status === 429 || response.status >= 500;
      if (!transient || attempt >= retries) break;
      onEvent({ type: 'retry', attempt: attempt + 1, status: response.status });
      await wait(backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 0);
    }
    if (response.status === 200) onTurn({ index, measure, content: completionContent(response.body), raw });
    return response;
  };
  return {
    fetch,
    calls: () => calls,
    abort() {
      aborted = true;
      for (const cancel of waiters) cancel();
      waiters.clear();
    },
  };
}

// results: [{ bytes, pass }] over seeds of different sizes.
export function compressionFloor(results) {
  const passing = results.filter(result => result.pass).map(result => result.bytes);
  const floorBytes = passing.length ? Math.min(...passing) : null;
  const failing = results.filter(result => !result.pass && (floorBytes == null || result.bytes < floorBytes)).map(result => result.bytes);
  return { floorBytes, firstFailBytes: failing.length ? Math.max(...failing) : null };
}
