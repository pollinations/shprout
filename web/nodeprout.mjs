#!/usr/bin/env node
// nodeprout — write ONE async function body in a ```js fence. I build it with
// `new AsyncFunction(...names, code)` and call it with these names in scope:
//
//   fs       — node:fs/promises
//   path     — node:path
//   spawn    — (cmd, args=[], opts={}) => Promise<{ stdout, stderr, code }>
//              runs commands in the cwd. Use for `npm install <pkg>`, `ls`, etc.
//   use      — async (name) => Module. Like dynamic `import` but resolves
//              `node_modules` correctly. ALWAYS use this for installed packages,
//              never `await import('pkg')` (it'll fail with "Failed to resolve
//              module specifier"). For node:* builtins, dynamic import is fine.
//   fetch    — global fetch.
//   console  — { log, warn, error } — captured to stdout for the next turn.
//   __filename, __dirname, cwd — path info. NOTE: `import.meta` is a SYNTAX
//              error inside this function (it isn't a real module), so use
//              these instead.
//
// Self-reference: your full source code is already shown above this comment as
// the system prompt — you do NOT need to read your own file to "see yourself."
// If you need the raw bytes (e.g. to print/format/hash), read __filename.
//
// Installing & using npm packages:
//   turn 1:  await spawn('npm', ['install', 'lodash']);
//            return [{}];                                  // continue to next turn
//   turn 2:  const _ = (await use('lodash')).default;       // resolved via node_modules
//            console.log(_.chunk([1,2,3,4], 2));
// A `package.json` is already present so installs run cleanly.
//
// To continue, fan out, or stop: RETURN AN ARRAY (same protocol as jsprout).
//   return []                                          // done.
//   return [{}]                                        // one more turn.
//   return [{ task: 'next thing' }]                    // append a new <task>.
//   return [{ task: 'A' }, { task: 'B' }]              // fan out (sequential here).
// Return ANYTHING ELSE (undefined, number, string) and the loop stops.
//
// The cwd persists between turns. Files you write stay. `globalThis` persists.

import { readFile, writeFile } from 'node:fs/promises';
import * as fsp from 'node:fs/promises';
import * as nodePath from 'node:path';
import { spawn as cpSpawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const AsyncFn = (async function(){}).constructor;
const SELF = new URL(import.meta.url).pathname;

const KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.MODEL || 'claude-large';
const BASE = process.env.OPENAI_BASE_URL || 'https://gen.pollinations.ai/v1';
const TASK = process.argv[2] || '';
const MAX_TURNS = Number(process.env.MAX_TURNS || 12);

if (!KEY) { console.error('OPENAI_API_KEY required'); process.exit(2); }
if (!TASK) { console.error('usage: node nodeprout.mjs "<task>"'); process.exit(2); }

const sys = await readFile(SELF, 'utf8');

const think = async (log) => {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      stop: ['```\n'],
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: log },
      ],
    }),
  });
  const j = await r.json();
  return j.choices?.[0]?.message?.content ?? '';
};

const reqHere = createRequire(pathToFileURL(process.cwd() + '/'));
const use = async (name) => {
  const resolved = reqHere.resolve(name);
  return import(pathToFileURL(resolved).href);
};

const spawnP = (cmd, args = [], opts = {}) => new Promise((resolve) => {
  const p = cpSpawn(cmd, args, { shell: false, ...opts });
  let stdout = '', stderr = '';
  p.stdout?.on('data', d => stdout += d);
  p.stderr?.on('data', d => stderr += d);
  p.on('close', code => resolve({ stdout, stderr, code }));
  p.on('error', e => resolve({ stdout, stderr: String(e), code: -1 }));
});

const act = async (code) => {
  const logs = [];
  const cap = tag => (...a) => logs.push(`${tag}${a.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')}`);
  const scope = {
    fs: fsp,
    path: nodePath,
    spawn: spawnP,
    use,
    fetch: globalThis.fetch,
    __filename: SELF,
    __dirname: nodePath.dirname(SELF),
    cwd: process.cwd(),
    console: { log: cap(''), warn: cap('? '), error: cap('!! ') },
  };
  let value;
  try {
    const fn = new AsyncFn(...Object.keys(scope), code);
    value = await fn(...Object.values(scope));
    if (value !== undefined) logs.push(`=> ${JSON.stringify(value)}`);
  } catch (e) { logs.push(`!! ${e.stack || e.message}`); }
  return { text: logs.join('\n') || '(no output)', value };
};

const extract = rsp => rsp.match(/^```[^\n]*\n([\s\S]*)/m)?.[1]?.trim();
const append = (log, rsp, out) => `${log}\n--- you ---\n${rsp}\n--- node ---\n${out}\n`;
const start = task => `<task>${task}</task>\n#log\n`;

const step = async (log, depth = 0) => {
  if (depth >= MAX_TURNS) { console.log('!! max turns reached'); return; }
  const rsp = await think(log);
  process.stdout.write(rsp.split('\n').map(l => '> ' + l).join('\n') + '\n');
  const code = extract(rsp);
  if (!code) return;
  process.stdout.write('```js\n' + code + '\n```\n');
  const out = await act(code);
  process.stdout.write(out.text + '\n');
  if (!Array.isArray(out.value) || out.value.length === 0) return;
  const nextLog = append(log, rsp, out.text);
  for (const spec of out.value) {
    const childLog = spec?.task ? `${nextLog}<task>${spec.task}</task>\n` : nextLog;
    await step(childLog, depth + 1);
  }
};

await step(start(TASK));
