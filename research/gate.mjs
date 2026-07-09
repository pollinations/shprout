#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Bash } from 'just-bash/browser';

const args = process.argv.slice(2);
const candidateArg = args.find(arg => !arg.startsWith('--'));
const protocol = args.includes('--classic') ? 'classic' : 'fenced';
const expectSelfMod = args.includes('--self-mod');
const expectSplitCap = args.includes('--split-capped');

if (!candidateArg) {
  console.error('usage: node research/gate.mjs <agent> [--classic|--self-mod|--split-capped]');
  process.exit(2);
}

const source = await readFile(resolve(candidateArg), 'utf8');
const requests = [];
const encoder = new TextEncoder();
const longPrefix = expectSplitCap ? 'x'.repeat(150) : '';
const firstAction = expectSelfMod
  ? 'printf \'\\n# GATE_SELF_MOD\\n\' >> "$0"; printf \'' + longPrefix + 'A1-42\\n\''
  : 'printf \'' + longPrefix + 'A1-42\\n\'';
const actions = protocol === 'classic'
  ? [firstAction, "printf 'B2-ok\\n'", 'exit']
  : [
      'I will take the first action.\n```bash\n' + firstAction + '\n```',
      "I will take the second action.\n```bash\nprintf 'B2-ok\\n'\n```",
      'The checks are complete.',
    ];

const fetch = async (url, options = {}) => {
  const body = JSON.parse(options.body);
  requests.push({ url, body });
  const content = actions[requests.length - 1] ?? actions.at(-1);
  return {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: encoder.encode(JSON.stringify({ choices: [{ message: { content } }] })),
    url,
  };
};

const bash = new Bash({
  files: { '/home/user/agent': source },
  cwd: '/home/user',
  env: {
    OPENAI_API_KEY: 'gate-key',
    OPENAI_BASE_URL: 'https://gate.invalid/v1',
    MODEL: 'gate-model',
    SHPROUT_RUNTIME: 'just-bash deterministic gate',
    SHPROUT_HISTORY_CHARS: expectSplitCap ? '100' : '10000',
  },
  fetch,
  executionLimits: { maxCommandCount: 5000, maxLoopIterations: 5000 },
});

const result = await bash.exec("bash /home/user/agent 'purpose-marker-a7x'");
const fails = [];
for (const [label, needle] of [
  ['env:OPENAI_API_KEY', 'OPENAI_API_KEY'],
  ['env:OPENAI_BASE_URL', 'OPENAI_BASE_URL'],
  ['self-read', '$0'],
  ['http', 'curl'],
  ['endpoint', 'chat/completions'],
  ['eval', 'eval'],
]) if (!source.includes(needle)) fails.push('missing:' + label);
if (!/\b(for|while|until)\b/.test(source)) fails.push('missing:loop');
if (requests.length !== 3) fails.push('calls:' + requests.length);

const promptAt = index => JSON.stringify(requests[index]?.body?.messages ?? []);
if (!promptAt(0).includes('purpose-marker-a7x')) fails.push('task-not-in-prompt');
if (!promptAt(1).includes('A1-42')) fails.push('first-output-not-remembered');
if (!promptAt(2).includes('B2-ok')) fails.push('history-not-cumulative');
if (!result.stdout.includes('A1-42') || !result.stdout.includes('B2-ok')) fails.push('actions-not-executed');
if (expectSelfMod && !promptAt(1).includes('GATE_SELF_MOD')) fails.push('source-not-refreshed');

if (expectSplitCap) {
  const messages = requests[1]?.body?.messages ?? [];
  if (messages.length !== 2 || messages[0]?.role !== 'system' || messages[1]?.role !== 'user') {
    fails.push('messages-not-split');
  }
  if ((messages[1]?.content?.length ?? Infinity) > 100) fails.push('history-not-capped');
}

const report = {
  candidate: candidateArg,
  bytes: source.length,
  protocol,
  pass: fails.length === 0,
  fails,
  calls: requests.length,
  exitCode: result.exitCode,
  stderr: result.stderr,
};
console.log(JSON.stringify(report, null, 2));
if (fails.length) process.exitCode = 1;
