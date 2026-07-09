import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));

for (const [name, args] of [
  ['canonical unfenced/stateful', ['shprout']],
  ['classic command-only', ['approaches/classic', '--classic']],
  ['split system with capped history', ['approaches/syscap', '--split-capped']],
  ['self-modifying source', ['approaches/self-mod', '--self-mod']],
]) {
  test(`${name} profile passes the just-bash gate`, async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['research/gate.mjs', ...args],
      { cwd: root },
    );
    const report = JSON.parse(stdout);
    assert.equal(report.pass, true, `${stderr}\n${stdout}`);
    assert.equal(report.calls, 3);
  });
}
