import { consumeAuthCallback, createAuthorizationUrl, clearAuthSession } from './auth.js';
import { createApiBridge, POLLI_ENDPOINT } from './workshop-runtime.js';
import { REPL_INSTRUCTIONS, extractReplCell, runReplAgent } from './repl-engine.js';
import { installReplSandbox } from './repl-sandbox.js';
import { createReplRuntime } from './repl-runtime.js';

const $ = selector => document.querySelector(selector);
const auth = consumeAuthCallback();
if (auth.cleanedUrl) history.replaceState(null, '', auth.cleanedUrl);
const key = auth.apiKey;
const source = `${extractReplCell.toString()}\n\n${runReplAgent.toString()}\n\n${installReplSandbox.toString()}`;
const variant = document.body.dataset.variant || 'original';
const store = `shprout.domReplDraft.${variant}`;
let runtime = null;
let controller = null;
let historyMessages = [];
let sessionCalls = 0;
$('#source').textContent = source;
$('#instructions').value = REPL_INSTRUCTIONS;
try {
  const saved = JSON.parse(sessionStorage.getItem(store) || 'null');
  if (saved) { $('#task').value = saved.task; $('#instructions').value = saved.instructions; }
} catch { /* A draft is optional. */ }
if (key) $('#auth').textContent = 'Sign out';
if (auth.error) showError(auth.error);

function saveDraft() {
  sessionStorage.setItem(store, JSON.stringify({ task: $('#task').value, instructions: $('#instructions').value }));
}
function authorize() {
  if (key) { clearAuthSession(); location.reload(); return; }
  saveDraft();
  location.href = createAuthorizationUrl({ redirectUrl: location.origin + location.pathname });
}
function showError(text) { $('#error').hidden = false; $('#error').textContent = text; }
function row(label, text, kind = '') {
  $('#transcript .tx-empty')?.remove();
  const entry = document.createElement('div');
  entry.className = `repl-cell ${kind}`;
  const heading = document.createElement('b');
  heading.textContent = label;
  const pre = document.createElement('pre');
  pre.textContent = text;
  entry.append(heading, pre);
  $('#transcript').append(entry);
  $('#transcript').scrollTop = $('#transcript').scrollHeight;
  return entry;
}
function controls() {
  const busy = Boolean(controller);
  for (const selector of ['#task', '#instructions', '#run', '#reset', '#auth']) $(selector).disabled = busy;
  document.querySelectorAll('[data-prompt]').forEach(button => { button.disabled = busy; });
  $('#stop').hidden = !busy;
  $('#run').textContent = variant === 'notebook' ? 'Propose a cell' : variant === 'console' ? 'Send ↵' : runtime && !runtime.closed ? 'Apply change' : 'Run task';
}
function resetWorkspace() {
  runtime?.destroy();
  runtime = null;
  historyMessages = [];
  $('#stage').hidden = true;
  $('#empty').hidden = false;
}
$('#auth').addEventListener('click', authorize);
$('#task').addEventListener('input', saveDraft);
$('#instructions').addEventListener('input', saveDraft);
$('#stop').addEventListener('click', () => controller?.abort(new DOMException('Stopped by you; the REPL was reset.', 'AbortError')));
$('#reset').addEventListener('click', () => {
  resetWorkspace();
  sessionCalls = 0;
  $('#calls').textContent = '0 calls';
  $('#transcript').replaceChildren();
  $('#error').hidden = true;
  $('#status').textContent = 'Page and REPL state reset';
  controls();
});
$('#task-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (controller) return;
  if (!$('#task').value.trim()) return;
  const task = $('#task').value.trim();
  if (variant === 'console' && task.startsWith('/')) {
    if (task === '/reset') $('#reset').click();
    else if (task === '/help') row('Commands', '/inspect — read DOM and state\n/reset — clear the workspace\nEnter sends · Shift+Enter adds a line');
    else if (task === '/inspect') {
      try { row('Workspace', runtime ? JSON.stringify(await runtime.inspect(), null, 2) : 'No page yet.'); }
      catch (error) { showError(error.message); }
    } else row('Unknown command', 'Try /help');
    return;
  }
  if (!key) { authorize(); return; }
  saveDraft();
  controller = new AbortController();
  const active = controller;
  let remaining = 90000, started = performance.now(), timeout;
  const resumeBudget = () => {
    started = performance.now();
    timeout = setTimeout(() => active.abort(new DOMException('90-second active-time limit reached; the REPL was reset.', 'TimeoutError')), Math.max(0, remaining));
  };
  const pauseBudget = () => { clearTimeout(timeout); remaining -= performance.now() - started; };
  resumeBudget();
  const bridge = createApiBridge({ apiKey: key });
  const onAbort = () => { bridge.abort(); resetWorkspace(); };
  active.signal.addEventListener('abort', onAbort, { once: true });
  $('#error').hidden = true;
  $('#status').textContent = 'Starting';
  controls();
  row('Your task', task);
  try {
    if (!runtime || runtime.closed) {
      historyMessages = [];
      $('#empty').hidden = true;
      $('#stage').hidden = false;
      runtime = await createReplRuntime($('#stage'), { signal: active.signal });
    }
    const complete = async ({ model, messages, signal }) => {
      signal.throwIfAborted();
      sessionCalls++;
      $('#calls').textContent = `${sessionCalls} model calls`;
      const response = await bridge.fetch(POLLI_ENDPOINT, { method: 'POST', body: JSON.stringify({ model, messages }) });
      signal.throwIfAborted();
      if (response.status !== 200) throw new Error(`Model request failed: HTTP ${response.status}`);
      const body = JSON.parse(new TextDecoder().decode(response.body));
      return body.choices?.[0]?.message?.content;
    };
    const result = await runReplAgent({ task, model: 'claude-large', instructions: $('#instructions').value,
      source, runtime, complete, history: historyMessages, signal: active.signal,
      beforeExecute: variant === 'notebook' ? async ({ code, step, signal }) => {
        pauseBudget();
        try { return await reviewCell(code, step, signal); } finally { if (!signal.aborted) resumeBudget(); }
      } : undefined, onEvent(event) {
        if (event.type === 'thinking') $('#status').textContent = `Thinking · turn ${event.step} of 8`;
        else if (event.type === 'cell') { $('#status').textContent = 'Running JavaScript'; row(`Cell ${event.step}`, event.code); }
        else if (event.type === 'observation') {
          const { output, value, error } = event.result;
          row(error ? 'JavaScript error · the agent can repair it' : 'Result', [output, value !== 'undefined' && `Returned: ${value}`, error].filter(Boolean).join('\n') || '(DOM updated; no console output)', error ? 'error' : 'result');
        } else if (event.type === 'finished') row('Model finished', event.text, 'result');
        else if (event.type === 'limited') row('Call limit', event.text, 'error');
      } });
    $('#status').textContent = result.status === 'limited' ? 'Call limit reached · you can give it another instruction' : 'Finished · try the page or ask for a change';
  } catch (error) {
    const message = active.signal.aborted ? String(active.signal.reason?.message || 'Stopped') : error.message || String(error);
    showError(message);
    row(active.signal.aborted ? 'Stopped' : 'Run failed', message, 'error');
    $('#status').textContent = active.signal.aborted ? 'Stopped · page reset' : 'Run failed';
    if (runtime?.closed) resetWorkspace();
  } finally {
    clearTimeout(timeout);
    active.signal.removeEventListener('abort', onAbort);
    controller = null;
    controls();
  }
});
controls();

// Review is an interaction mode; the evaluator and its isolation stay the same.
function reviewCell(code, step, signal) {
  signal.throwIfAborted();
  $('#status').textContent = 'Your turn · edit the cell, then run it';
  const entry = row(`Proposed cell ${step}`, '', 'proposal');
  entry.querySelector('pre').remove();
  const editor = document.createElement('textarea');
  editor.className = 'cell-editor';
  editor.setAttribute('aria-label', `Edit cell ${step}`);
  editor.spellcheck = false;
  editor.value = code;
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'button primary'; button.textContent = 'Run cell';
  entry.append(editor, button);
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', abort); editor.disabled = true; button.disabled = true; };
    const abort = () => { finish(); button.textContent = 'Cancelled'; reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    button.addEventListener('click', () => { finish(); button.textContent = 'Executed below'; resolve(editor.value); }, { once: true });
    editor.focus();
  });
}
if (variant === 'console') $('#task').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#task-form').requestSubmit(); }
});
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
  if (controller) return;
  $('#task').value = button.dataset.prompt; saveDraft(); $('#task-form').requestSubmit();
}));
