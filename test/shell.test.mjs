import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { consoleProtocol } from '../web/shell-protocol.js';
import { createRoutes } from '../web/routes.js';

test('VM transport preserves ANSI output across every split boundary', () => {
  const wire = 'hello\x1b[32m green\x1b[0m\x1b]777;shprout;test;request\x07world';
  for (let split = 0; split <= wire.length; split++) {
    let output = ''; const messages = [];
    const receive = consoleProtocol({ nonce: 'test', output: value => { output += value; }, message: value => messages.push(value) });
    receive(wire.slice(0, split)); receive(wire.slice(split));
    assert.equal(output, 'hello\x1b[32m green\x1b[0mworld');
    assert.deepEqual(messages, ['request']);
  }
});

test('VM transport rejects oversized unfinished messages', () => {
  const receive = consoleProtocol({ nonce: 'test', output() {}, message() {}, maxBytes: 64 });
  assert.throws(() => receive('\x1b]777;shprout;test;' + 'a'.repeat(65)), /size limit/);
});

test('browser shell serves the actual canonical source and all runtime files', async () => {
  const routes = createRoutes({ justBashBundle: '' });
  assert.equal(await readFile(routes.get('/shprout.txt').path, 'utf8'), await readFile(new URL('../shprout', import.meta.url), 'utf8'));
  for (const path of ['/shell.html','/shell.js','/shell-linux.js','/shell-lite.js','/shell-protocol.js','/vendor/xterm.js','/vendor/xterm-fit.js','/vendor/xterm.css','/linux/jq-linux-i386','/linux/curl-bridge.py']) {
    assert.ok(routes.has(path), path);
    assert.ok((await readFile(routes.get(path).path)).length > 0, path);
  }
});

test('all Bash presets resolve to self-reading scripts; archived Opus runs the execution gate', async () => {
  const { SHELL_AGENTS, SHELL_SEEDS, SHELL_TASKS } = await import('../web/shell-presets.js');
  const { Bash } = await import('just-bash');
  const { runGate } = await import('../web/seed-runtime.js');
  const routes = createRoutes({ justBashBundle: '' });
  for (const item of SHELL_AGENTS) {
    const route = routes.get(item.url);
    assert.ok(route, item.id);
    const source = await readFile(route.path, 'utf8');
    assert.match(source, /^#!.*bash/);
    assert.match(source, /\$0/);
    assert.match(source, /eval/);
    assert.ok(item.origin && item.note);
    if (item.id === 'opus-v5') {
      const report = await runGate(Bash, source);
      assert.equal(report.pass, true, JSON.stringify(report.fails));
    }
  }
  for (const items of [SHELL_AGENTS, SHELL_SEEDS, SHELL_TASKS]) {
    assert.equal(new Set(items.map(i => i.id)).size, items.length);
    assert.ok(items.every(i => i.origin && i.note));
  }
  assert.ok(SHELL_SEEDS.find(i => i.id === 'brevity-288').text.startsWith('minimal golfed bash agent'));
  assert.ok(SHELL_TASKS.some(i => i.id === 'recover'));
});
