import assert from 'node:assert/strict';
import test from 'node:test';
import { runDomAgent } from '../web/dom-engine.js';

const fenced = code => `\`\`\`js\n${code}\n\`\`\``;
const latestTask = messages => {
  const content = [...messages].reverse().find(message => message.content.includes('<task'))?.content || '';
  return content.match(/<task[^>]*>([\s\S]*?)<\/task>/)?.[1];
};

test('DOM children execute in parallel with distinct branch paths', async () => {
  let active = 0;
  let maxActive = 0;
  const waiting = [];
  const events = [];
  const domPrompts = [];
  const runtime = {
    snapshot: async handle => handle === '0' ? 'x'.repeat(500) : `<section id="${handle}"></section>`,
    execute: async (_handle, code) => {
      if (code === 'ROOT') {
        return {
          output: 'made slots',
          value: [
            { task: 'paint left', target: '#left' },
            { task: 'paint right', target: '#right' },
          ],
          error: null,
        };
      }
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise(resolve => {
        waiting.push(() => {
          active -= 1;
          resolve({ output: code, value: [], error: null });
        });
        if (waiting.length === 2) queueMicrotask(() => waiting.splice(0).forEach(release => release()));
      });
    },
    resolve: async (_handle, _specs, paths) => paths,
  };
  const complete = async ({ messages }) => {
    domPrompts.push(messages.at(-1).content);
    const task = latestTask(messages);
    if (task === 'root task') return fenced('ROOT');
    if (task === 'paint left') return fenced('LEFT');
    if (task === 'paint right') return fenced('RIGHT');
    throw new Error(`unexpected task: ${task}`);
  };

  const result = await runDomAgent({
    task: 'root task',
    model: 'fake',
    complete,
    runtime,
    source: 'test harness',
    maxDomChars: 100,
    onEvent: event => events.push(event),
  });

  assert.equal(result.steps, 3);
  assert.equal(maxActive, 2);
  assert.deepEqual(
    events.filter(event => event.type === 'start').map(event => event.path),
    ['0', '0.0', '0.1'],
  );
  assert.deepEqual(events.find(event => event.type === 'fanout').children, ['0.0', '0.1']);
  assert.match(domPrompts[0], /clipped 400 chars/);
  assert.ok(domPrompts[0].length < 250);
});

test('execution errors become observations and trigger a repair turn', async () => {
  let calls = 0;
  const events = [];
  const runtime = {
    snapshot: async () => '<main></main>',
    execute: async (_handle, code) => code === 'BAD'
      ? { output: '', value: null, error: 'boom' }
      : { output: 'fixed', value: [], error: null },
    resolve: async () => { throw new Error('resolve should not run'); },
  };
  const complete = async ({ messages }) => {
    calls += 1;
    return fenced(messages.some(message => message.content.includes('boom')) ? 'FIX' : 'BAD');
  };

  const result = await runDomAgent({
    task: 'repair it',
    model: 'fake',
    complete,
    runtime,
    source: 'test harness',
    onEvent: event => events.push(event),
  });

  assert.equal(result.steps, 2);
  assert.equal(calls, 2);
  assert.ok(events.some(event => event.type === 'error' && event.text.includes('boom')));
  assert.ok(events.some(event => event.type === 'observation' && event.text === 'fixed'));
});

test('invalid parallel targets are rejected before fanout and can be repaired', async () => {
  let calls = 0;
  let resolveCalls = 0;
  const runtime = {
    snapshot: async () => '<main></main>',
    execute: async (_handle, code) => code === 'INVALID'
      ? { output: '', value: [{ task: 'a' }, { task: 'b' }], error: null }
      : { output: 'fixed', value: [], error: null },
    resolve: async () => { resolveCalls += 1; return []; },
  };
  const complete = async ({ messages }) => {
    calls += 1;
    const repairing = messages.some(message => message.content.includes('parallel children'));
    return fenced(repairing ? 'FIX' : 'INVALID');
  };

  const result = await runDomAgent({
    task: 'fan out',
    model: 'fake',
    complete,
    runtime,
    source: 'test harness',
  });

  assert.equal(result.steps, 2);
  assert.equal(calls, 2);
  assert.equal(resolveCalls, 0);
});

test('reports an exhausted repair budget as limited instead of done', async () => {
  const runtime = {
    snapshot: async () => '<main></main>',
    execute: async () => ({ output: '', value: null, error: 'still broken' }),
    resolve: async () => [],
  };

  const result = await runDomAgent({
    task: 'repair forever',
    model: 'fake',
    complete: async () => fenced('BAD'),
    runtime,
    source: 'test harness',
    maxSteps: 1,
  });

  assert.equal(result.steps, 1);
  assert.equal(result.limited, true);
  assert.equal(result.result.status, 'step-limit');
});
