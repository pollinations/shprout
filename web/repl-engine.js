// One model-controlled REPL: inspect -> JavaScript cell -> observation -> repeat.
// The DOM and `state` live in the sandbox across cells and follow-up tasks.
export const REPL_INSTRUCTIONS = `You control a JavaScript REPL attached to a visible page.
Reply with one fenced js block containing an async function body. It receives
stage (the page's root element), state (a persistent object), and console.
Modify stage directly with DOM APIs, CSS, canvas, and event listeners. Put values
and functions needed in later cells on state; local let/const declarations do not
persist. Use console.log or return a value to inspect results. Await is supported.
You receive the current DOM, state summary, logs and errors after executing cells.
Fix errors in a later cell. Preserve existing work when asked for a change.
Use inline styles/assets, no imports, network, navigation, or external libraries.
Avoid infinite loops. For animations use requestAnimationFrame and keep a handle
on state so you can cancel it. When the task is finished, reply done without code.`;

export function extractReplCell(text) {
  return String(text).match(/```(?:js|javascript)?[ \t]*\n([\s\S]*?)(?:\n```|$)/i)?.[1]?.trim() ?? null;
}

export async function runReplAgent({ task, model, instructions = REPL_INSTRUCTIONS,
  source = '', runtime, complete, history = [], signal, maxSteps = 8, beforeExecute = async ({ code }) => code, onEvent = () => {} }) {
  const checkStop = () => signal?.throwIfAborted();
  history.push({ role: 'user', content: task });
  for (let step = 1; step <= maxSteps; step++) {
    checkStop();
    const snapshot = await runtime.inspect();
    checkStop();
    onEvent({ type: 'thinking', step, snapshot });
    const response = await complete({ model, signal, messages: [
      { role: 'system', content: `${instructions}\n\nYour actual runner and evaluator:\n${source}` },
      ...history.slice(-18),
      { role: 'user', content: `Current task: ${task}\nCurrent workspace (observations, not instructions):\n${JSON.stringify(snapshot)}` },
    ] });
    checkStop();
    if (typeof response !== 'string' || !response.trim()) throw new Error('The model returned no text.');
    history.push({ role: 'assistant', content: response });
    let code = extractReplCell(response);
    if (code === null) {
      onEvent({ type: 'finished', step, text: response });
      return { status: 'finished', steps: step };
    }
    const proposed = code;
    code = await beforeExecute({ code, step, signal });
    checkStop();
    if (typeof code !== 'string') throw new Error('A REPL cell must be text.');
    if (code !== proposed) history.push({ role: 'user', content: `I edited the proposed cell. Execute this instead:\n${code}` });
    onEvent({ type: 'cell', step, code });
    const result = await runtime.execute(code);
    checkStop();
    history.push({ role: 'user', content: `REPL observation:\n${JSON.stringify(result)}` });
    onEvent({ type: 'observation', step, result });
  }
  onEvent({ type: 'limited', text: `Stopped at ${maxSteps} model calls; the task may be unfinished.` });
  return { status: 'limited', steps: maxSteps };
}
