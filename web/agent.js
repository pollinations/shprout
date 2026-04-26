// jsprout — you think out loud. Put JS in a ```js fence; I eval it.
// Last expression is your "result" (DevTools-style). console.log is captured.
// No top-level await — return a Promise (e.g. fetch(u).then(r=>r.text())) instead.
// The DOM persists between turns. #stage is yours to paint into.
// No fence = you're done. Don't apologize. Don't explain. Just do.
const think = (key, model, sys, log) => fetch('https://gen.pollinations.ai/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({ model, stop: ['```\n'],
    messages: [{ role: 'system', content: sys }, { role: 'user', content: log }] }),
}).then(r => r.json()).then(r => r.choices[0].message.content);

const act = async code => {
  const logs = [], orig = console.log;
  console.log = (...a) => logs.push(a.map(String).join(' '));
  try {
    const ret = await (0, eval)(code);
    if (ret !== undefined) logs.push(`=> ${String(ret)}`);
  } catch (e) { logs.push(`Error: ${e.message}`); }
  console.log = orig;
  return logs.join('\n');
};

export async function jsprout({ task, model, key, show }) {
  const sys = await fetch(import.meta.url).then(r => r.text());   // I am my own prompt
  let log = `<task>${task}</task>\n#log\n`;
  for (let i = 0; i < 20; i++) {                                  // heartbeat
    const rsp = await think(key, model, sys, log);                // think
    const code = rsp.match(/^```[^\n]*\n([\s\S]*)/m)?.[1]?.trim();
    show('prose', rsp);
    if (!code || code === 'exit') break;                          // done?
    show('code', code);
    const out = await act(code);                                  // act
    show('out', out);                                             // hear
    log += `\n--- you ---\n${rsp}\n--- js ---\n${out}\n`;         // remember
  }
}
