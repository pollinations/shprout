import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));

test('arena runs two approaches in isolated just-bash instances', async () => {
  const turns = new Map();
  const auth = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      const body = JSON.parse(raw);
      const model = body.model;
      const turn = turns.get(model) || 0;
      turns.set(model, turn + 1);
      auth.push(request.headers.authorization);
      const content = turn === 0
        ? `\`\`\`bash\nprintf '${model}\\n'\n\`\`\``
        : 'Done.';
      const payload = JSON.stringify({ choices: [{ message: { content } }] });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(payload);
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['research/arena.mjs', 'arena marker', 'shprout', 'approaches/syscap'],
      {
        cwd: root,
        env: {
          ...process.env,
          OPENAI_API_KEY: 'arena-key',
          OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
          MODEL_A: 'model-a',
          MODEL_B: 'model-b',
        },
      },
    );
    const report = JSON.parse(stdout);
    assert.equal(report.results.length, 2);
    assert.match(report.results[0].stdout, /model-a/);
    assert.match(report.results[1].stdout, /model-b/);
    assert.deepEqual([...turns.values()], [2, 2]);
    assert.deepEqual(auth, Array(4).fill('Bearer arena-key'));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
