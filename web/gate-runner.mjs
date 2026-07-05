#!/usr/bin/env node
// gate-runner — executes one candidate agent under the eval gate, inside the
// WebContainer. No servers: tier 1 swaps globalThis.fetch for a scripted fake
// and traces every request the candidate makes; tier 2 lets the candidate use
// the real network and checks what it left on the (virtual) filesystem.
//
//   node gate-runner.mjs t1 <candidate.mjs> <result.json>
//   node gate-runner.mjs t2 <taskId> <candidate.mjs> <result.json>
//
// Writes the result JSON to <result.json> (the page reads it back via
// wc.fs.readFile — immune to terminal-stream mangling) and mirrors it to
// stdout as a final ___GATE___{...} line for the live log.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Paths arrive relative to the workspace (the container's real / is read-only
// and the page-side wc.fs API is rooted at the workspace). Resolve to absolute
// up front — tier 2 chdirs into a per-task workdir before the result is written.
const [mode, ...rest] = process.argv.slice(2);

// ---------------------------------------------------------------- candidate
// The candidate is a self-contained ESM script that reads its own source and
// takes its task from process.argv[2]. Run it by rewriting argv and dynamic-
// importing it (cache-busted so repeat runs re-execute). process.exit is
// patched so a candidate exiting doesn't kill the runner before it reports.
const runCandidate = async (candPath, task, timeoutMs) => {
  const orig = { argv: process.argv, exit: process.exit };
  process.argv = [orig.argv[0], candPath, task];
  const exitMark = Symbol('exit');
  process.exit = code => { const e = new Error(`process.exit(${code ?? 0})`); e[exitMark] = true; throw e; };
  let error = null;
  try {
    await Promise.race([
      import(pathToFileURL(candPath).href + '?bust=' + Math.random()),
      new Promise((_, rej) => setTimeout(() => rej(new Error('__timeout__')), timeoutMs)),
    ]);
  } catch (e) {
    if (!e?.[exitMark]) error = e?.message === '__timeout__' ? 'timeout' : String(e?.stack || e).slice(0, 300);
  }
  process.argv = orig.argv;
  process.exit = orig.exit;
  return error;
};

// ------------------------------------------------------------------- tier 1
// Scripted conversation. The outputs of turns 1 and 2 are computed values, so
// a candidate that echoes replies without executing them cannot fake a pass.
const T1_SCRIPT = [
  '```js\nconsole.log("A1-" + (6 * 7))\n```',
  '```js\nconsole.log("B2-" + "ok")\n```',
  'exit',
];
const T1_PURPOSE = 'purpose-marker-a7x: print hello';

const tier1 = async candPath => {
  const trace = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (!String(url).includes('/chat/completions')) return real(url, opts);
    const i = trace.length;
    trace.push(String(opts?.body ?? ''));
    console.log(`\n[t1 turn ${i + 1}] agent called the API (${trace[i].length}B prompt) → ${i >= T1_SCRIPT.length ? '503 exhausted' : `scripted reply: ${T1_SCRIPT[i].replace(/\n/g, ' ⏎ ')}`}`);
    if (i >= T1_SCRIPT.length)
      return new Response(JSON.stringify({ error: 'exhausted' }), { status: 503 });
    return new Response(JSON.stringify({
      id: `fake-${i}`, object: 'chat.completion', model: 'fake',
      choices: [{ index: 0, finish_reason: 'stop',
                  message: { role: 'assistant', content: T1_SCRIPT[i] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const error = await runCandidate(candPath, T1_PURPOSE, 25_000);
  globalThis.fetch = real;

  const fails = [];
  const calls = trace.slice(0, T1_SCRIPT.length);
  const extra = trace.length - calls.length;
  if (error === 'timeout') fails.push('t1:timeout');
  if (!calls.length) fails.push('t1:no-api-call');
  else {
    if (!calls[0].includes('purpose-marker-a7x')) fails.push('t1:task-not-in-prompt');
    if (calls.length < 3) fails.push(`t1:died-after-turn-${calls.length}`);
    if (calls.length >= 2 && !calls[1].includes('A1-42')) fails.push('t1:no-eval-or-no-history');
    if (calls.length >= 3 && !calls[2].includes('B2-ok')) fails.push('t1:history-not-cumulative');
    if (extra > 0) fails.push(`t1:no-termination (${extra} extra calls)`);
  }
  if (error && error !== 'timeout' && !fails.length) fails.push(`t1:crash:${error.slice(0, 120)}`);
  return { pass: !fails.length, fails, calls: trace.length };
};

// ------------------------------------------------------------------- tier 2
// Six micro-bench tasks against the real runtime model. Each runs in a fresh
// workdir; checks read the filesystem the candidate was told to write to.
const logLines = () => Array.from({ length: 400 }, (_, i) => (i % 7 === 3 ? `ERROR event ${i}` : `ok event ${i}`));
const sha8 = s => createHash('sha256').update(s).digest('hex').slice(0, 8);
const rf = p => readFile(p, 'utf8');

const T2 = {
  mkfile: {
    task: 'Create a file named hello.txt in the current working directory containing exactly the text: hello evalprout',
    check: async () => (await rf('hello.txt')).trim() === 'hello evalprout',
  },
  hash8: {
    task: 'Compute the sha256 hex digest of the exact string evalprout and write only its first 8 characters to a file named hash.txt in the current working directory',
    check: async () => (await rf('hash.txt')).trim() === sha8('evalprout'),
  },
  arith: {
    task: 'Compute 12345*567+89 and write the resulting number (digits only) to a file named num.txt in the current working directory',
    check: async () => (await rf('num.txt')).trim() === String(12345 * 567 + 89),
  },
  grepcount: {
    setup: async () => writeFile('app.log', logLines().join('\n')),
    task: 'The file app.log in the current working directory contains log lines. Count how many lines contain the string ERROR and write just that number to a file named count.txt',
    check: async () => (await rf('count.txt')).trim() === String(logLines().filter(l => l.includes('ERROR')).length),
  },
  multistep: {
    task: 'Create a directory named out in the current working directory. Write the text alpha to out/a.txt and the text beta to out/b.txt. Then create out/ab.txt containing the contents of a.txt followed by b.txt',
    check: async () => { const s = await rf('out/ab.txt'); const a = s.indexOf('alpha'); const b = s.indexOf('beta'); return a >= 0 && b > a; },
  },
  recover: {
    task: 'Try to read the file ./no-such-file-qz9.txt in the current working directory (it does not exist; observe the error), then write exactly RECOVERED to a file named status.txt',
    check: async () => (await rf('status.txt')).trim() === 'RECOVERED',
  },
};

const tier2 = async (taskId, candPath) => {
  const t = T2[taskId];
  if (!t) return { pass: false, fails: [`t2:unknown-task:${taskId}`] };
  const dir = resolve(`work-${taskId}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(dir, { recursive: true });
  process.chdir(dir);
  if (t.setup) await t.setup();
  // pass-through fetch logger: surface every model interaction live, even if
  // the candidate itself prints nothing
  const real = globalThis.fetch;
  let turn = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const r = await real(url, opts);
    if (String(url).includes('/chat/completions')) {
      try {
        const c = (await r.clone().json()).choices?.[0]?.message?.content ?? '';
        console.log(`\n[turn ${++turn}] model → agent:\n${c}`);
      } catch { /* non-JSON (429 etc.) — the candidate sees it too */ }
    }
    return r;
  };
  const error = await runCandidate(candPath, t.task, 120_000);
  globalThis.fetch = real;
  let pass = false;
  try { pass = await t.check(); } catch { pass = false; }
  const fails = pass ? [] : [`t2:${taskId}${error === 'timeout' ? ' (timeout)' : ''}`];
  return { pass, fails, error: error?.slice(0, 160) ?? null };
};

// --------------------------------------------------------------------- main
const outPath = resolve(mode === 't2' ? rest[2] : rest[1]); // before any chdir
let result;
if (mode === 't1') result = await tier1(resolve(rest[0]));
else if (mode === 't2') result = await tier2(rest[0], resolve(rest[1]));
else result = { pass: false, fails: [`gate:bad-mode:${mode}`] };
if (outPath) await writeFile(outPath, JSON.stringify(result));
console.log('___GATE___' + JSON.stringify(result));
process.exit(0); // force exit even if the candidate left timers/handles open
