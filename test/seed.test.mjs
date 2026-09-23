import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Bash } from 'just-bash/browser';
import {
  CONTROL,
  GATE_REPLIES,
  GATE_TASK,
  RUN_CAP,
  SABOTAGE,
  SANDBOX_LIMITS,
  SEEDS,
  TASKS,
  TERMINAL_TASKS,
  applySabotage,
  applySelfImage,
  classifySandboxLimit,
  compressionFloor,
  createMeteredFetch,
  createScriptedFetch,
  customTask,
  decompress,
  decompressionBody,
  extractFence,
  fingerprint,
  measureRequest,
  mountAgent,
  outputFromAppended,
  replyParts,
  runGate,
  runTask,
  scrubReplies,
  taskById,
  tier0,
  utf8Bytes,
} from '../web/seed-runtime.js';
import { POLLI_ENDPOINT } from '../web/workshop-runtime.js';

const champion = await readFile(new URL('../research/compression/samples/champion-386B.sh', import.meta.url), 'utf8');
const canonical = await readFile(new URL('../shprout', import.meta.url), 'utf8');
const seedOf = id => SEEDS.find(seed => seed.id === id).text;
const agents = [['champion', champion], ['hand-written', canonical]];

const completion = (status, content) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: new TextEncoder().encode(JSON.stringify(status === 200 ? { choices: [{ message: { content } }] } : { error: 'busy' })),
});

async function runScripted(source, task, replies, options = {}) {
  const scripted = createScriptedFetch({ replies });
  const { bash } = mountAgent(Bash, { source, fetch: scripted.fetch, ...options });
  const run = await runTask(bash, task, { signal: AbortSignal.timeout(20000), replies });
  return { run, scripted };
}

test('seed catalogue byte counts match their labels', () => {
  assert.equal(utf8Bytes(seedOf('champion-386')), 388);
  assert.equal(seedOf('champion-386').length, 386);
  assert.equal(seedOf('reliable-396').length, 396);
  assert.equal(utf8Bytes(seedOf('anchor-517')), 517);
  assert.equal(utf8Bytes(seedOf('terse-254')), 254);
  assert.equal(utf8Bytes(seedOf('floor-147')), 147);
  assert.ok(utf8Bytes(champion) > 4 * utf8Bytes(seedOf('champion-386')), 'the champion is at least 4x its seed');
});

test('terminal showcase tasks execute through the agent without inventing a quality score', async () => {
  for (const source of [champion, canonical]) {
    for (const task of TERMINAL_TASKS) {
      const replies = ['```bash\nprintf "source -> model -> bash -> output\\n"\nwc -c < "$0"\n```', 'exit'];
      const { run, scripted } = await runScripted(source, task, replies);
      assert.equal(scripted.requests.length, 2);
      assert.equal(run.pass, null);
      assert.match(run.output, /source -> model -> bash -> output/);
      assert.ok(JSON.stringify(scripted.requests[0].body).includes('reply exactly exit'));
    }
  }
});

test('decompression request is the seed alone, reproducible per attempt', () => {
  const body = decompressionBody({ seed: 'grow', attempt: 3 });
  assert.deepEqual(body, { model: 'claude-large', messages: [{ role: 'user', content: 'grow' }], temperature: 0, seed: 3 });
});

test('fence extraction takes the first fenced block and falls back to the whole reply', () => {
  assert.deepEqual(extractFence('Here you go:\n```bash\n#!/bin/bash\necho hi\n```\nNotes:\n```\nother\n```'), { code: '#!/bin/bash\necho hi\n', fenced: true });
  assert.deepEqual(extractFence('#!/bin/bash\necho raw\n'), { code: '#!/bin/bash\necho raw\n', fenced: false });
  assert.deepEqual(extractFence(''), { code: '\n', fenced: false });
});

test('decompress reads a scripted completion and extracts the agent', async () => {
  const scripted = createScriptedFetch({ replies: ['```bash\n' + champion.trimEnd() + '\n```'] });
  const grown = await decompress({ fetch: scripted.fetch, seed: seedOf('champion-386'), attempt: 2 });
  assert.equal(grown.code, champion);
  assert.equal(grown.fenced, true);
  assert.equal(grown.attempt, 2);
  assert.equal(scripted.requests[0].body.seed, 2);
  assert.equal(scripted.requests[0].body.messages[0].content, seedOf('champion-386'));
});

test('tier 0 accepts the champion and rejects an empty script', () => {
  assert.equal(tier0(champion).pass, true);
  assert.equal(tier0(canonical).pass, true);
  const empty = tier0('');
  assert.equal(empty.pass, false);
  assert.ok(empty.checks.every(check => !check.ok));
});

test('the regenerated champion passes the computed-value gate inside just-bash', async () => {
  const report = await runGate(Bash, champion);
  assert.deepEqual(report.fails, []);
  assert.equal(report.pass, true);
  assert.equal(report.calls, 3);
  assert.ok(report.checks.every(check => check.ok));
  assert.match(report.stderr, /A1-42/);
});

test('the hand-written shprout passes the same gate', async () => {
  const report = await runGate(Bash, canonical);
  assert.deepEqual(report.fails, []);
  assert.equal(report.calls, 3);
});

test('the gate names the failure of an agent that forgets its history', async () => {
  const forgetful = champion.replace('prompt="$prompt\n\nASSISTANT:', 'prompt="$(<"$0")\n\nASSISTANT:');
  assert.notEqual(forgetful, champion);
  const report = await runGate(Bash, forgetful);
  assert.equal(report.pass, false);
  assert.ok(report.fails.includes('history-not-cumulative'), report.fails.join(', '));
});

test('the gate names the failure of an agent that dies after one turn', async () => {
  const single = champion.replace('for i in $(seq 1 20); do', 'for i in 1; do');
  assert.notEqual(single, champion);
  const report = await runGate(Bash, single);
  assert.equal(report.pass, false);
  assert.ok(report.fails.includes('died-after-turn-1'), report.fails.join(', '));
});

test('the gate rejects a script that never calls the model', async () => {
  const report = await runGate(Bash, '#!/bin/bash\necho "$1"\n');
  assert.equal(report.pass, false);
  assert.ok(report.fails.includes('no-api-call'));
  assert.ok(report.fails.includes('missing:curl'));
});

test('self-image swap replaces the $0 self-read and keeps the fallback', () => {
  for (const source of [champion, canonical]) {
    const { source: swapped, matches } = applySelfImage(source);
    assert.equal(matches, 1);
    assert.match(swapped, /\$\(<"\$\{SHPROUT_SELF:-\$0\}"\)/);
  }
  assert.equal(applySelfImage('cat "$0"; cat $0; cat -- "$0"').matches, 3);
  assert.equal(applySelfImage('echo nothing').matches, 0);
});

test('with the seed as self-image the model sees the seed, not the code', async () => {
  const scripted = createScriptedFetch({ replies: GATE_REPLIES });
  const seed = seedOf('champion-386');
  const { bash, swapped } = mountAgent(Bash, { source: champion, fetch: scripted.fetch, selfImage: 'seed', seed });
  assert.equal(swapped, 1);
  const result = await bash.exec(`bash /home/user/agent '${GATE_TASK}'`);
  assert.equal(scripted.requests.length, 3);
  const first = scripted.requests[0].body.messages[0].content;
  assert.ok(first.startsWith(seed), 'prompt starts with the seed');
  assert.ok(!first.includes('jq -n'), 'prompt does not contain the source');
  assert.ok(first.includes(GATE_TASK));
  assert.match(scripted.requests[2].body.messages[0].content, /B2-ok/);
  assert.ok(result.exitCode >= 0);
});

test('every micro-bench task is solvable and checked deterministically', async () => {
  const solutions = {
    grepcount: ['```bash\nseq 1 999 | grep -c 7\n```', 'exit'],
    arith: ['```bash\necho $((1234*5678))\n```', 'exit'],
    mkfile: ["```bash\nprintf 'hello shprout\\n' > hello.txt\n```", 'exit'],
    multistep: ['```bash\nmkdir -p out && echo alpha > out/a.txt && echo beta > out/b.txt && cat out/a.txt out/b.txt > out/ab.txt\n```', 'exit'],
    recover: ['```bash\nfrobnicate99 --go\n```', '```bash\necho RECOVERED\n```', 'exit'],
    hash8: ['```bash\nprintf %s shprout | sha256sum | cut -c1-8\n```', 'exit'],
  };
  for (const task of TASKS) {
    assert.ok(solutions[task.id], `no solution for ${task.id}`);
    const scripted = createScriptedFetch({ replies: solutions[task.id] });
    const { bash } = mountAgent(Bash, { source: champion, fetch: scripted.fetch });
    const run = await runTask(bash, task, { signal: AbortSignal.timeout(20000) });
    assert.equal(run.pass, true, `${task.id}: ${run.output}`);
    assert.equal(scripted.requests.length, solutions[task.id].length);
    assert.ok(!run.files.has('agent'), 'agent source is hidden from the workspace');
  }
  const wrong = createScriptedFetch({ replies: ['```bash\necho 42\n```', 'exit'] });
  const { bash } = mountAgent(Bash, { source: champion, fetch: wrong.fetch });
  assert.equal((await runTask(bash, taskById('arith'), {})).pass, false);
});

test('control and cap constants are what the UI expects', () => {
  assert.deepEqual(CONTROL, { id: 'handwritten-1599', label: 'hand-written', path: '/shprout.txt', control: true });
  assert.equal(utf8Bytes(canonical), 1599);
  assert.deepEqual(RUN_CAP, { calls: 8, ms: 90000 });
});

test('scrubbing replies stops a model from passing a print task by merely saying the answer', async () => {
  assert.equal(scrubReplies('a\n 7006652 \nb', ['x\n7006652']), 'a\nb');
  assert.equal(scrubReplies('> 271\nbash: 271: command not found\n271', ['271']), '');
  assert.equal(scrubReplies('kept', []), 'kept');
  const prose = await runScripted(champion, taskById('arith'), ['The answer is 7006652', 'exit']);
  assert.equal(prose.run.pass, false, prose.run.output);
  assert.ok(prose.run.output.includes('7006652'), 'the raw output still shows what the model said');
  assert.equal(taskById('arith').check({ files: prose.run.files, output: prose.run.output }), true, 'without scrubbing the prose would have passed');
  const real = await runScripted(champion, taskById('arith'), ['```bash\necho $((1234*5678))\n```', 'exit']);
  assert.equal(real.run.pass, true, real.run.output);
  const bare = await runScripted(champion, taskById('grepcount'), ['271', 'exit']);
  assert.equal(bare.run.pass, false, bare.run.output);
  const sentence = await runScripted(champion, taskById('grepcount'), ['There are 271 of them.', 'exit']);
  assert.equal(sentence.run.pass, false, sentence.run.output);
});

test('measureRequest verifies the self-image inside a real request', async () => {
  const seed = seedOf('champion-386');
  const report = await runGate(Bash, champion);
  const first = measureRequest(report.requests[0].raw, { code: champion, seed });
  assert.equal(first.selfVerified, true);
  assert.equal(first.selfBytes, utf8Bytes(champion.trimEnd()));
  assert.equal(first.seedVerified, false);
  assert.equal(first.seedBytes, 0);
  assert.equal(first.delta, null);
  assert.ok(first.promptBytes > first.selfBytes && first.bytes > first.promptBytes);
  const second = measureRequest(report.requests[1].raw, { code: champion, seed }, first.bytes);
  assert.ok(second.delta > 0, `delta ${second.delta}`);
  assert.equal(second.delta, second.bytes - first.bytes);
  const scripted = createScriptedFetch({ replies: GATE_REPLIES });
  const { bash } = mountAgent(Bash, { source: champion, fetch: scripted.fetch, selfImage: 'seed', seed });
  await bash.exec(`bash /home/user/agent '${GATE_TASK}'`);
  const seeded = measureRequest(scripted.requests[0].raw, { code: champion, seed });
  assert.equal(seeded.selfVerified, false);
  assert.equal(seeded.selfBytes, 0);
  assert.equal(seeded.seedVerified, true);
  assert.equal(seeded.seedBytes, utf8Bytes(seed));
  assert.deepEqual(measureRequest('not json'), { bytes: 8, promptBytes: 0, selfBytes: 0, selfVerified: false, seedBytes: 0, seedVerified: false, delta: null });
  assert.equal(measureRequest(report.requests[0].raw, {}).selfVerified, false, 'empty code never verifies');
});

test('metered fetch retries on 429, counts calls, caps, and aborts', async () => {
  const statuses = [429, 429, 200];
  const inner = async () => completion(statuses.shift() ?? 200, 'exit');
  const events = [];
  const turns = [];
  const metered = createMeteredFetch(inner, { code: champion, onEvent: event => events.push(event), onTurn: turn => turns.push(turn), backoffMs: [0, 0, 0], maxCalls: 2 });
  const body = JSON.stringify({ model: 'x', messages: [{ role: 'user', content: `${champion.trimEnd()}\nTASK` }] });
  const response = await metered.fetch(POLLI_ENDPOINT, { method: 'POST', body });
  assert.equal(response.status, 200);
  assert.deepEqual(events, [{ type: 'retry', attempt: 1, status: 429 }, { type: 'retry', attempt: 2, status: 429 }]);
  assert.equal(metered.calls(), 1);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].index, 0);
  assert.equal(turns[0].content, 'exit');
  assert.equal(turns[0].raw, body);
  assert.equal(turns[0].measure.selfVerified, true);
  assert.equal(turns[0].measure.delta, null);
  await metered.fetch(POLLI_ENDPOINT, { method: 'POST', body });
  assert.equal(metered.calls(), 2);
  assert.equal(turns[1].index, 1);
  assert.equal(turns[1].measure.delta, 0);
  await assert.rejects(metered.fetch(POLLI_ENDPOINT, { method: 'POST', body }), error => error.name === 'AbortError');
  assert.deepEqual(events.at(-1), { type: 'cap', calls: 2 });
  assert.equal(metered.calls(), 2);
  assert.equal(turns.length, 2);

  let attempts = 0;
  const exhausted = createMeteredFetch(async () => { attempts += 1; return completion(503); }, { backoffMs: [0], retries: 3, onTurn: () => assert.fail('no turn on a failed call') });
  assert.equal((await exhausted.fetch(POLLI_ENDPOINT, { method: 'POST', body })).status, 503);
  assert.equal(attempts, 4);

  const slow = createMeteredFetch(async () => completion(503), { backoffMs: [60000], retries: 1 });
  const started = Date.now();
  const pending = slow.fetch(POLLI_ENDPOINT, { method: 'POST', body });
  setTimeout(() => slow.abort(), 20);
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.ok(Date.now() - started < 1000, 'abort interrupts the backoff wait');
  await assert.rejects(slow.fetch(POLLI_ENDPOINT, { method: 'POST', body }), error => error.name === 'AbortError');
});

test('sabotage chips each hit the champion once and the gate names the damage', async () => {
  assert.deepEqual(SABOTAGE.map(chip => chip.id), ['drop-eval', 'forget-history', 'never-stop', 'curl-n']);
  for (const chip of SABOTAGE) {
    const hit = applySabotage(champion, chip.id);
    assert.equal(hit.matches, 1, chip.id);
    assert.notEqual(hit.source, champion, chip.id);
    assert.equal(hit.source.split('\n').length, champion.split('\n').length, `${chip.id} keeps line numbers`);
    assert.ok(champion.includes(hit.diff.before) && hit.source.includes(hit.diff.after), chip.id);
    assert.notEqual(hit.diff.before, hit.diff.after, chip.id);
    assert.ok(!hit.diff.before.includes('\n') && !hit.diff.after.includes('\n'), `${chip.id} diff is one line`);
    const miss = applySabotage('echo hi', chip.id);
    assert.equal(miss.matches, 0, chip.id);
    assert.equal(miss.source, 'echo hi');
  }
  assert.throws(() => applySabotage(champion, 'nope'));

  const dropped = applySabotage(champion, 'drop-eval');
  assert.ok(dropped.diff.before.includes('eval') && dropped.diff.after.includes('echo'));
  const noEval = await runGate(Bash, dropped.source);
  assert.equal(noEval.pass, false);
  assert.ok(noEval.fails.includes('missing:eval'), noEval.fails.join(', '));

  const forgetful = await runGate(Bash, applySabotage(champion, 'forget-history').source);
  assert.equal(forgetful.pass, false);
  assert.ok(forgetful.fails.includes('history-not-cumulative'), forgetful.fails.join(', '));

  const endless = await runGate(Bash, applySabotage(champion, 'never-stop').source);
  assert.equal(endless.pass, false);
  assert.ok(endless.fails.some(fail => fail.startsWith('no-termination')), endless.fails.join(', '));

  const streamed = await runGate(Bash, applySabotage(champion, 'curl-n').source);
  assert.equal(streamed.pass, false);
  const limit = classifySandboxLimit(streamed.stderr);
  assert.ok(limit, streamed.stderr);
  assert.match(limit.what, /curl -N/);
  assert.equal(classifySandboxLimit(''), null);
  assert.equal(classifySandboxLimit(undefined), null);
});

test('fingerprints are 8 hex chars, stable, and distinct per source', async () => {
  const a = await fingerprint(champion);
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(await fingerprint(champion), a);
  assert.notEqual(await fingerprint(canonical), a);
  assert.equal(await fingerprint('abc'), 'ba7816bf', 'sha256("abc") prefix');
});

test('compression floor picks the smallest pass and the largest fail below it', () => {
  assert.deepEqual(compressionFloor([{ bytes: 388, pass: true }, { bytes: 254, pass: false }, { bytes: 517, pass: true }]), { floorBytes: 388, firstFailBytes: 254 });
  assert.deepEqual(compressionFloor([{ bytes: 388, pass: true }, { bytes: 517, pass: true }]), { floorBytes: 388, firstFailBytes: null });
  assert.deepEqual(compressionFloor([{ bytes: 254, pass: false }, { bytes: 147, pass: false }]), { floorBytes: null, firstFailBytes: 254 });
  assert.deepEqual(compressionFloor([{ bytes: 388, pass: true }, { bytes: 400, pass: false }, { bytes: 254, pass: false }, { bytes: 147, pass: false }]), { floorBytes: 388, firstFailBytes: 254 });
  assert.deepEqual(compressionFloor([]), { floorBytes: null, firstFailBytes: null });
});

// Scripted replies that solve each task through both the regenerated champion
// (evals every line, stops on a bare exit) and the hand-written shprout (runs the
// first fence, stops on a reply without one).
const SOLUTIONS = {
  grepcount: ['```bash\nseq 1 999 | grep -c 7\n```', 'exit'],
  arith: ['```bash\necho $((1234*5678))\n```', 'exit'],
  mkfile: ["```bash\nprintf 'hello shprout\\n' > hello.txt\n```", 'exit'],
  multistep: ['```bash\nmkdir -p out && echo alpha > out/a.txt && echo beta > out/b.txt && cat out/a.txt out/b.txt > out/ab.txt\n```', 'exit'],
  recover: ['```bash\nfrobnicate99 --go\n```', '```bash\necho RECOVERED\n```', 'exit'],
  hash8: ['```bash\nprintf %s shprout | sha256sum | cut -c1-8\n```', 'exit'],
};

test('scripted solutions pass every task through both the champion and the hand-written agent', async () => {
  assert.deepEqual(Object.keys(SOLUTIONS).sort(), TASKS.map(task => task.id).sort());
  for (const [name, source] of agents) {
    for (const task of TASKS) {
      const replies = SOLUTIONS[task.id];
      assert.ok(replies.length >= 2 && replies.at(-1) === 'exit', `${task.id} ends with exit`);
      assert.ok(replies.slice(0, -1).every(reply => reply.startsWith('```bash\n')), `${task.id} replies are fences`);
      const { run, scripted } = await runScripted(source, task, replies);
      assert.equal(run.pass, true, `${name}/${task.id}: ${run.output}`);
      assert.equal(scripted.requests.length, replies.length, `${name}/${task.id} call count`);
      assert.ok(!run.files.has('agent'));
    }
  }
});

test('code and seed lanes run side by side; the seed lane sends far fewer bytes', async () => {
  const seed = seedOf('champion-386');
  const replies = SOLUTIONS.arith;
  const task = taskById('arith');
  const [code, seeded] = await Promise.all([
    runScripted(champion, task, replies),
    runScripted(champion, task, replies, { selfImage: 'seed', seed }),
  ]);
  assert.equal(code.run.pass, true, code.run.output);
  assert.equal(seeded.run.pass, true, seeded.run.output);
  const codeBytes = utf8Bytes(code.scripted.requests[0].raw);
  const seedBytes = utf8Bytes(seeded.scripted.requests[0].raw);
  assert.ok(codeBytes - seedBytes >= 1000, `code ${codeBytes} B vs seed ${seedBytes} B`);
  assert.equal(measureRequest(seeded.scripted.requests[0].raw, { code: champion, seed }).seedVerified, true);
  assert.equal(measureRequest(code.scripted.requests[0].raw, { code: champion, seed }).selfVerified, true);
});

test('the call cap stops an agent that never says exit', async () => {
  const scripted = createScriptedFetch({ replies: ['```bash\necho again\n```'] });
  const controller = new AbortController();
  const events = [];
  const metered = createMeteredFetch(scripted.fetch, {
    maxCalls: 3,
    onEvent: event => { events.push(event); if (event.type === 'cap') controller.abort(); },
  });
  const { bash } = mountAgent(Bash, { source: champion, fetch: metered.fetch });
  const started = Date.now();
  const outcome = await runTask(bash, taskById('arith'), { signal: controller.signal }).then(run => ({ run }), error => ({ error }));
  assert.ok(Date.now() - started < 5000, 'the run ends promptly');
  if (outcome.error) assert.match(outcome.error.name, /Abort/, outcome.error.message);
  else assert.equal(outcome.run.pass, false);
  assert.equal(metered.calls(), 3);
  assert.equal(scripted.requests.length, 3);
  assert.deepEqual(events.filter(event => event.type === 'cap'), [{ type: 'cap', calls: 3 }]);
});

test('sandbox limit patterns match what just-bash actually prints', async () => {
  assert.equal(SANDBOX_LIMITS.length, 5);
  const noNetwork = async () => completion(200, 'unused');
  for (const limit of SANDBOX_LIMITS) {
    assert.ok(limit.test instanceof RegExp && !limit.test.global, limit.what);
    assert.ok(typeof limit.probe === 'string' && limit.probe, limit.what);
    const bash = new Bash({ files: { '/home/user/agent': 'echo hi\n' }, cwd: '/home/user', fetch: noNetwork });
    const result = await bash.exec(limit.probe);
    assert.notEqual(result.exitCode, 0, limit.probe);
    assert.equal(classifySandboxLimit(result.stderr), limit, `${limit.probe} -> ${JSON.stringify(result.stderr)}`);
  }
  const fine = new Bash({ files: {}, cwd: '/home/user', fetch: noNetwork });
  assert.equal(classifySandboxLimit((await fine.exec('printf %s shprout | sha256sum')).stderr), null);
});

test('a typed task runs through the agent without an automatic verdict', async () => {
  const typed = "  Print the word banana, don't add anything.\nThen say exit.  ";
  const task = customTask(typed);
  assert.equal(task.id, 'custom');
  assert.equal(task.custom, true);
  assert.equal(task.prompt, typed.trim());
  const replies = ['```bash\necho ban""ana\n```', 'exit'];
  for (const [name, source] of agents) {
    const { run, scripted } = await runScripted(source, task, replies);
    assert.equal(run.pass, null, `${name}: no automatic pass/fail`);
    // The reply spells the word as ban""ana, so a bare "banana" can only come from the shell.
    assert.ok(scrubReplies(run.output, replies).includes('banana'), `${name}: ${run.output}`);
    assert.equal(scripted.requests.length, 2, `${name} call count`);
    const sent = (scripted.requests[0].body?.messages ?? []).map(message => message.content).join('\n');
    assert.ok(sent.includes(task.prompt), `${name}: the typed task, quote and newline included, reaches the model`);
  }
});

test('bare replies count as the command, fenced replies keep their thought, exit is not a command', () => {
  assert.deepEqual(replyParts('```bash\necho hi\n```'), { thought: '', action: 'echo hi' });
  assert.deepEqual(replyParts('Let me look.\n```sh\nls -la\n```'), { thought: 'Let me look.', action: 'ls -la' });
  assert.deepEqual(replyParts("cat <<'EOF'\n  art\nEOF"), { thought: '', action: "cat <<'EOF'\n  art\nEOF" });
  assert.deepEqual(replyParts('exit'), { thought: 'exit', action: '' });
  assert.deepEqual(replyParts('  Exit.\n'), { thought: 'Exit.', action: '' });
  assert.deepEqual(replyParts(''), { thought: '', action: '' });
});

test("the shell's answer is recovered from whatever history format the grown script invented", () => {
  assert.deepEqual(outputFromAppended('\nASSISTANT:\necho hi\nOUTPUT (rc=0):\nhi\n', 'echo hi'), { rc: '0', out: 'hi' });
  assert.deepEqual(outputFromAppended('\n--- you ---\necho hi\n--- bash ---\nhi\n', 'echo hi'), { rc: null, out: 'hi' });
  const art = "cat <<'EOF'\n  ┌───┐\n  │ me │\n  └───┘\nEOF";
  const chunk = `\n\n=== TURN 1 CMD ===\n${art}\n\n=== TURN 1 OUTPUT ===\n  ┌───┐\n  │ me │\n  └───┘\n`;
  assert.deepEqual(outputFromAppended(chunk, art), { rc: null, out: '  ┌───┐\n  │ me │\n  └───┘' }, 'the first line keeps its indentation');
  assert.deepEqual(outputFromAppended('\necho hi\n--- output ---\nhi\n[exit status 1]\n', '```bash\necho hi\n```'), { rc: '1', out: 'hi' });
  assert.deepEqual(outputFromAppended('Command: echo hi\nOutput:\n```\nhi\n```\n', 'echo hi'), { rc: null, out: 'hi' });
  assert.deepEqual(outputFromAppended('\n>>> reply\n$ echo hi\n>>> result\nhi\n', 'echo hi'), { rc: null, out: 'hi' });
  assert.deepEqual(outputFromAppended('\nASSISTANT:\ntrue\nOUTPUT (rc=0):\n', 'true'), { rc: '0', out: '' });
});
