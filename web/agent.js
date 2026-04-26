// jsprout — you think out loud. Put JS in a ```js fence; I eval it.
// Last expression is your "result" (DevTools-style). console.log is captured;
// console.error/warn show up prefixed `!!` / `?`. The DOM persists between turns.
// #stage is yours to paint.
//
// YOUR CURRENT TASK is whatever's in the LAST <task>...</task> tag in the log.
// Earlier <task> tags are history — what previous turns/parents were working on.
//
// THE LOOP IS YOURS. There is no auto-recursion. After your code runs,
// jsprout halts UNLESS your code calls jsprout() before returning.
//   jsprout()            → another turn, same task, you'll see the JS output
//   jsprout({ task })    → spawn a sub-agent: log carries over, fresh <task> appended
//   (don't call it)      → you're done
// Multiple jsprout({ task }) calls in one turn = parallel sub-agents (fan-out).
// They share the parent log up to this point, then each gets its own task.
// They race on the DOM, so isolate their writes (e.g. each to its own #divN).

const think = (ctx, log) => fetch('https://gen.pollinations.ai/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.key}` },
  body: JSON.stringify({ model: ctx.model, stop: ['```\n'],
    messages: [{ role: 'system', content: ctx.sys }, { role: 'user', content: log }] }),
}).then(r => r.json()).then(r => r.choices[0].message.content);

const act = async code => {
  const logs = [], orig = { log: console.log, error: console.error, warn: console.warn };
  const cap = tag => (...a) => logs.push(`${tag}${a.map(String).join(' ')}`);
  console.log = cap(''); console.error = cap('!! '); console.warn = cap('? ');
  try {
    const ret = await (0, eval)(code);
    if (ret !== undefined) logs.push(`=> ${String(ret)}`);
  } catch (e) { logs.push(`!! ${e.stack || e.message}`); }
  Object.assign(console, orig);
  return logs.join('\n');
};

const extract = rsp => rsp.match(/^```[^\n]*\n([\s\S]*)/m)?.[1]?.trim();
const append = (log, rsp, out) => `${log}\n--- you ---\n${rsp}\n--- js ---\n${out}\n`;
const start = task => `<task>${task}</task>\n#log\n`;

// one turn: think → act. Model continues by calling jsprout() inside its code.
const step = async (ctx, task, log) => {
  const rsp = await think(ctx, log);
  const code = extract(rsp);
  ctx.show('prose', rsp);
  if (!code) return;
  ctx.show('code', code);
  window.jsprout = (o = {}) => {
    const carried = append(log, rsp, o.log ?? '(pending)');
    return step(ctx, o.task ?? task, o.task ? `${carried}\n<task>${o.task}</task>\n` : carried);
  };
  const out = await act(code);
  ctx.show('out', out);
};

export const jsprout = async ({ task, model, key, show }) => {
  const sys = await fetch(import.meta.url).then(r => r.text());
  return step({ sys, model, key, show }, task, start(task));
};
