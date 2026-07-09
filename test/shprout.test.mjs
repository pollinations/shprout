import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Bash } from 'just-bash/browser';

const source = await readFile(new URL('../shprout', import.meta.url), 'utf8');
const browserSource = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const encoder = new TextEncoder();

function createRun(responses, { heartbeat = false } = {}) {
  const requests = [];
  const fetch = async (url, options = {}) => {
    const headers = Object.fromEntries(new Headers(options.headers));
    requests.push({ url, options: { ...options, headers }, body: JSON.parse(options.body) });
    const content = responses.shift();
    assert.notEqual(content, undefined, 'unexpected model request');
    return {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: encoder.encode(JSON.stringify({ choices: [{ message: { content } }] })),
      url,
    };
  };

  const bash = new Bash({
    files: {
      '/home/user/shprout': source,
      '/home/user/.shprout/SOUL.md': 'Prefer verified changes.',
      '/home/user/.shprout/GOAL.md': 'Reach the old goal.',
      '/home/user/.shprout/RECENT.md': 'A previous run found a clue.',
      '/home/user/.shprout/HEARTBEAT.md': 'Check whether the goal is blocked.',
    },
    cwd: '/home/user',
    env: {
      OPENAI_API_KEY: 'managed-by-host',
      OPENAI_BASE_URL: 'https://example.test/v1',
      MODEL: 'test-model',
      SHPROUT_RUNTIME: 'just-bash test runtime',
      SHPROUT_HEARTBEAT: heartbeat ? '1' : '0',
    },
    fetch,
  });

  return { bash, requests };
}

test('runs fenced bash and carries refreshed state and output into the next turn', async () => {
  const { bash, requests } = createRun([
    "I will update the goal and inspect the result.\n```bash\nprintf 'Reach the new goal.' > .shprout/GOAL.md\nprintf 'JUST_BASH_OK\\n'\n```",
    'The command succeeded, so I am done.',
  ]);

  const result = await bash.exec("bash /home/user/shprout 'compatibility marker'");

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /JUST_BASH_OK/);
  assert.match(result.stdout, /The command succeeded/);
  assert.equal(requests.length, 2);

  const firstPrompt = requests[0].body.messages[0].content;
  assert.match(firstPrompt, /<you>#!\/bin\/bash/);
  assert.match(firstPrompt, /<runtime>just-bash test runtime<\/runtime>/);
  assert.match(firstPrompt, /<task>compatibility marker<\/task>/);
  assert.match(firstPrompt, /<soul>Prefer verified changes\.<\/soul>/);
  assert.match(firstPrompt, /<goal>Reach the old goal\.<\/goal>/);
  assert.match(firstPrompt, /<recent>A previous run found a clue\.<\/recent>/);
  assert.doesNotMatch(firstPrompt, /<heartbeat>Check whether the goal is blocked\.<\/heartbeat>/);

  const secondPrompt = requests[1].body.messages[0].content;
  assert.match(secondPrompt, /<goal>Reach the new goal\.<\/goal>/);
  assert.match(secondPrompt, /JUST_BASH_OK/);
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.authorization, 'Bearer managed-by-host');
});

test('a prose-only response is printed and terminates without executing', async () => {
  const { bash, requests } = createRun(['Nothing needs to run.']);
  const result = await bash.exec("bash /home/user/shprout 'answer only'");

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /> Nothing needs to run\./);
  assert.equal(requests.length, 1);
});

test('heartbeat state is included only when explicitly enabled', async () => {
  const { bash, requests } = createRun(['HEARTBEAT_OK'], { heartbeat: true });
  const result = await bash.exec("bash /home/user/shprout 'heartbeat'");

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(requests[0].body.messages[0].content, /<heartbeat>Check whether the goal is blocked\.<\/heartbeat>/);
});

test('browser network config bypasses the unavailable DNS resolver', () => {
  assert.match(browserSource, /denyPrivateRanges:\s*false/);
  assert.match(browserSource, /allowedMethods:\s*\['POST'\]/);
  assert.match(browserSource, /Authorization:\s*`Bearer \$\{apiKey\}`/);
});
