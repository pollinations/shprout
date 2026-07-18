import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const exec = promisify(execFile);
const candidate = resolve('approaches/lisp');
const source = await readFile(candidate, 'utf8');
let sbcl = false;
try { execFileSync('sbcl', ['--version'], { stdio: 'ignore' }); sbcl = true; } catch {}

test('Lisp profile contains the live-image agent contract', () => {
  for (const needle of ['agent-loop', 'call-model', 'read-from-string', 'eval', 'curl', 'jq', '*source-path*']) {
    assert.ok(source.includes(needle), `missing ${needle}`);
  }
  assert.match(source, /```lisp/);
});

test('Lisp definitions persist across turns and failures become observations', { skip: !sbcl }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lispprout-'));
  const fixture = join(dir, 'responses.lisp');
  const trace = join(dir, 'trace.lisp');
  const quote = value => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  const responses = [
    'Trying a missing capability.\n```lisp\n(gate-double 21)\n```',
    'I will install it in the live image.\n```lisp\n(defun gate-double (x) (* x 2))\n```',
    'Now I can reuse it.\n```lisp\n(gate-double 21)\n```',
    'The live-image check is complete.',
  ];
  await writeFile(fixture, responses.map(quote).join('\n'));

  try {
    const { stdout, stderr } = await exec(candidate, ['purpose-marker-a7x'], {
      env: {
        ...process.env,
        SHPROUT_LISP_FIXTURE: fixture,
        SHPROUT_TRACE: trace,
        SHPROUT_MAX_TURNS: '6',
      },
    });
    const prompts = await readFile(trace, 'utf8');
    assert.equal(stderr, '');
    assert.match(stdout, /ERROR:.*GATE-DOUBLE/is);
    assert.match(stdout, /=> GATE-DOUBLE/);
    assert.match(stdout, /=> 42/);
    assert.match(prompts, /purpose-marker-a7x/);
    assert.match(prompts, /ERROR:.*GATE-DOUBLE/is);
    assert.match(prompts, /=> 42/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
