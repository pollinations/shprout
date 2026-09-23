import { consumeAuthCallback, createAuthorizationUrl, clearAuthSession } from './auth.js';
import { createApiBridge } from './workshop-runtime.js';
import { decompress, runGate } from './seed-runtime.js';
import { SHELL_SEEDS, SHELL_AGENTS, SHELL_TASKS } from './shell-presets.js';
import { Bash } from '/vendor/just-bash.js';
const $ = id => document.getElementById(id);
const auth = consumeAuthCallback();
if (auth.cleanedUrl) history.replaceState(null, '', auth.cleanedUrl);
if (auth.apiKey) $('auth').textContent = 'Sign out';
const query = new URLSearchParams(location.search);
$('runtime').value = query.get('runtime') === 'lite' ? 'lite' : 'linux';
const terminal = new Terminal({ fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', convertEol: true,
  cursorBlink: true, scrollback: 8000, screenReaderMode: true,
  theme: { background: '#070d09', foreground: '#bde8c9', cursor: '#9af5b7', selectionBackground: '#345740' } });
const fit = new FitAddon.FitAddon(); terminal.loadAddon(fit); terminal.open($('terminal')); fit.fit();
let runtime = null, busy = false, calls = 0, mounted = '', timeout, bridge, generating = false, generationStopped = false;
const status = text => { $('status').textContent = text; };
const error = text => { $('error').hidden = false; $('error').textContent = text; };
function controls() {
  $('run').disabled = busy || !runtime; $('grow').disabled = busy || !runtime;
  for (const id of ['source','source-preset','seed-preset','task-preset','runtime','auth','task','seed','model']) $(id).disabled = busy;
  $('source-preset').disabled = busy || sourceTexts.size !== SHELL_AGENTS.length;
  $('stop').hidden = !busy;
}
function ready() { if (generating) return; clearTimeout(timeout); busy = false; status('Ready · type a command or give the agent a task'); controls(); }
const DRAFT_KEY = 'shprout.shell.draft';
const sourceTexts = new Map();
let lineage = { kind: 'saved' };
function saveDraft() {
  const draft = { lineage };
  for (const id of ['model', 'seed', 'source', 'task', 'seed-preset', 'source-preset', 'task-preset']) draft[id] = $(id).value;
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* The editors remain usable if storage is full. */ }
}
function refreshLineage() {
  $('source-lineage').textContent = lineage.kind === 'generated'
    ? (lineage.seed === $('seed').value ? 'Generated from the compressed prompt above · execution checks passed.' : 'Generated from an earlier prompt. The compressed prompt above has changed; generate again to use it.')
    : lineage.kind === 'saved' ? 'Saved repository script · independent of the compressed prompt above. You can run it directly.'
    : 'Edited script · not checked after these edits. The Run button uses this source.';
}
function presetInfo(kind, item) {
  $(kind + '-note').textContent = item?.note || 'Your own text. Choose a preset to replace it.';
  $(kind + '-origin').textContent = item?.origin || 'Custom';
}
function bytes(id, target) { $(target).textContent = `${new TextEncoder().encode($(id).value).length.toLocaleString()} bytes`; }
function fillPresets(kind, items) {
  for (const item of items) $(kind + '-preset').add(new Option(item.label, item.id));
  $(kind + '-preset').add(new Option(kind === 'source' ? 'Custom / generated script' : 'Your own…', 'custom'));
}
fillPresets('seed', SHELL_SEEDS); fillPresets('source', SHELL_AGENTS); fillPresets('task', SHELL_TASKS);
$('source-preset').disabled = true;
function selectSeed() {
  const item = SHELL_SEEDS.find(s => s.id === $('seed-preset').value);
  if (item) $('seed').value = item.text;
  presetInfo('seed', item); bytes('seed', 'seed-size'); refreshLineage(); saveDraft();
}
function selectSource() {
  const item = SHELL_AGENTS.find(s => s.id === $('source-preset').value);
  if (item) { $('source').value = sourceTexts.get(item.id); lineage = { kind: 'saved' }; }
  else lineage = { kind: 'custom' };
  presetInfo('source', item); bytes('source', 'source-size'); refreshLineage(); saveDraft();
}
function selectTask() {
  const item = SHELL_TASKS.find(s => s.id === $('task-preset').value);
  if (item) $('task').value = item.prompt;
  presetInfo('task', item); saveDraft();
}
$('seed-preset').onchange = selectSeed;
$('source-preset').onchange = selectSource;
$('task-preset').onchange = selectTask;
$('seed').oninput = () => { $('seed-preset').value = 'custom'; presetInfo('seed'); bytes('seed','seed-size'); refreshLineage(); saveDraft(); };
$('source').oninput = () => { $('source-preset').value = 'custom'; lineage = { kind: 'custom' }; presetInfo('source'); bytes('source','source-size'); refreshLineage(); saveDraft(); };
$('task').oninput = () => { $('task-preset').value = 'custom'; presetInfo('task'); saveDraft(); };
function authorize() {
  saveDraft();
  if (auth.apiKey) { clearAuthSession(); location.reload(); return; }
  location.href = createAuthorizationUrl({ redirectUrl: location.origin + location.pathname + location.search });
}
$('auth').onclick = authorize;
$('model').oninput = saveDraft;
// The public catalogue supplies current IDs; typing an ID still works if it is unavailable.
void fetch('https://gen.pollinations.ai/text/models', { signal: AbortSignal.timeout(10000) })
  .then(response => { if (!response.ok) throw new Error('Model catalogue unavailable'); return response.json(); })
  .then(models => {
    for (const model of models) {
      if (!model.output_modalities?.includes('text') || !model.supported_endpoints?.includes('/v1/chat/completions')) continue;
      $('models').append(new Option(model.title || model.name, model.name));
    }
  }).catch(() => { $('model-note').textContent = 'Could not load model suggestions. Type a Pollinations model ID; it is used for generation and the agent.'; });
$('reset').onclick = () => { saveDraft(); location.reload(); };
$('runtime').onchange = () => { saveDraft(); query.set('runtime', $('runtime').value); location.search = query; };
$('stop').onclick = () => { generationStopped = true; bridge?.abort(); if (!generating) runtime?.stop(); status('Interrupt sent'); };
$('download').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([$('source').value], { type: 'text/plain' })); a.download = 'shprout'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
terminal.onData(text => {
  if (!runtime || generating) return;
  if (!busy && /[\r\n]/.test(text)) { busy = true; controls(); status('Running terminal command'); }
  runtime.input(text);
});
new ResizeObserver(() => { fit.fit(); runtime?.resize(); }).observe($('terminal'));
const complete = async (url, options) => {
  if (!auth.apiKey) throw new Error('Authorize with Pollinations to let the agent call its model.');
  $('calls').textContent = `${++calls} model calls`;
  // Show what the script actually sends; its own prompt already carries its history.
  try {
    const { messages, ...settings } = JSON.parse(options.body);
    $('model-prompt').textContent = JSON.stringify(settings, null, 2) + '\n\n' + messages.map(message => `[${message.role}]\n${typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}`).join('\n\n');
  } catch { $('model-prompt').textContent = options.body; }
  return bridge.fetch(url, options);
};
async function executeTask(event) {
  event.preventDefault(); if (busy || !runtime || !$('task').value.trim() || !$('model').reportValidity() || !$('model').value.trim()) return;
  if (!auth.apiKey) { authorize(); return; }
  busy = true; controls(); $('error').hidden = true;
  try {
    if (mounted !== $('source').value) { await runtime.setSource($('source').value); mounted = $('source').value; }
    timeout = setTimeout(() => { bridge.abort(); runtime.stop(); error('Stopped at the 90-second time limit. Output so far remains in the terminal.'); }, 90000);
    status('Running the Bash agent');
    await runtime.run($('task').value.trim(), { model: $('model').value.trim() });
  } catch (e) { error(e?.message || String(e)); }
  finally { ready(); }
}
$('task-form').onsubmit = executeTask;
$('grow').onclick = async () => {
  if (busy || !runtime || !$('model').reportValidity() || !$('model').value.trim()) return;
  if (!auth.apiKey) { authorize(); return; }
  busy = true; controls(); $('error').hidden = true;
  generating = true; generationStopped = false;
  const timer = setTimeout(() => { generationStopped = true; bridge.abort(); }, 90000);
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      status(`Generating a Bash agent · attempt ${attempt}/3`);
      const generated = await decompress({ seed: $('seed').value, fetch: complete, model: $('model').value.trim(), attempt });
      if (generationStopped) throw new Error('Generation stopped.');
      const gate = await runGate(Bash, generated.code);
      if (generationStopped) throw new Error('Generation stopped.');
      if (!gate.pass) { terminal.writeln(`Generation ${attempt}: checks failed (${gate.fails.join(', ')})`); continue; }
      $('source').value = generated.code; $('source-preset').value = 'custom';
      lineage = { kind: 'generated', seed: $('seed').value, model: $('model').value.trim() };
      presetInfo('source', { note: 'New model output, passed the basic execution checks. Review or edit the script before running it.', origin: `Generated in this session · ${lineage.model}` });
      bytes('source', 'source-size'); refreshLineage(); saveDraft();
      $('agent').scrollIntoView({ behavior: 'smooth', block: 'start' });
      terminal.writeln('\r\nGenerated agent passed its execution checks. Choose a task in step 03 to run it.'); return;
    }
    throw new Error('Three generated agents failed the checks. Edit the seed and try again.');
  } catch (e) { error(e?.message || String(e)); } finally { clearTimeout(timer); generating = false; ready(); }
};
try {
  const results = await Promise.all(SHELL_AGENTS.map(async item => {
    const response = await fetch(item.url);
    if (!response.ok) throw new Error(`Could not load ${item.label}`);
    return [item.id, await response.text()];
  }));
  for (const [id, text] of results) sourceTexts.set(id, text);
  let draft;
  try { draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY)); } catch { /* Ignore damaged saved UI state. */ }
  $('seed-preset').value = 'reliable-396'; $('seed').value = SHELL_SEEDS.find(s => s.id === 'reliable-396').text;
  $('source-preset').value = 'canonical'; $('source').value = sourceTexts.get('canonical');
  $('task-preset').value = 'portrait'; $('task').value = SHELL_TASKS.find(t => t.id === 'portrait').prompt;
  if (draft && typeof draft === 'object') {
    for (const id of ['model', 'seed', 'source', 'task']) if (typeof draft[id] === 'string') $(id).value = draft[id];
    for (const [kind, items, field] of [['seed', SHELL_SEEDS, 'text'], ['source', SHELL_AGENTS, null], ['task', SHELL_TASKS, 'prompt']]) {
      const match = items.find(item => item.id === draft[kind + '-preset'] && (field ? item[field] : sourceTexts.get(item.id)) === $(kind).value);
      $(kind + '-preset').value = match?.id || 'custom';
    }
    lineage = $('source-preset').value !== 'custom' ? { kind: 'saved' } : draft.lineage?.kind === 'generated' && typeof draft.lineage.seed === 'string' ? draft.lineage : { kind: 'custom' };
  } else {
    for (const id of ['source', 'task']) {
      const old = sessionStorage.getItem('shprout.shell.' + id);
      if (old) {
        $(id).value = old;
        const match = id === 'source' ? SHELL_AGENTS.find(item => sourceTexts.get(item.id) === old) : SHELL_TASKS.find(item => item.prompt === old);
        $(id + '-preset').value = match?.id || 'custom';
        if (id === 'source') lineage = { kind: match ? 'saved' : 'custom' };
      }
      sessionStorage.removeItem('shprout.shell.' + id);
    }
  }
  presetInfo('seed', SHELL_SEEDS.find(s => s.id === $('seed-preset').value));
  presetInfo('source', lineage.kind === 'generated' ? { note: 'Saved model output; the generation checks passed before any edits.', origin: `Generated draft${lineage.model ? ' · ' + lineage.model : ''}` } : SHELL_AGENTS.find(s => s.id === $('source-preset').value));
  presetInfo('task', SHELL_TASKS.find(s => s.id === $('task-preset').value));
  mounted = $('source').value; bytes('source','source-size'); bytes('seed','seed-size'); refreshLineage();
  bridge = createApiBridge({ apiKey: auth.apiKey });
  const module = $('runtime').value === 'linux' ? await import('./shell-linux.js') : await import('./shell-lite.js');
  runtime = await (module.createLinuxShell || module.createLiteShell)({ terminal, source: mounted, model: $('model').value.trim(), complete, status, ready });
  controls();
  if (auth.error) error(auth.error);
} catch (e) { error(`${e.message} You can switch to the lightweight just-bash runtime in the terminal below.`); status('Shell could not start'); $('grow').disabled = true; }
