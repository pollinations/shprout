// jsprout — write ONE async function body in a ```js fence. I build it with
// `new AsyncFunction(...names, code)` and call it with these names in scope:
//
//   stage    — YOUR DOM element. Paint inside it. Don't touch anything outside.
//              At the root this is #stage. When your parent spawned you with
//              `jsprout({ task, stage: someEl })`, this is `someEl`.
//   console  — { log, warn, error } — captured to your output panel.
//   fetch    — same as window.fetch.
//   jsprout  — async (opts) => result. Spawns a sub-agent and resolves when it's done.
//
// Continuing or fanning out is just calling jsprout:
//   await jsprout({ task: 'next thing' })          // continue serially
//   await Promise.all([                            // fan out in parallel
//     jsprout({ task: 'A' }),
//     jsprout({ task: 'B' }),
//   ])
//   (don't call it)                                // you're done
//
// To give each child its OWN slot inside your stage (no DOM races):
//   const a = document.createElement('div'); stage.append(a);
//   const b = document.createElement('div'); stage.append(b);
//   await Promise.all([
//     jsprout({ task: 'paint A', stage: a }),
//     jsprout({ task: 'paint B', stage: b }),
//   ]);
//
// Sub-agents inherit your log up to this point, then get their own <task> appended.
// Your task is the LAST <task>...</task> in the log. Earlier ones are history.
// The DOM persists between turns. Globals you set on globalThis persist too.

const AsyncFn = (async function(){}).constructor;

const think = (ctx, log) => fetch('https://gen.pollinations.ai/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.key}` },
  body: JSON.stringify({ model: ctx.model, stop: ['```\n'],
    messages: [{ role: 'system', content: ctx.sys }, { role: 'user', content: log }] }),
}).then(r => r.json()).then(r => r.choices[0].message.content);

const act = async (code, scope) => {
  const logs = [];
  const cap = tag => (...a) => logs.push(`${tag}${a.map(String).join(' ')}`);
  const console = { log: cap(''), warn: cap('? '), error: cap('!! ') };
  const fullScope = { ...scope, console };
  try {
    const fn = new AsyncFn(...Object.keys(fullScope), code);
    const ret = await fn(...Object.values(fullScope));
    if (ret !== undefined) logs.push(`=> ${String(ret)}`);
  } catch (e) { logs.push(`!! ${e.stack || e.message}`); }
  return logs.join('\n') || '(no output)';
};

const extract = rsp => rsp.match(/^```[^\n]*\n([\s\S]*)/m)?.[1]?.trim();
const append = (log, rsp, out) => `${log}\n--- you ---\n${rsp}\n--- js ---\n${out}\n`;
const start = task => `<task>${task}</task>\n#log\n`;

const step = async (ctx, task, log, stage) => {
  const rsp = await think(ctx, log);
  ctx.show('prose', rsp);
  const code = extract(rsp);
  if (!code) return;
  ctx.show('code', code);
  const childLog = append(log, rsp, '(parent in-progress)');
  const jsprout = (o = {}) =>
    step(ctx, o.task ?? task,
         o.task ? `${childLog}\n<task>${o.task}</task>\n` : childLog,
         o.stage ?? stage);
  const out = await act(code, { stage, fetch: window.fetch.bind(window), jsprout });
  ctx.show('out', out);
};

export const jsprout = async ({ task, model, key, show }) => {
  const sys = await fetch(import.meta.url).then(r => r.text());
  return step({ sys, model, key, show }, task, start(task), document.getElementById('stage'));
};
