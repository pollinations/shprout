// jsprout — write ONE async function body in a ```js fence. I build it with
// `new AsyncFunction(...names, code)` and call it with these names in scope:
//
//   stage    — YOUR DOM element. Paint inside it. Don't touch anything outside.
//              At the root this is #stage. When your parent spawned you with
//              a `{task, stage}` spec, this is the element they handed you.
//   console  — { log, warn, error } — captured to your output panel and log.
//   fetch    — same as window.fetch.
//
// To continue, fan out, or stop: RETURN AN ARRAY of task specs.
//   return []                                          // done. nothing else runs.
//   return ['next thing']                              // one more turn, serial
//   return ['A', 'B', 'C']                             // fan out: 3 parallel children
//   return [{ task: 'A', stage: aEl },                 // give children their own slots
//           { task: 'B', stage: bEl }]
//
// Each element is either a string (becomes {task: string}) or {task, stage?}.
// stage defaults to your stage if omitted. Children run after your code finishes,
// so any DOM/global state you set is visible to them. Return ANYTHING ELSE
// (undefined, a number, a string) and execution stops — only arrays continue.
//
// Children inherit your full log up to and including this turn, then get their
// own <task>...</task> appended. Siblings do NOT see each other's logs.
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
  let value;
  try {
    const fn = new AsyncFn(...Object.keys(fullScope), code);
    value = await fn(...Object.values(fullScope));
    if (value !== undefined) logs.push(`=> ${JSON.stringify(value)}`);
  } catch (e) { logs.push(`!! ${e.stack || e.message}`); }
  return { text: logs.join('\n') || '(no output)', value };
};

const extract = rsp => rsp.match(/^```[^\n]*\n([\s\S]*)/m)?.[1]?.trim();
const append = (log, rsp, out) => `${log}\n--- you ---\n${rsp}\n--- js ---\n${out}\n`;
const start = task => `<task>${task}</task>\n#log\n`;

const step = async (ctx, log, stage) => {
  const rsp = await think(ctx, log);
  ctx.show('prose', rsp);
  const code = extract(rsp);
  if (!code) return;
  ctx.show('code', code);
  const out = await act(code, { stage, fetch: window.fetch.bind(window) });
  ctx.show('out', out.text);
  if (!Array.isArray(out.value) || out.value.length === 0) return;
  const nextLog = append(log, rsp, out.text);
  await Promise.allSettled(out.value.map(item => {
    const spec = typeof item === 'string' ? { task: item } : item;
    return step(ctx, `${nextLog}<task>${spec.task}</task>\n`, spec.stage ?? stage);
  }));
};

export const jsprout = async ({ task, model, key, show }) => {
  const sys = await fetch(import.meta.url).then(r => r.text());
  return step({ sys, model, key, show }, start(task), document.getElementById('stage'));
};
