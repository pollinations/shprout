#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Bash } from 'just-bash/browser';

const task = process.argv[2];
const approachA = process.argv[3] || 'shprout';
const approachB = process.argv[4] || 'approaches/syscap';
const apiKey = process.env.OPENAI_API_KEY;
const base = process.env.OPENAI_BASE_URL;
const modelA = process.env.MODEL_A || process.env.MODEL || 'claude-large';
const modelB = process.env.MODEL_B || process.env.MODEL || 'openai-fast';

if (!task || !apiKey || !base) {
  console.error('usage: OPENAI_API_KEY=... OPENAI_BASE_URL=... node research/arena.mjs "task" [approach-a] [approach-b]');
  process.exit(2);
}

const endpointRoot = base.replace(/\/$/, '') + '/';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

async function run(label, approach, model) {
  const source = await readFile(resolve(approach), 'utf8');
  const bash = new Bash({
    files: { '/home/user/agent': source },
    cwd: '/home/user',
    env: {
      OPENAI_API_KEY: 'managed-by-arena',
      OPENAI_BASE_URL: base,
      MODEL: model,
      SHPROUT_RUNTIME: 'just-bash arena; isolated virtual filesystem',
    },
    network: {
      allowedUrlPrefixes: [{
        url: endpointRoot,
        transform: [{ headers: { Authorization: 'Bearer ' + apiKey } }],
      }],
      allowedMethods: ['POST'],
      // The browser-compatible just-bash build has no DNS resolver. The exact
      // endpoint allowlist and redirect checks still constrain every request.
      denyPrivateRanges: false,
    },
    executionLimits: { maxCommandCount: 5000, maxLoopIterations: 5000 },
  });
  const started = performance.now();
  const result = await bash.exec('bash /home/user/agent ' + quote(task));
  return {
    label,
    approach,
    model,
    sourceBytes: source.length,
    elapsedMs: Math.round(performance.now() - started),
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

const results = await Promise.all([
  run('A', approachA, modelA),
  run('B', approachB, modelB),
]);
console.log(JSON.stringify({ task, results }, null, 2));
