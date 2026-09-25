import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Bash } from 'just-bash/browser';
import {
  POLLI_BASE,
  POLLI_ENDPOINT,
  createApiBridge,
  createDemoBridge,
  isVisibleWorkspacePath,
  parseModelResponse,
  preparePreview,
  workspacePath,
} from '../web/workshop-runtime.js';

const source = await readFile(new URL('../shprout', import.meta.url), 'utf8');

test('model responses are split into visible thought and executable action', () => {
  assert.deepEqual(
    parseModelResponse('Inspect first.\n```bash\nprintf ok\n```'),
    { thought: 'Inspect first.', action: 'printf ok' },
  );
  assert.deepEqual(
    parseModelResponse('Nothing else to do.'),
    { thought: 'Nothing else to do.', action: '' },
  );
});

test('preview documents receive a restrictive CSP', () => {
  const document = preparePreview('<!doctype html><html><head><title>x</title></head><body></body></html>');
  assert.match(document, /Content-Security-Policy/);
  assert.match(document, /connect-src 'none'/);
  assert.match(document, /form-action 'none'/);
  assert.ok(document.indexOf('Content-Security-Policy') < document.indexOf('<title>'));
});

test('workspace paths hide the harness and reject traversal', () => {
  assert.equal(isVisibleWorkspacePath('/home/user/index.html'), true);
  assert.equal(isVisibleWorkspacePath('/home/user/.shprout/GOAL.md'), true);
  assert.equal(isVisibleWorkspacePath('/home/user/shprout'), false);
  assert.equal(isVisibleWorkspacePath('/home/user/approaches/classic'), false);
  assert.equal(workspacePath('.shprout/GOAL.md'), '/home/user/.shprout/GOAL.md');
  assert.throws(() => workspacePath('../secret'), /Invalid workspace path/);
});

test('the API bridge rejects successful replies without model content', async () => {
  const events = [];
  const bridge = createApiBridge({
    apiKey: 'sk_test',
    fetchImpl: async () => new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    onEvent: event => events.push(event),
  });

  await assert.rejects(
    bridge.fetch(POLLI_ENDPOINT, { method: 'POST', body: '{}' }),
    /did not contain message content/,
  );
  assert.equal(events[0].type, 'request');
  assert.equal(events[1].type, 'error');
});

test('aborting the API bridge mid-request is not reported as a failed request', async () => {
  const events = [];
  const bridge = createApiBridge({
    apiKey: 'sk_test',
    fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')));
    }),
    onEvent: event => events.push(event),
  });
  const pending = bridge.fetch(POLLI_ENDPOINT, { method: 'POST', body: '{}' });
  bridge.abort();
  await assert.rejects(pending, error => error?.name === 'AbortError');
  assert.deepEqual(events.map(event => event.type), ['request']);
});

test('demo drives the real shell loop and leaves a verified artifact and state', async () => {
  const events = [];
  const bridge = createDemoBridge({ delayMs: 0, onEvent: event => events.push(event) });
  const bash = new Bash({
    files: {
      '/home/user/shprout': source,
      '/home/user/.shprout/.keep': '',
    },
    cwd: '/home/user',
    env: {
      OPENAI_API_KEY: 'managed-by-browser',
      OPENAI_BASE_URL: POLLI_BASE,
      MODEL: 'deterministic-demo',
      SHPROUT_RUNTIME: 'just-bash workshop test',
    },
    fetch: bridge.fetch,
  });

  const result = await bash.exec("bash /home/user/shprout 'build the demo'");

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /created index\.html/);
  assert.match(result.stdout, /signal garden is built/i);
  assert.match(await bash.readFile('/home/user/index.html'), /<canvas id="garden"/);
  assert.match(await bash.readFile('/home/user/.shprout/GOAL.md'), /signal garden/);
  assert.match(await bash.readFile('/home/user/.shprout/RECENT.md'), /verified/);
  assert.deepEqual(events.map(event => event.type), [
    'request', 'response',
    'request', 'response',
    'request', 'response',
  ]);
});
