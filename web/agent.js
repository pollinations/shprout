// jsprout — you are a node in a tree of agents. Each turn, you write ONE async
// function in a ```js fence. I evaluate it. The function's BODY does the work
// (DOM, fetch, console, whatever). The function's RETURN VALUE is an array of
// children to spawn — each `{ task }` becomes a parallel sub-agent.
//
//   return []                              → you're done, this branch ends
//   return [{ task: 'X' }]                 → continue with task X
//   return [{ task: 'A' }, { task: 'B' }]  → fan out: A and B run in parallel
//
// Sub-agents inherit your full message history (system + every turn so far),
// then get their own <task> appended. They share the DOM — isolate writes to
// avoid races (e.g. each child writes its own #divN).
//
// Your task is the most recent <task path="..."> in the conversation. The path
// shows your position in the tree: "0" is root, "0.1" is the 2nd child of root,
// "0.1.2" is the 3rd child of that, etc. Use it to namespace DOM writes if you
// want collision-free fan-out: `<div id="d-${path}">`.
//
// Shape your code MUST take:
//   ```js
//   async () => {
//     // ... do work ...
//     return [];   // or [{ task: '...' }, ...]
//   }
//   ```
// I eval the fence, expect a function, call it, await it, and treat the result
// as your children. console.log/warn/error are captured (warn → `?`, error → `!!`).

const think = (ctx, messages) => fetch('https://gen.pollinations.ai/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.key}` },
  body: JSON.stringify({ model: ctx.model, stop: ['```\n'],
    messages: [{ role: 'system', content: ctx.sys }, ...messages] }),
}).then(r => r.json()).then(r => r.choices[0].message.content);

const act = async code => {
  const logs = [], orig = { log: console.log, error: console.error, warn: console.warn };
  const cap = tag => (...a) => logs.push(`${tag}${a.map(String).join(' ')}`);
  console.log = cap(''); console.error = cap('!! '); console.warn = cap('? ');
  let next = [];
  try {
    const fn = (0, eval)(code);
    if (typeof fn !== 'function') throw new Error(`expected an async function, got ${typeof fn}`);
    const ret = await fn();
    if (Array.isArray(ret)) next = ret;
    else if (ret !== undefined) logs.push(`!! return must be an array; got ${typeof ret}`);
  } catch (e) { logs.push(`!! ${e.stack || e.message}`); }
  Object.assign(console, orig);
  return { out: logs.join('\n') || '(no output)', next };
};

const extract = rsp => rsp.match(/^```[^\n]*\n([\s\S]*)/m)?.[1]?.trim();

const step = async (ctx, path, messages) => {
  const rsp = await think(ctx, messages);
  ctx.show('prose', rsp, path);
  const code = extract(rsp);
  if (!code) return;
  ctx.show('code', code, path);
  const { out, next } = await act(code);
  ctx.show('out', out, path);
  const nextMessages = [...messages,
    { role: 'assistant', content: rsp },
    { role: 'user', content: `--- js output ---\n${out}` }];
  return spawn(ctx, next, nextMessages, path);
};

const spawn = (ctx, items, messages, parentPath) =>
  Promise.all(items.map(({ task }, i) => {
    const path = `${parentPath}.${i}`;
    return step(ctx, path, [...messages, { role: 'user', content: `<task path="${path}">${task}</task>` }]);
  }));

export const jsprout = async ({ task, model, key, show }) => {
  const sys = await fetch(import.meta.url).then(r => r.text());
  return spawn({ sys, model, key, show }, [{ task }], [], '');
};
