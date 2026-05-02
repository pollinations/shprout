#!/usr/bin/env node
// Browser/WebContainer Polli shim.
// WebContainer's Node-side fetch path can fail with bearer auth headers, so
// generation calls use gen.pollinations.ai's supported ?key= fallback.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const BASE = process.env.POLLINATIONS_BASE_URL || 'https://gen.pollinations.ai';
const CREDS = join(homedir(), '.pollinations', 'credentials.json');

process.stdout.on('error', error => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

let args = process.argv.slice(2);
const json = args.includes('--json');
args = args.filter(arg => arg !== '--json' && arg !== '');

const out = value => {
  if (typeof value === 'string') process.stdout.write(value.endsWith('\n') ? value : `${value}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};
const err = value => process.stderr.write(`${value}\n`);

const isKey = key => typeof key === 'string' && /^(pk_|sk_|plln_)/.test(key);
const mask = key => isKey(key) ? `${key.slice(0, 5)}...${key.slice(-6)}` : null;

async function readKey() {
  if (!existsSync(CREDS)) return null;
  try {
    const creds = JSON.parse(await readFile(CREDS, 'utf8'));
    return isKey(creds.apiKey) ? creds.apiKey : null;
  } catch {
    return null;
  }
}

async function saveKey(key) {
  await mkdir(dirname(CREDS), { recursive: true, mode: 0o700 });
  await writeFile(CREDS, JSON.stringify({
    apiKey: key,
    keyType: key.startsWith('sk_') || key.startsWith('plln_sk_') ? 'sk' : 'pk',
  }, null, 2), { mode: 0o600 });
}

function url(path, key) {
  const u = new URL(path, BASE);
  if (key) u.searchParams.set('key', key);
  return u;
}

async function maybeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function authStatus() {
  const key = await readKey();
  if (!key) {
    out(json ? { authenticated: false, message: 'Not logged in. Click Browser Key.' }
      : 'authenticated: false\nmessage: Not logged in. Click Browser Key.');
    return;
  }

  const result = { authenticated: true, key: mask(key) };
  try {
    const [profile, balance] = await Promise.all([
      fetch(url('/account/profile', key)).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(url('/account/balance', key)).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    if (profile?.githubUsername) result.name = profile.githubUsername;
    if (balance?.balance !== undefined) result.pollen = balance.balance;
    if (!profile) result.status = 'Key stored; generation uses query-key auth in WebContainer';
  } catch {
    result.status = 'Key stored; generation uses query-key auth in WebContainer';
  }

  if (json) out(result);
  else Object.entries(result).forEach(([k, v]) => out(`${k}: ${v}`));
}

async function authLogin() {
  const tokenIndex = args.indexOf('--token');
  const token = tokenIndex >= 0 ? args[tokenIndex + 1] : null;
  if (isKey(token)) {
    await saveKey(token);
    err('Authenticated. Key stored.');
    return;
  }
  err('Use the Browser Key button in this WebContainer demo, or pass --token <key>.');
}

async function models() {
  const key = await readKey();
  const res = await fetch(url('/text/models', key));
  if (!res.ok) {
    err(`error: ${res.status} ${res.statusText}: ${await res.text()}`);
    process.exit(1);
  }
  const data = await res.json();
  if (json) return out(data);
  for (const model of data.slice(0, 25)) {
    out(`${String(model.name).padEnd(22)} ${model.description || ''}`);
  }
}

function option(rest, name, fallback = undefined) {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : fallback;
}

async function genText() {
  const key = await readKey();
  const rest = args.slice(2);
  const promptParts = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      if (!['--no-stream', '--json-response'].includes(arg)) i += 1;
      continue;
    }
    promptParts.push(arg);
  }
  const prompt = promptParts.join(' ').trim();
  if (!prompt) {
    err('error: No prompt provided.');
    process.exit(1);
  }

  const model = option(rest, '--model', 'openai-fast');
  const system = option(rest, '--system');
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  if (!json) err('Generating...');
  const res = await fetch(url('/v1/chat/completions', key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) {
    err(`error: ${res.status} ${res.statusText}: ${await res.text()}`);
    process.exit(1);
  }
  const data = await maybeJson(res);
  const content = data?.choices?.[0]?.message?.content ?? '';
  if (json) out({ content, model: data?.model ?? model, tokens: data?.usage?.total_tokens ?? null });
  else out(content);
}

function help() {
  out(`polli-web

Commands:
  polli auth status [--json]
  polli auth login --token <key>
  polli models --type text [--json]
  polli gen text <prompt> --model <model> [--no-stream]
`);
}

if (args.length === 0 || args.includes('--help') || args.includes('-h')) help();
else if (args[0] === 'auth' && args[1] === 'status') await authStatus();
else if (args[0] === 'auth' && args[1] === 'login') await authLogin();
else if (args[0] === 'models') await models();
else if (args[0] === 'gen' && args[1] === 'text') await genText();
else {
  err(`error: unsupported command: ${args.join(' ')}`);
  process.exit(1);
}
