import {
  clearAuthSession,
  consumeAuthCallback,
  createAuthorizationUrl,
} from './auth.js';
import { completeDomproutDemo, runDomprout } from './dom-agent.js';

const { createIcons, GitBranch, KeyRound, Play, Square } = globalThis.lucide;
createIcons({ icons: { GitBranch, KeyRound, Play, Square } });

const MODEL_STORE = 'domprout.model';
const $ = selector => document.querySelector(selector);
const taskEl = $('#task');
const modelEl = $('#model');
const runEl = $('#run');
const stopEl = $('#stop');
const authEl = $('#auth');
const statusEl = $('#status');
const statusLabelEl = $('#status-label');
const stepCountEl = $('#step-count');
const logEl = $('#log');
const iframe = $('#stage');
const query = new URLSearchParams(location.search);
const demo = query.has('demo');
const embed = query.has('embed');
if (embed) document.body.classList.add('embed');

const auth = consumeAuthCallback();
if (auth.cleanedUrl) history.replaceState(null, '', auth.cleanedUrl);
let key = auth.apiKey;
let controller;
let running = false;
let steps = 0;

modelEl.value = localStorage.getItem(MODEL_STORE) || modelEl.value;
modelEl.addEventListener('change', () => localStorage.setItem(MODEL_STORE, modelEl.value.trim()));
$('#controls').addEventListener('submit', event => {
  event.preventDefault();
  run();
});
authEl.addEventListener('click', authorize);
stopEl.addEventListener('click', () => controller?.abort('stopped'));

if (auth.error) append('error', `Authorization failed: ${auth.error}`);
if (demo) {
  key = 'demo';
  authEl.querySelector('span').textContent = 'Demo';
  authEl.disabled = true;
  taskEl.value = 'Demonstrate recursive parallel DOM updates';
  modelEl.value = 'deterministic-demo';
  setStatus('demo ready', 'ready');
  setTimeout(run, 180);
} else if (key) {
  authEl.querySelector('span').textContent = 'Sign out';
  setStatus('ready', 'ready');
  taskEl.focus();
} else {
  setStatus('authorize', 'idle');
}
updateControls();

function authorize() {
  if (demo) return;
  if (key) {
    clearAuthSession();
    location.reload();
    return;
  }
  location.href = createAuthorizationUrl({ redirectUrl: location.origin + location.pathname });
}

function setStatus(value, kind) {
  statusLabelEl.textContent = value;
  statusEl.dataset.kind = kind;
}

function updateControls() {
  const ready = Boolean(key);
  taskEl.disabled = !ready || running;
  modelEl.disabled = demo || !ready || running;
  runEl.disabled = !ready || running;
  stopEl.hidden = !running;
  stopEl.disabled = !running;
}

function append(className, text) {
  const row = document.createElement('div');
  row.className = className;
  row.textContent = text;
  logEl.append(row);
  logEl.scrollTop = logEl.scrollHeight;
}

function appendDetails(label, text) {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const pre = document.createElement('pre');
  summary.textContent = label;
  pre.textContent = text;
  details.append(summary, pre);
  logEl.append(details);
}

function show(event) {
  const prefix = `[${event.path}]`;
  if (event.type === 'snapshot') appendDetails(`${prefix} DOM`, event.text);
  else if (event.type === 'response') appendDetails(`${prefix} model response`, event.text);
  else if (event.type === 'action') append('action', `${prefix} \`\`\`js\n${event.text}\n\`\`\``);
  else if (event.type === 'observation') append('observation', `${prefix} ${event.text}`);
  else if (event.type === 'error') append('error', `${prefix} ${event.text}`);
  else if (event.type === 'fanout') append('fanout', `${prefix} -> ${event.children.join(', ')}`);
  else if (event.type === 'start') {
    steps = event.step;
    stepCountEl.textContent = `${steps} step${steps === 1 ? '' : 's'}`;
    append('start', `${prefix} turn ${event.turn}`);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

async function run() {
  const task = taskEl.value.trim();
  const model = modelEl.value.trim();
  if (!task || !model || !key || running) return;
  controller?.abort('restarted');
  controller = new AbortController();
  running = true;
  steps = 0;
  stepCountEl.textContent = '0 steps';
  logEl.replaceChildren();
  setStatus('running', 'running');
  updateControls();
  try {
    const result = await runDomprout({
      iframe,
      task,
      model,
      key,
      complete: demo ? completeDomproutDemo : undefined,
      signal: controller.signal,
      maxSteps: 24,
      onEvent: show,
    });
    setStatus(result.aborted ? 'stopped' : result.limited ? `limit / ${result.steps}` : `done / ${result.steps}`, result.limited ? 'error' : 'done');
  } catch (error) {
    if (controller.signal.aborted) setStatus('stopped', 'idle');
    else {
      append('error', error.stack || error.message || String(error));
      setStatus('failed', 'error');
    }
  } finally {
    running = false;
    updateControls();
    if (!demo) taskEl.focus();
  }
}
