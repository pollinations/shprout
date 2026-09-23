import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { runReplAgent, extractReplCell } from '../web/repl-engine.js';
import { installReplSandbox } from '../web/repl-sandbox.js';
import { createRoutes } from '../web/routes.js';

const fence = code => `\`\`\`js\n${code}\n\`\`\``;

test('one REPL loop feeds errors and a fresh DOM back before the repair', async () => {
  const history = [];
  const requests = [];
  let dom = '<main></main>';
  const runtime = {
    inspect: async () => ({ dom, state: '{}' }),
    execute: async code => {
      dom = '<main>changed</main>';
      return { output: '', value: 'undefined', error: code === 'bad()' ? 'bad is not defined' : null };
    },
  };
  const replies = [fence('bad()'), fence('repair()'), 'done'];
  const complete = async request => { requests.push(request); return replies.shift(); };
  const result = await runReplAgent({ task: 'build', runtime, complete, history });
  assert.equal(result.status, 'finished');
  assert.equal(result.steps, 3);
  assert.match(JSON.stringify(requests[1].messages), /bad is not defined/);
  assert.match(requests[1].messages.at(-1).content, /<main>changed/);
  await runReplAgent({ task: 'make it red', runtime, history, complete: async request => {
    assert.match(JSON.stringify(request.messages), /repair\(\)/);
    assert.match(request.messages.at(-1).content, /make it red/);
    return 'done';
  } });
});

test('call limits, cancellation and API failure never report finished', async () => {
  let evaluations = 0;
  const runtime = { inspect: async () => ({}), execute: async () => { evaluations++; return {}; } };
  const limited = await runReplAgent({ task: 'loop', runtime, maxSteps: 2, complete: async () => fence('x') });
  assert.equal(limited.status, 'limited');
  assert.equal(evaluations, 2);
  const controller = new AbortController();
  await assert.rejects(runReplAgent({ task: 'stop', runtime, signal: controller.signal, complete: async () => {
    controller.abort(); return fence('should not run');
  } }), { name: 'AbortError' });
  assert.equal(evaluations, 2);
  await assert.rejects(runReplAgent({ task: 'fail', runtime, complete: async () => { throw new Error('HTTP 401'); } }), /HTTP 401/);
  await assert.rejects(runReplAgent({ task: 'empty', runtime, complete: async () => '' }), /no text/);
});

test('only the first JavaScript fence is evaluated', () => {
  assert.equal(extractReplCell('hello\n' + fence('one()') + '\n' + fence('two()')), 'one()');
  assert.equal(extractReplCell('```javascript\nawait x()'), 'await x()');
  assert.equal(extractReplCell('done'), null);
});

test('sandbox cells retain DOM, functions and state, and capture errors without losing state', async () => {
  const events = new Map();
  const responses = [];
  const stage = { outerHTML: '<main></main>', textContent: '' };
  const parent = { postMessage: value => responses.push(value) };
  const context = vm.createContext({ parent, Element: class {}, document: { getElementById: () => stage },
    addEventListener: (type, listener) => events.set(type, listener) });
  vm.runInContext(`(${installReplSandbox.toString()})('test-channel')`, context);
  const request = async (method, code) => {
    await events.get('message')({ source: parent, data: { type: 'request', channel: 'test-channel', id: 1, method, code } });
    return responses.at(-1).result;
  };
  await request('execute', 'state.n = 2; state.inc = () => ++state.n; stage.textContent = "alive";');
  const next = await request('execute', 'console.log(state.inc()); return stage.textContent;');
  assert.equal(next.output, '3');
  assert.equal(next.value, 'alive');
  assert.match((await request('execute', 'missingFunction()')).error, /missingFunction/);
  assert.equal((await request('execute', 'return state.inc()')).value, '4');
  const snapshot = await request('inspect');
  assert.match(snapshot.state, /"n":4/);
  assert.match(snapshot.state, /\[Function\]/);
  const count = responses.length;
  await events.get('message')({ source: {}, data: { type: 'request', channel: 'test-channel', method: 'execute', code: 'state.n=999' } });
  assert.equal(responses.length, count, 'messages from unrelated windows are ignored');
});

test('all REPL assets are included in development and static routes', () => {
  const routes = createRoutes({ justBashBundle: '' });
  for (const path of ['/repl.html', '/repl.css', '/repl.js', '/repl-engine.js', '/repl-runtime.js', '/repl-sandbox.js']) assert.ok(routes.has(path), path);
});

test('review executes edited code and tells the next turn what actually ran', async () => {
  const executed = [];
  const history = [];
  let calls = 0;
  const result = await runReplAgent({ task: 'edit', history,
    runtime: { inspect: async () => ({}), execute: async code => { executed.push(code); return { output: 'edited' }; } },
    beforeExecute: async ({ code }) => { assert.equal(code, 'original()'); return 'edited()'; },
    complete: async ({ messages }) => {
      if (++calls === 1) return fence('original()');
      assert.match(JSON.stringify(messages), /I edited the proposed cell.*edited\(\)/s);
      return 'done';
    },
  });
  assert.deepEqual(executed, ['edited()']);
  assert.equal(result.status, 'finished');
});

test('cancelling a reviewed cell prevents its execution', async () => {
  const controller = new AbortController();
  let executed = false;
  await assert.rejects(runReplAgent({ task: 'review', signal: controller.signal,
    runtime: { inspect: async () => ({}), execute: async () => { executed = true; } },
    complete: async () => fence('never()'),
    beforeExecute: async ({ code }) => { controller.abort(); return code; },
  }), { name: 'AbortError' });
  assert.equal(executed, false);
});

test('all three interfaces and comparison page ship in the static site', () => {
  const routes = createRoutes({ justBashBundle: '' });
  for (const name of ['versions', 'console', 'canvas', 'notebook']) assert.ok(routes.has(`/repl-${name}.html`));
  assert.ok(routes.has('/repl-variants.css'));
});
