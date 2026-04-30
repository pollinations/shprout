// polli-agent — a composable coding agent built around the Pollinations CLI.
//
// The outer loop thinks by running:
//   polli gen text "<self + log>" --model $MODEL --no-stream
//
// The point of this file is that the agent can understand itself without
// caring about raw chat-completions JSON. Polli is the model interface.
//
// Each turn, write ONE async JavaScript function body in a ```js fence.
// It runs immediately with these tools in scope:
//
//   polli(...args)          -> runs `polli ...args`
//                              examples:
//                                await polli("auth", "status")
//                                await polli("models", "--type", "text")
//                                await polli("gen", "text", "hi", "--no-stream")
//   read(path)              -> file text
//   write(path, text)       -> writes a file, creating parent dirs
//   sh(command)             -> { stdout, stderr, code, text }
//   check()                 -> sh("node check.mjs")
//   test()                  -> alias for check()
//   fetch                   -> global fetch
//   console                 -> captured into the next turn's log
//
// Continue by returning:
//   done()                  -> stop
//   again()                 -> continue with the same task
//   next("subtask")         -> continue with one composed subtask
//   split("A", "B")         -> run multiple composed subtasks sequentially
//
// Files, cwd, and globalThis persist between turns. Do not use import syntax
// inside the function body; this is AsyncFunction, not an ES module.

import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const AsyncFunction = (async () => {}).constructor;
const self = new URL(import.meta.url);
const sys = await fs.readFile(self, 'utf-8');

const polliCommand = process.env.POLLI || 'npx -y @pollinations_ai/cli@latest';
const polliParts = polliCommand.split(/\s+/).filter(Boolean);
const model = process.env.MODEL || 'openai-fast';
const rootTask = process.argv.slice(2).join(' ') || 'Use polli to generate a small demo artifact.';
const maxTurns = Number(process.env.MAX_TURNS || 6);

const run = async (cmd, args = [], options = {}) => {
  try {
    const { stdout, stderr } = await exec(cmd, args, {
      maxBuffer: 1024 * 1024,
      ...options,
    });
    return { stdout, stderr, code: 0, text: stdout + stderr };
  } catch (err) {
    const stdout = err.stdout || '';
    const stderr = err.stderr || err.message || '';
    return { stdout, stderr, code: err.code ?? 1, text: stdout + stderr };
  }
};

const sh = command => run('jsh', ['-c', command]);

const polli = (...args) => run(polliParts[0], [
  ...polliParts.slice(1),
  ...args.flat().filter(arg => arg !== undefined && arg !== null).map(String),
]);

const read = async file => fs.readFile(file, 'utf-8');

const write = async (file, text) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
  return `${file} (${Buffer.byteLength(text)}B)`;
};

const check = () => sh('node check.mjs');
const test = check;

const done = () => [];
const again = () => [{}];
const next = task => [{ task }];
const split = (...tasks) => tasks.flat().map(task => (
  typeof task === 'string' ? { task } : task
));

const chat = async log => {
  const prompt = `<self>\n${sys}\n</self>\n\n${log}\n\nReturn exactly one fenced JavaScript block.`;
  const result = await polli(
    'gen',
    'text',
    prompt,
    '--model',
    model,
    '--no-stream',
  );
  if (result.code === 0) return result.stdout.trim();
  const message = (result.stderr || result.stdout || 'polli command failed').trim();
  throw new Error(`${message}\n\nRun polli auth login --no-browser in this terminal, then try again.`);
};

const extract = response =>
  response.match(/```(?:js|javascript)?\n([\s\S]*?)```/i)?.[1]?.trim();

const append = (log, response, output) =>
  `${log}\n--- you ---\n${response}\n--- node ---\n${output}\n`;

const start = async task => `<task>${task}</task>
<workspace>
README.md
demo.html
polli-result.txt
check.mjs
tiny-agent.mjs
</workspace>
#log
`;

const act = async code => {
  const logs = [];
  const cap = prefix => (...values) => {
    logs.push(prefix + values.map(value =>
      typeof value === 'string' ? value : JSON.stringify(value)
    ).join(' '));
  };
  const scope = {
    polli,
    read,
    write,
    sh,
    check,
    test,
    fetch: globalThis.fetch,
    done,
    again,
    next,
    split,
    console: { log: cap(''), warn: cap('? '), error: cap('!! ') },
  };

  let value;
  try {
    value = await new AsyncFunction(...Object.keys(scope), code)(...Object.values(scope));
    if (value !== undefined) logs.push(`=> ${JSON.stringify(value)}`);
  } catch (err) {
    logs.push(`!! ${err.stack || err.message}`);
  }
  return { value, text: logs.join('\n') || '(no output)' };
};

const step = async (log, depth = 0) => {
  if (depth >= maxTurns) {
    console.log('!! max turns reached');
    return;
  }

  let response;
  try {
    response = await chat(log);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  console.log(response.split('\n').map(line => `> ${line}`).join('\n'));
  const code = extract(response);
  if (!code) return;

  console.log(`\n--- running ---\n${code}\n---`);
  const out = await act(code);
  console.log(out.text);

  if (!Array.isArray(out.value) || out.value.length === 0) return;
  const nextLog = append(log, response, out.text);
  for (const spec of out.value) {
    await step(spec?.task ? `${nextLog}<task>${spec.task}</task>\n` : nextLog, depth + 1);
  }
};

if (/\bpolli\s+(auth\s+)?login\b/i.test(rootTask)) {
  console.log('$ polli auth login --no-browser');
  const login = await polli('auth', 'login', '--no-browser');
  process.stdout.write(login.text);
  process.exit(login.code);
}

await step(await start(rootTask));
