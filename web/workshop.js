import { Bash } from '/vendor/just-bash.js';
import {
  clearAuthSession,
  consumeAuthCallback,
  createAuthorizationUrl,
} from './auth.js';
import {
  POLLI_BASE,
  createApiBridge,
  createDemoBridge,
  isVisibleWorkspacePath,
  parseModelResponse,
  preparePreview,
  relativeWorkspacePath,
  shellQuote,
  workspacePath,
} from './workshop-runtime.js';

const {
  createIcons,
  FileCode2,
  Files,
  KeyRound,
  ListTree,
  Maximize2,
  Minimize2,
  Monitor,
  Play,
  RotateCcw,
  Save,
  Sparkles,
  Sprout,
  Square,
  Terminal,
} = globalThis.lucide;
const icons = {
  FileCode2,
  Files,
  KeyRound,
  ListTree,
  Maximize2,
  Minimize2,
  Monitor,
  Play,
  RotateCcw,
  Save,
  Sparkles,
  Sprout,
  Square,
  Terminal,
};
createIcons({ icons });

const MODEL = 'claude-large';
const RUNTIME = 'just-bash 3.1.0 in a browser; persistent virtual files; built-in shell commands only; no Node, npm, Python, native binaries, or unrestricted network';
const STATE_FILES = [
  { name: 'SOUL', detail: 'voice' },
  { name: 'GOAL', detail: 'objective' },
  { name: 'RECENT', detail: 'memory' },
  { name: 'HEARTBEAT', detail: 'check-in' },
];
const DEMO_TASK = 'Build a playful interactive signal garden in index.html. Keep it self-contained and verify it.';
const query = new URLSearchParams(location.search);
const demo = query.has('demo');
const embed = query.has('embed');
if (embed) document.body.classList.add('embed');

const $ = selector => document.querySelector(selector);
const taskEl = $('#task');
const exampleEl = $('#example');
const runEl = $('#run');
const stopEl = $('#stop');
const authEl = $('#auth');
const resetEl = $('#reset');
const statusEl = $('#status');
const statusLabelEl = $('#status-label');
const activityEl = $('#activity');
const previewEl = $('#preview');
const previewEmptyEl = $('#preview-empty');
const transcriptEl = $('#transcript-view');
const sourceEl = $('#source-view');
const artifactNameEl = $('#artifact-name');
const expandEl = $('#expand');
const workspaceListEl = $('#workspace-list');
const workspaceNameEl = $('#workspace-name');
const workspaceEditorEl = $('#workspace-editor');
const saveWorkspaceEl = $('#save-workspace');
const heartbeatEl = $('#heartbeat-enabled');
const turnCountEl = $('#turn-count');
const fileCountEl = $('#file-count');
const changedCountEl = $('#changed-count');
const elapsedEl = $('#elapsed');

const auth = consumeAuthCallback();
if (auth.cleanedUrl) history.replaceState(null, '', auth.cleanedUrl);
let apiKey = auth.apiKey;
let source;
let bash;
let bridge;
let controller;
let workspace = new Map();
let baseline = new Map();
let baselineReady = false;
let selectedPath = workspacePath('.shprout/SOUL.md');
let editorDirty = false;
let snapshotBusy = false;
let running = false;
let turnCount = 0;
let startedAt = 0;
let elapsedTimer;
let snapshotTimer;
let previewSource = '';
let artifactPath = '';
let activeView = 'preview';
let lastApiError = '';

$('#composer').addEventListener('submit', event => {
  event.preventDefault();
  run();
});
stopEl.addEventListener('click', stop);
resetEl.addEventListener('click', resetWorkspace);
authEl.addEventListener('click', authorize);
saveWorkspaceEl.addEventListener('click', saveWorkspaceFile);
workspaceListEl.addEventListener('click', event => {
  const button = event.target.closest('button[data-path]');
  if (button) selectWorkspacePath(button.dataset.path);
});
workspaceEditorEl.addEventListener('input', () => {
  editorDirty = true;
  saveWorkspaceEl.disabled = false;
});
workspaceEditorEl.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveWorkspaceFile();
  }
});
exampleEl.addEventListener('change', () => {
  if (!exampleEl.value) return;
  taskEl.value = exampleEl.value;
  exampleEl.value = '';
  taskEl.focus();
});
for (const tab of document.querySelectorAll('.view-tab')) {
  tab.addEventListener('click', () => selectView(tab.dataset.view));
}
for (const tab of document.querySelectorAll('.inspector-tab')) {
  tab.addEventListener('click', () => selectInspector(tab.dataset.panel));
}
expandEl.addEventListener('click', toggleExpanded);

await boot();
if (auth.error) addError(`Authorization failed: ${auth.error}`);

async function boot() {
  setStatus('loading shell', 'booting');
  try {
    const response = await fetch('/shprout.txt');
    if (!response.ok) throw new Error(`/shprout.txt: HTTP ${response.status}`);
    source = await response.text();
    sourceEl.textContent = source;
    await createRuntime();

    if (demo) {
      apiKey = 'demo';
      taskEl.value = DEMO_TASK;
      authEl.querySelector('span').textContent = 'Demo';
      authEl.disabled = true;
      setStatus('demo ready', 'ready');
      setTimeout(run, 180);
    } else if (apiKey) {
      authEl.querySelector('span').textContent = 'Sign out';
      setStatus('ready', 'ready');
      taskEl.focus();
    } else {
      setStatus('authorize', 'idle');
    }
    updateControls();
  } catch (error) {
    addError(error.stack || error.message || String(error));
    setStatus('failed', 'error');
  }
}

async function createRuntime() {
  bridge = demo
    ? createDemoBridge({ onEvent: handleBridgeEvent })
    : apiKey
      ? createApiBridge({ apiKey, onEvent: handleBridgeEvent })
      : { fetch: async () => { throw new Error('Authorize before running shprout'); }, abort() {} };

  bash = new Bash({
    files: {
      '/home/user/shprout': source,
      '/home/user/.shprout/.keep': '',
    },
    cwd: '/home/user',
    env: {
      OPENAI_API_KEY: 'managed-by-browser',
      OPENAI_BASE_URL: POLLI_BASE,
      MODEL,
      SHPROUT_RUNTIME: RUNTIME,
    },
    fetch: (url, options) => bridge.fetch(url, options),
    executionLimits: {
      maxCommandCount: 5000,
      maxLoopIterations: 5000,
    },
  });
  workspace = new Map();
  baseline = new Map();
  baselineReady = false;
  selectedPath = workspacePath('.shprout/SOUL.md');
  editorDirty = false;
  previewSource = '';
  artifactPath = '';
  transcriptEl.textContent = 'Run shprout to see the exact shell transcript.';
  workspaceEditorEl.disabled = false;
  saveWorkspaceEl.disabled = true;
  await snapshotWorkspace(true);
  resetEl.disabled = false;
}

function authorize() {
  if (demo) return;
  if (apiKey) {
    clearAuthSession();
    location.reload();
    return;
  }
  location.href = createAuthorizationUrl({ redirectUrl: location.origin + location.pathname });
}

function setStatus(text, kind) {
  statusLabelEl.textContent = text;
  statusEl.dataset.kind = kind;
}

function updateControls() {
  const enabled = Boolean(bash && (apiKey || demo) && !running);
  taskEl.disabled = !enabled;
  runEl.disabled = !enabled;
  exampleEl.disabled = running;
  stopEl.hidden = !running;
  stopEl.disabled = !running;
  resetEl.disabled = !bash || running;
}

function handleBridgeEvent(event) {
  if (event.type === 'request') {
    setStatus('thinking', 'running');
  } else if (event.type === 'response') {
    turnCount += 1;
    turnCountEl.textContent = String(turnCount);
    addTurn(event.content, turnCount);
    setStatus('acting', 'running');
  } else if (event.type === 'error') {
    lastApiError = event.message;
    addError(event.message);
    setStatus('API error', 'error');
  }
  updatePanelContext();
}

async function run() {
  const task = taskEl.value.trim();
  if (!task || !bash || running || (!apiKey && !demo)) return;

  try {
    if (editorDirty) await saveWorkspaceFile();
  } catch (error) {
    addError(`Could not save ${relativeWorkspacePath(selectedPath)}: ${error.message}`);
    return;
  }

  bridge.reset?.();
  controller = new AbortController();
  running = true;
  turnCount = 0;
  lastApiError = '';
  startedAt = performance.now();
  baseline = new Map(workspace);
  baselineReady = true;
  activityEl.replaceChildren();
  addTask(task);
  transcriptEl.textContent = `$ shprout ${shellQuote(task)}\n`;
  turnCountEl.textContent = '0';
  changedCountEl.textContent = '0';
  elapsedEl.textContent = '0.0s';
  selectInspector('activity');
  setStatus('starting', 'running');
  updateControls();
  elapsedTimer = setInterval(updateElapsed, 100);
  snapshotTimer = setInterval(() => snapshotWorkspace(), 250);

  try {
    const result = await bash.exec(`bash /home/user/shprout ${shellQuote(task)}`, {
      signal: controller.signal,
      env: { SHPROUT_HEARTBEAT: heartbeatEl.checked ? '1' : '0' },
    });
    transcriptEl.textContent += `${result.stdout || ''}${result.stderr ? `\n${result.stderr}` : ''}\n[exit ${result.exitCode}]\n`;
    await snapshotWorkspace(true);
    const stopped = controller.signal.aborted;
    const failed = Boolean(lastApiError || result.exitCode !== 0);
    addResult(stopped ? 'Stopped' : failed ? `Failed with exit ${result.exitCode}` : `Finished with exit ${result.exitCode}`, failed || stopped);
    if (stopped) setStatus('stopped', 'idle');
    else if (failed) setStatus('failed', 'error');
    else setStatus('done', 'done');
  } catch (error) {
    const stopped = controller.signal.aborted || error?.name === 'AbortError';
    if (!stopped) addError(error.stack || error.message || String(error));
    addResult(stopped ? 'Stopped' : 'Run failed', true);
    setStatus(stopped ? 'stopped' : 'failed', stopped ? 'idle' : 'error');
  } finally {
    clearInterval(elapsedTimer);
    clearInterval(snapshotTimer);
    updateElapsed();
    running = false;
    updateControls();
    updatePanelContext();
    if (!demo) taskEl.focus();
  }
}

function stop() {
  if (!running) return;
  setStatus('stopping', 'running');
  bridge.abort?.();
  controller?.abort('stopped');
}

async function resetWorkspace() {
  if (running) return;
  const hasWork = editorDirty || [...workspace.keys()].some(path => !path.endsWith('/.keep'));
  if (hasWork && !confirm('Reset the virtual workspace and all agent state?')) return;
  setStatus('resetting', 'booting');
  activityEl.replaceChildren(makeActivityEmpty());
  createIcons({ icons: { Sparkles } });
  turnCount = 0;
  turnCountEl.textContent = '0';
  changedCountEl.textContent = '0';
  elapsedEl.textContent = '0.0s';
  await createRuntime();
  setStatus(demo ? 'demo ready' : apiKey ? 'ready' : 'authorize', apiKey ? 'ready' : 'idle');
  updateControls();
}

async function snapshotWorkspace(force = false) {
  if (!bash || snapshotBusy) return;
  snapshotBusy = true;
  try {
    const paths = bash.fs.getAllPaths().filter(isVisibleWorkspacePath).sort();
    const entries = await Promise.all(paths.map(async path => {
      try {
        const stat = await bash.fs.stat(path);
        if (!stat.isFile) return null;
        return [path, await bash.readFile(path)];
      } catch {
        return null;
      }
    }));
    const next = new Map(entries.filter(Boolean));
    if (!force && mapsEqual(workspace, next)) return;
    workspace = next;
    renderWorkspace();
  } finally {
    snapshotBusy = false;
  }
}

function mapsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const [path, content] of left) if (right.get(path) !== content) return false;
  return true;
}

function renderWorkspace() {
  const files = [...workspace.keys()].filter(path => !relativeWorkspacePath(path).startsWith('.shprout/'));
  fileCountEl.textContent = String(workspace.size);
  const changed = new Set([...workspace.keys(), ...baseline.keys()].filter(path => workspace.get(path) !== baseline.get(path)));
  changedCountEl.textContent = String(baselineReady ? changed.size : 0);

  workspaceListEl.replaceChildren();
  appendWorkspaceGroup('State', STATE_FILES.map(item => ({
    ...item,
    path: workspacePath(`.shprout/${item.name}.md`),
  })));
  appendWorkspaceGroup('Files', files.map(path => ({
    name: relativeWorkspacePath(path),
    detail: changed.has(path) ? 'changed' : '',
    path,
  })));

  if (!editorDirty) workspaceEditorEl.value = workspace.get(selectedPath) || '';
  workspaceNameEl.textContent = relativeWorkspacePath(selectedPath);
  renderPreview(files);
}

function appendWorkspaceGroup(label, entries) {
  const heading = document.createElement('h3');
  heading.textContent = label;
  workspaceListEl.append(heading);
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.textContent = 'No files yet';
    workspaceListEl.append(empty);
    return;
  }
  for (const entry of entries) {
    const button = document.createElement('button');
    const name = document.createElement('span');
    const detail = document.createElement('small');
    button.type = 'button';
    button.dataset.path = entry.path;
    button.dataset.exists = String(workspace.has(entry.path));
    button.classList.toggle('active', entry.path === selectedPath);
    name.textContent = entry.name;
    detail.textContent = entry.detail;
    button.append(name, detail);
    workspaceListEl.append(button);
  }
}

function renderPreview(files) {
  const htmlPath = files.find(path => relativeWorkspacePath(path) === 'index.html')
    || files.find(path => relativeWorkspacePath(path) === 'demo.html')
    || files.find(path => path.toLowerCase().endsWith('.html'));
  const html = htmlPath ? workspace.get(htmlPath) : '';
  artifactPath = htmlPath ? relativeWorkspacePath(htmlPath) : '';
  updatePanelContext();
  if (!html) {
    previewEl.hidden = true;
    previewEmptyEl.hidden = false;
    previewSource = '';
    return;
  }
  previewEl.hidden = false;
  previewEmptyEl.hidden = true;
  if (html !== previewSource) {
    previewSource = html;
    previewEl.srcdoc = preparePreview(html);
  }
}

async function selectWorkspacePath(path) {
  if (!path || path === selectedPath) return;
  try {
    if (editorDirty) await saveWorkspaceFile();
  } catch (error) {
    addError(`Could not save ${relativeWorkspacePath(selectedPath)}: ${error.message}`);
    return;
  }
  selectedPath = path;
  editorDirty = false;
  workspaceNameEl.textContent = relativeWorkspacePath(path);
  workspaceEditorEl.value = workspace.get(path) || '';
  saveWorkspaceEl.disabled = true;
  for (const button of workspaceListEl.querySelectorAll('button[data-path]')) {
    button.classList.toggle('active', button.dataset.path === path);
  }
}

async function saveWorkspaceFile() {
  if (!selectedPath || !editorDirty) return;
  await bash.writeFile(selectedPath, workspaceEditorEl.value);
  editorDirty = false;
  saveWorkspaceEl.disabled = true;
  await snapshotWorkspace(true);
}

function selectView(view) {
  if (!['preview', 'transcript', 'source'].includes(view)) return;
  activeView = view;
  for (const tab of document.querySelectorAll('.view-tab')) {
    const active = tab.dataset.view === view;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const name of ['preview', 'transcript', 'source']) {
    const element = $(`#${name}-view`);
    const active = name === view;
    element.hidden = !active;
    element.classList.toggle('active', active);
  }
  updatePanelContext();
}

function selectInspector(panel) {
  if (!['activity', 'workspace'].includes(panel)) return;
  for (const tab of document.querySelectorAll('.inspector-tab')) {
    const active = tab.dataset.panel === panel;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const name of ['activity', 'workspace']) {
    const element = $(`#${name}-panel`);
    const active = name === panel;
    element.hidden = !active;
    element.classList.toggle('active', active);
  }
}

function updatePanelContext() {
  if (activeView === 'source') {
    artifactNameEl.textContent = source ? `${source.trimEnd().split('\n').length} lines` : 'loading';
  } else if (activeView === 'transcript') {
    artifactNameEl.textContent = `${turnCount} turn${turnCount === 1 ? '' : 's'}`;
  } else {
    artifactNameEl.textContent = artifactPath || 'no artifact';
  }
}

function toggleExpanded() {
  const expanded = document.body.classList.toggle('preview-expanded');
  expandEl.title = expanded ? 'Restore workspace' : 'Expand artifact';
  expandEl.setAttribute('aria-label', expandEl.title);
  expandEl.replaceChildren();
  const icon = document.createElement('i');
  icon.dataset.lucide = expanded ? 'minimize-2' : 'maximize-2';
  expandEl.append(icon);
  createIcons({ icons: { Maximize2, Minimize2 }, attrs: { 'aria-hidden': 'true' } });
}

function addTask(task) {
  const row = document.createElement('p');
  row.className = 'activity-task';
  row.textContent = task;
  activityEl.append(row);
}

function addTurn(content, number) {
  const { thought, action } = parseModelResponse(content);
  const article = document.createElement('article');
  article.className = 'activity-turn';
  const head = document.createElement('div');
  head.className = 'turn-head';
  const label = document.createElement('span');
  label.textContent = `Turn ${number}`;
  const kind = document.createElement('span');
  kind.className = 'turn-kind';
  kind.textContent = action ? 'bash' : 'done';
  head.append(label, kind);
  article.append(head);
  if (thought) {
    const prose = document.createElement('p');
    prose.className = 'turn-thought';
    prose.textContent = thought;
    article.append(prose);
  }
  if (action) {
    const code = document.createElement('pre');
    code.className = 'turn-action';
    code.textContent = action;
    article.append(code);
  }
  activityEl.append(article);
  activityEl.scrollTop = activityEl.scrollHeight;
}

function addResult(message, error = false) {
  const row = document.createElement('p');
  row.className = `activity-result${error ? ' error' : ''}`;
  row.textContent = message;
  activityEl.append(row);
  activityEl.scrollTop = activityEl.scrollHeight;
}

function addError(message) {
  addResult(message, true);
}

function makeActivityEmpty() {
  const empty = document.createElement('div');
  empty.className = 'activity-empty';
  const icon = document.createElement('i');
  icon.dataset.lucide = 'sparkles';
  const text = document.createElement('span');
  text.textContent = 'Agent turns will appear here';
  empty.append(icon, text);
  return empty;
}

function updateElapsed() {
  if (!startedAt) return;
  elapsedEl.textContent = `${((performance.now() - startedAt) / 1000).toFixed(1)}s`;
}
