import { Bash } from '/vendor/just-bash.js';
import {
  clearAuthSession,
  consumeAuthCallback,
  createAuthorizationUrl,
} from './auth.js';
import { createApiBridge } from './workshop-runtime.js';
import {
  CONTROL,
  CUSTOM_TASK_ID,
  GATE_CHECKS,
  GATE_TASK,
  GEN_MODEL,
  RUN_CAP,
  SABOTAGE,
  SEEDS,
  ALL_TASKS as TASKS,
  applySabotage,
  applySelfImage,
  classifySandboxLimit,
  compressionFloor,
  createMeteredFetch,
  customTask,
  decompress,
  fingerprint,
  formatBytes,
  mountAgent,
  outputFromAppended,
  readWorkspace,
  replyParts,
  runGate,
  runTask,
  taskById,
  utf8Bytes,
} from './seed-runtime.js';

const { createIcons, Clipboard, KeyRound, Link, Play, Sprout, Square } = globalThis.lucide;
createIcons({ icons: { Clipboard, KeyRound, Link, Play, Sprout, Square } });

const CHAMPION_URL = '/samples/champion-386B.txt';
const MAX_ATTEMPTS = 3;
const REVEAL_BYTES_PER_SECOND = 4000;
const GATE_ROW_STAGGER_MS = 40;
const GLOSS = {
  'no-api-call': 'It never called the model.',
  'task-not-in-prompt': 'Request 1 never mentioned the task; $1 was dropped.',
  'died-after-turn-1': 'One call, then silence; usually a jq extraction or a flag this shell lacks.',
  'died-after-turn-2': 'Two calls, then it stopped early.',
  'no-eval-or-no-history': 'Request 2 never mentioned A1-42: the code was not run, or its output was not appended.',
  'history-not-cumulative': 'Request 3 lost A1-42 or B2-ok; each turn overwrote the log instead of appending.',
  'no-termination': 'Reply 3 was exit and it kept calling.',
  'request-not-json': 'The request body was not JSON.',
  crashed: 'The shell aborted; stderr is below.',
  'missing:self': 'No $0: it never reads its own source.',
  'missing:eval': 'No eval: it would print bash instead of running it.',
  'missing:loop': 'No for, while or until.',
  'missing:size': 'Over 4 KB.',
  'missing:env': 'It does not read OPENAI_API_KEY and OPENAI_BASE_URL.',
  'missing:curl': 'It does not use curl.',
  'missing:endpoint': 'It does not target chat/completions.',
};
const PLAIN = {
  'no-api-call': 'it never called the model',
  'task-not-in-prompt': 'it dropped the task from its prompt',
  'died-after-turn-1': 'it stopped after one call',
  'died-after-turn-2': 'it stopped after two calls',
  'no-eval-or-no-history': 'it did not run the code it was given',
  'history-not-cumulative': 'it forgot its history between turns',
  'no-termination': 'it did not stop on exit',
  'request-not-json': 'it sent broken JSON',
  crashed: 'it crashed',
  'missing:self': 'it never reads its own source',
  'missing:eval': 'it has no eval',
  'missing:loop': 'it has no loop',
  'missing:size': 'it is over 4 KB',
  'missing:env': 'it ignores the API key variables',
  'missing:curl': 'it does not use curl',
  'missing:endpoint': 'it does not call chat/completions',
};
const NEEDLES = { task: [GATE_TASK], exec: ['A1-42'], history: ['A1-42', 'B2-ok'] };
const REQUEST_INDEX = { task: 0, exec: 1, history: 2 };
const FAIL_FOR = {
  calls: ['no-api-call', 'crashed', 'request-not-json'],
  task: ['task-not-in-prompt'],
  exec: ['died-after-turn-1', 'no-eval-or-no-history'],
  history: ['died-after-turn-2', 'history-not-cumulative', 'died-after-turn-1'],
  exit: ['no-termination', 'died-after-turn-2', 'died-after-turn-1', 'no-api-call'],
};
const LANE_LABELS = { code: 'sees its code', seed: 'sees the sentence', none: 'sees nothing' };

const query = new URLSearchParams(location.search);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = selector => document.querySelector(selector);
const els = {
  status: $('#status'),
  statusLabel: $('#status-label'),
  auth: $('#auth'),
  notice: $('#notice'),
  stages: { seed: $('#stage-seed'), code: $('#stage-code'), gate: $('#stage-gate'), run: $('#stage-run'), turns: $('#lab-turns') },
  seed: $('#seed'),
  seedBytes: $('#seed-bytes'),
  seedMeta: $('#seed-meta'),
  seedChips: $('#seed-chips'),
  floorScale: $('#floor-scale'),
  floorLabel: $('#floor-label'),
  grow: $('#grow'),
  transcript: $('#transcript'),
  hood: $('#hood'),
  lanesMeta: $('#lanes-meta'),
  code: $('#code'),
  raw: $('#raw'),
  codeMeta: $('#code-meta'),
  codeInfo: $('#code-info'),
  attempts: $('#attempts'),
  sabotage: $('#sabotage'),
  sabotageDiff: $('#sabotage-diff'),
  rawToggle: $('#raw-toggle'),
  revert: $('#revert'),
  gateAgain: $('#gate-again'),
  regrow: $('#regrow'),
  gateMeta: $('#gate-meta'),
  gateTier0: $('#gate-tier0'),
  gateTier1: $('#gate-tier1'),
  gateStamp: $('#gate-stamp'),
  gateCaption: $('#gate-caption'),
  gateBoundary: $('#gate-boundary'),
  tryAgain: $('#try-again'),
  loadArchived: $('#load-archived'),
  runMeta: $('#run-meta'),
  task: $('#task'),
  taskCustom: $('#task-custom'),
  taskCustomWrap: $('#task-custom-wrap'),
  taskHint: $('#task-hint'),
  taskNote: $('#task-note'),
  selfImage: $('#self-image'),
  selfNote: $('#self-note'),
  run: $('#run'),
  runBoth: $('#run-both'),
  stop: $('#stop'),
  taskText: $('#task-text'),
  lanes: $('#lanes'),
  compareVerdict: $('#compare-verdict'),
  receipt: $('#receipt'),
  receiptLine: $('#receipt-line'),
  receiptSub: $('#receipt-sub'),
  copyLink: $('#copy-link'),
  copyCard: $('#copy-card'),
  anotherTask: $('#another-task'),
  regrow2: $('#regrow-2'),
};

const auth = consumeAuthCallback();
if (auth.cleanedUrl) history.replaceState(null, '', auth.cleanedUrl);
let apiKey = auth.apiKey;
const TASK_STORE = 'shprout.customTask';
const PARAM_MAX = 2048;
let champion = '';
let seedId = 'champion-386';
let seedText = SEEDS[0].text;
let code = '';
let grownCode = '';
let generationSeed = '';
let rawReply = '';
let codeOrigin = 'none';
let attempt = 0;
let attempts = [];
let gateReport = null;
let codeFingerprint = '';
let growMs = 0;
let sabotagedBy = '';
let edited = false;
let busy = false;
let checking = false;
let runController = null;
let growController = null;
let runStopped = false;
let stopReason = null;
let lastRun = null;
const sessionResults = new Map();

// ---------- transcript (the output panel) ----------

const tx = {
  clear() { els.transcript.replaceChildren(); },
  step(text) {
    const el = document.createElement('div');
    el.className = 'tx-step pending';
    const prompt = document.createElement('span');
    prompt.className = 'tx-prompt';
    prompt.textContent = '›';
    const label = document.createElement('span');
    label.className = 'tx-text';
    label.textContent = text;
    const result = document.createElement('span');
    result.className = 'tx-result';
    const body = document.createElement('span');
    body.className = 'tx-body';
    body.append(label, result);
    el.append(prompt, body);
    els.transcript.append(el);
    return {
      el,
      set(next) { label.textContent = next; },
      progress(next) { result.textContent = next; },
      done(next, ok) {
        el.classList.remove('pending');
        if (ok !== undefined) el.dataset.ok = String(ok);
        result.textContent = next;
      },
    };
  },
  code(source = '') {
    const pre = document.createElement('pre');
    pre.className = 'tx-code';
    pre.textContent = source;
    els.transcript.append(pre);
    return pre;
  },
  more(pre, bytes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tx-more';
    const closed = `show the whole script · ${formatBytes(bytes)}`;
    button.textContent = closed;
    button.addEventListener('click', () => {
      const open = pre.classList.toggle('open');
      button.textContent = open ? 'collapse the script' : closed;
    });
    els.transcript.append(button);
    return button;
  },
  turn(kind, text, { prose = false } = {}) {
    const el = document.createElement('div');
    el.className = `tx-turn ${kind}${prose ? ' prose' : ''}`;
    const tag = document.createElement('span');
    tag.className = 'tx-tag';
    tag.textContent = kind === 'shell' ? 'output' : prose ? 'model' : 'command';
    const pre = document.createElement('pre');
    pre.textContent = text;
    el.append(tag, pre);
    if (kind !== 'shell' && (text.length > 900 || text.split('\n').length > 14)) {
      pre.classList.add('long');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tx-more';
      const closed = `show all · ${formatBytes(utf8Bytes(text))}`;
      button.textContent = closed;
      button.addEventListener('click', () => {
        const open = pre.classList.toggle('open');
        button.textContent = open ? 'collapse' : closed;
      });
      el.append(document.createElement('span'), button);
    }
    els.transcript.append(el);
    return el;
  },
  note(text) {
    const p = document.createElement('p');
    p.className = 'tx-note';
    p.textContent = text;
    els.transcript.append(p);
    return p;
  },
  final(text, pass) {
    const p = document.createElement('p');
    p.className = 'tx-final';
    p.dataset.pass = String(pass);
    p.textContent = text;
    els.transcript.append(p);
    return p;
  },
  actions(entries) {
    const div = document.createElement('div');
    div.className = 'tx-actions';
    for (const [label, onClick] of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button secondary';
      button.textContent = label;
      button.addEventListener('click', onClick);
      div.append(button);
    }
    els.transcript.append(div);
    return div;
  },
};

bindEvents();
await boot();

async function boot() {
  buildTaskSelect();
  buildSeedChips();
  buildGateRows();
  buildSabotageChips();
  applyQueryState();
  renderFloor();
  setStatus('loading shell', 'booting');
  try {
    new Bash({ files: {}, cwd: '/home/user' });
  } catch (error) {
    notice(`The shell failed to start: ${error.message || error}`);
    setStatus('failed', 'error');
    return;
  }

  if (apiKey) {
    els.auth.querySelector('span').textContent = 'Sign out';
    setStatus('ready', 'ready');
  } else {
    els.auth.title = 'Sign in with Pollinations; you come straight back here';
    setStatus('authorize to grow', 'idle');
  }
  if (auth.error) notice(`Authorization failed: ${auth.error}`);
  els.taskHint.textContent = `End with “Then say exit.” so the agent knows when it is done. Otherwise it keeps going until the ${RUN_CAP.calls}-call cap.`;
  updateControls();
}

function bindEvents() {
  els.auth.addEventListener('click', authorize);
  els.grow.addEventListener('click', () => grow());
  els.seed.addEventListener('input', onSeedInput);
  els.seedChips.addEventListener('click', event => {
    const chip = event.target.closest('.chip[data-seed]');
    if (chip && !chip.disabled) selectSeed(chip.dataset.seed);
  });
  els.sabotage.addEventListener('click', event => {
    const chip = event.target.closest('.chip[data-sabotage]');
    if (chip && !chip.disabled) sabotage(chip.dataset.sabotage);
  });
  els.code.addEventListener('input', () => {
    code = els.code.value;
    edited = true;
    sabotagedBy = '';
    els.gateAgain.disabled = busy || !code.trim();
    els.revert.hidden = !grownCode || code === grownCode;
    els.codeMeta.textContent = `${formatBytes(utf8Bytes(code))} · edited; check again`;
    resetDownstream();
    updateControls();
    updateSelfImageNote();
  });
  els.gateAgain.addEventListener('click', () => { if (!busy) gate({ label: 'the edited script' }); });
  els.revert.addEventListener('click', revert);
  els.rawToggle.addEventListener('click', () => {
    const showRaw = els.raw.hidden;
    els.raw.hidden = !showRaw;
    els.code.hidden = showRaw;
    els.rawToggle.textContent = showRaw ? 'The script' : 'Raw reply';
  });
  els.regrow.addEventListener('click', () => grow({ from: attempt + 1 }));
  els.regrow2.addEventListener('click', () => grow({ from: attempt + 1 }));
  els.tryAgain.addEventListener('click', () => grow());
  els.loadArchived.addEventListener('click', loadArchivedChampion);
  els.task.addEventListener('change', () => {
    syncTaskUi();
    if (els.task.value === CUSTOM_TASK_ID) els.taskCustom.focus();
    syncQuery();
  });
  els.taskCustom.addEventListener('input', () => {
    if (els.taskCustom.value.trim()) clearNotice();
    rememberTask();
    syncTaskUi();
    syncQuery();
  });
  els.selfImage.addEventListener('change', () => {
    updateSelfImageNote();
    syncQuery();
  });
  els.run.addEventListener('click', () => run({ both: false }));
  els.runBoth.addEventListener('click', () => run({ both: true }));
  els.stop.addEventListener('click', stop);
  els.anotherTask.addEventListener('click', () => {
    els.stages.seed.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    els.task.focus();
  });
  els.copyLink.addEventListener('click', () => copyText(location.href, els.copyLink));
  els.copyCard.addEventListener('click', () => copyText(`${els.receiptLine.textContent}\n${location.href}`, els.copyCard));
  $('#download-agent').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'agent.sh';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

// ---------- seeds ----------

function buildSeedChips() {
  els.seedChips.replaceChildren();
  const entries = [
    { id: CONTROL.id, label: CONTROL.label, bytes: 1599, note: 'The hand-written 1,599 B shprout, run through the same checks and task as a control.' },
    ...[...SEEDS].sort((a, b) => utf8Bytes(b.text) - utf8Bytes(a.text)).map(seed => ({ id: seed.id, label: seed.label.replace(/^\d[\d,]* B /, ''), bytes: utf8Bytes(seed.text), note: seed.note, expect: seed.expect })),
    { id: 'custom', label: 'yours', bytes: null, note: 'Whatever is in the box above.' },
  ];
  for (const entry of entries) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.seed = entry.id;
    chip.setAttribute('aria-pressed', 'false');
    const name = document.createElement('span');
    name.textContent = entry.label;
    const bytes = document.createElement('small');
    bytes.textContent = entry.bytes ? formatBytes(entry.bytes) : '';
    chip.append(name, bytes);
    chip.title = entry.expect ? `${entry.note} Archived: ${{ pass: 'passed 2 of 2', flaky: 'passed 1 of 2', fail: 'failed the checks' }[entry.expect]} (2026-07-05).` : entry.note;
    els.seedChips.append(chip);
  }
}

function selectSeed(id) {
  if (busy) return;
  seedId = id;
  if (id === CONTROL.id) {
    seedText = '';
    els.seed.value = '';
  } else if (id !== 'custom') {
    const seed = SEEDS.find(entry => entry.id === id);
    seedText = seed.text;
    els.seed.value = seed.text;
  }
  renderSeedBytes();
  renderSeedChips();
  syncQuery();
  updateControls();
  els.stages.seed.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

function onSeedInput() {
  seedText = els.seed.value;
  const match = SEEDS.find(seed => seed.text === seedText);
  seedId = match ? match.id : 'custom';
  renderSeedBytes();
  renderSeedChips();
  syncQuery();
  updateControls();
}

function renderSeedBytes() {
  const control = seedId === CONTROL.id;
  els.seed.placeholder = control ? 'No sentence: the hand-written shprout is loaded as it is.' : 'Describe the agent in one sentence.';
  els.grow.querySelector('span').textContent = control ? 'Run the hand-written one' : 'Grow it and run it';
  if (control) {
    els.seedBytes.textContent = 'hand-written · 1,599 bytes';
    els.seedMeta.textContent = 'control';
    return;
  }
  const bytes = utf8Bytes(seedText);
  els.seedBytes.textContent = `${bytes.toLocaleString('en-US')} bytes`;
  els.seedBytes.title = `${[...seedText].length} characters; the shell counts bytes`;
  els.seedMeta.textContent = formatBytes(bytes);
  const custom = els.seedChips.querySelector('.chip[data-seed="custom"] small');
  if (custom) custom.textContent = seedId === 'custom' ? formatBytes(bytes) : '';
}

function renderSeedChips() {
  for (const chip of els.seedChips.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.seed === seedId));
    const result = sessionResults.get(chip.dataset.seed);
    if (result) chip.dataset.result = result.pass ? 'pass' : 'fail';
  }
}

function renderFloor() {
  els.floorScale.replaceChildren();
  const points = [
    { id: CONTROL.id, bytes: 1599 },
    ...SEEDS.map(seed => ({ id: seed.id, bytes: utf8Bytes(seed.text) })),
  ];
  if (seedId === 'custom' && seedText) points.push({ id: 'custom', bytes: utf8Bytes(seedText) });
  points.sort((a, b) => a.bytes - b.bytes);
  let previousLabel = -Infinity;
  for (const point of points) {
    const tick = document.createElement('span');
    tick.className = 'floor-tick';
    const position = scalePosition(point.bytes);
    if (position - previousLabel < 4) tick.classList.add('alt');
    else previousLabel = position;
    tick.style.left = `${position}%`;
    const result = sessionResults.get(point.id);
    if (result) tick.dataset.result = result.pass ? 'pass' : 'fail';
    const dot = document.createElement('i');
    const label = document.createElement('em');
    label.textContent = String(point.bytes);
    tick.append(label, dot);
    els.floorScale.append(tick);
  }
  const floor = compressionFloor([...sessionResults.values()]);
  if (floor.floorBytes && floor.firstFailBytes) {
    const line = document.createElement('span');
    line.className = 'floor-line';
    line.style.left = `${(scalePosition(floor.floorBytes) + scalePosition(floor.firstFailBytes)) / 2}%`;
    const text = document.createElement('span');
    text.textContent = `floor in this session · ${formatBytes(floor.floorBytes)}`;
    line.append(text);
    els.floorScale.append(line);
    els.floorLabel.textContent = `shortest sentence that passed here: ${formatBytes(floor.floorBytes)} · longest that failed: ${formatBytes(floor.firstFailBytes)}`;
  } else if (sessionResults.size) {
    els.floorLabel.textContent = `${sessionResults.size} result${sessionResults.size === 1 ? '' : 's'} in this session; the floor line appears once a pass and a fail exist`;
  } else {
    els.floorLabel.textContent = 'no results yet in this session';
  }
}

function scalePosition(bytes) {
  const min = Math.log(100);
  const max = Math.log(2200);
  return 4 + 92 * (Math.log(Math.max(100, bytes)) - min) / (max - min);
}

// ---------- grow ----------

async function grow({ from = 1 } = {}) {
  if (busy || checking || runController) return;
  if (!apiKey && seedId !== CONTROL.id) {
    authorize();
    return;
  }
  if (taskMissing()) return;
  clearNotice();
  busy = true;
  resetDownstream();
  tx.clear();
  setStage('run', 'running');
  els.runMeta.textContent = 'working';
  updateControls();

  try {
    if (seedId === CONTROL.id) {
      setStage('code', 'running');
      setStatus('loading', 'running');
      const step = tx.step('loading the hand-written shprout');
      const response = await fetch('/shprout.txt');
      if (!response.ok) throw new Error(`/shprout.txt: HTTP ${response.status}`);
      rawReply = '';
      await setCode(await response.text(), { origin: 'hand-written' });
      step.done(`${formatBytes(utf8Bytes(code))} of bash · written by a person`, true);
      const report = await gate();
      if (report.pass) await run({ both: false, auto: true });
      return;
    }
    if (!seedText.trim()) {
      notice('Write a sentence first.');
      return;
    }
    if (from === 1) attempts = [];
    for (attempt = from; attempt < from + MAX_ATTEMPTS; attempt += 1) {
      const grown = await growOnce(attempt);
      if (!grown) return;
      const report = await gate();
      attempts.push({ attempt, bytes: utf8Bytes(grown.code), fingerprint: codeFingerprint, pass: report.pass, fail: report.fails[0] || '' });
      renderAttempts();
      if (report.pass) {
        await run({ both: false, auto: true });
        return;
      }
      if (sabotagedBy || edited) return;
      if (attempt - from + 1 < MAX_ATTEMPTS) {
        for (const pre of els.transcript.querySelectorAll('.tx-code:not(.open)')) pre.classList.add('folded');
        setStatus(`growing again · ${attempt - from + 2} of ${MAX_ATTEMPTS}`, 'running');
        tx.note(`growing again with a different random seed · ${attempt - from + 2} of ${MAX_ATTEMPTS}`);
      }
    }
    attempt -= 1;
    els.gateBoundary.hidden = false;
    tx.note('No candidate passed in three attempts. Edit the prompt or inspect the failed checks before trying again.');
    tx.actions([
      ['Try again', () => grow()],
      ['Use the archived script instead', loadArchivedChampion],
    ]);
    setStage('run', 'fail');
    els.runMeta.textContent = 'no script passed';
    setStatus('boundary', 'error');
  } catch (error) {
    if (error?.name !== 'AbortError') notice(error.message || String(error));
    setStatus('failed', 'error');
    setStage('code', 'fail');
    setStage('run', 'fail');
  } finally {
    busy = false;
    updateControls();
  }
}

async function growOnce(number) {
  setStage('code', 'running');
  setStage('gate', 'idle');
  const started = performance.now();
  const step = tx.step(`${GEN_MODEL} writes agent.sh from your sentence${number > 1 ? ` · try ${number}` : ''}`);
  const ticker = setInterval(() => {
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    setStatus(`growing · ${seconds} s`, 'running');
    step.progress(`${seconds} s`);
  }, 100);
  setStatus('growing', 'running');
  els.codeMeta.textContent = `try ${number} · ${GEN_MODEL}`;
  let grown;
  // Generation gets the same Stop button and time cap as a run.
  const bridge = createApiBridge({ apiKey, onEvent: event => { if (event.type === 'error') notice(event.message); } });
  growController = new AbortController();
  growController.signal.addEventListener('abort', () => bridge.abort(), { once: true });
  const timeout = setTimeout(() => growController?.abort('time cap'), RUN_CAP.ms);
  updateControls();
  try {
    grown = await decompress({ fetch: bridge.fetch, seed: seedText, model: GEN_MODEL, attempt: number });
    if (growController.signal.aborted) throw new DOMException('Generation stopped', 'AbortError');
  } catch (error) {
    clearInterval(ticker);
    const reason = growController.signal.aborted ? growController.signal.reason : null;
    if (reason) {
      step.done(reason === 'time cap' ? `stopped at the ${RUN_CAP.ms / 1000} s time cap` : 'stopped', false);
      setStatus('stopped', 'idle');
      setStage('code', 'idle');
      setStage('run', 'idle');
      els.runMeta.textContent = 'stopped';
      return null;
    }
    step.done('failed', false);
    notice(`Grow failed: ${error.message || error}`);
    setStatus('API error', 'error');
    setStage('code', 'fail');
    return null;
  } finally {
    clearTimeout(timeout);
    growController = null;
    updateControls();
  }
  clearInterval(ticker);
  growMs = performance.now() - started;
  rawReply = grown.content;
  attempt = number;
  await setCode(grown.code, { origin: 'grown', fenced: grown.fenced, replyBytes: utf8Bytes(grown.content), step });
  return grown;
}

async function setCode(source, { origin, reveal = false, fenced = true, replyBytes = 0, step = null } = {}) {
  code = source;
  grownCode = source;
  generationSeed = seedText;
  codeOrigin = origin;
  sabotagedBy = '';
  edited = false;
  codeFingerprint = await fingerprint(source);
  els.raw.textContent = rawReply;
  els.raw.hidden = true;
  els.code.hidden = false;
  els.rawToggle.hidden = origin !== 'grown';
  els.rawToggle.textContent = 'Raw reply';
  els.revert.hidden = true;
  els.sabotageDiff.hidden = true;
  els.code.disabled = false;
  const bytes = utf8Bytes(source);
  const ratio = seedId === CONTROL.id ? '' : ` · ×${(bytes / Math.max(1, utf8Bytes(seedText))).toFixed(1)} the sentence`;
  els.codeMeta.textContent = `${formatBytes(bytes)}${ratio}`;
  if (origin === 'hand-written') {
    els.codeInfo.textContent = 'the hand-written shprout, loaded as it is · nothing was grown';
  } else if (origin === 'archived') {
    els.codeInfo.textContent = `archived: grown from the 388 B sentence by ${GEN_MODEL} on 2026-07-05 · fingerprint ${codeFingerprint}`;
  } else {
    els.codeInfo.textContent = `${GEN_MODEL} · temperature 0, random seed ${attempt} · ${(growMs / 1000).toFixed(1)} s · reply ${formatBytes(replyBytes)}, ${fenced ? 'code fence extracted' : 'no code fence'} · fingerprint ${codeFingerprint}`;
  }
  const pre = tx.code('');
  if (reveal && !reduceMotion) await revealCode(source, pre, step);
  else {
    pre.textContent = source;
    els.code.value = source;
  }
  tx.more(pre, bytes);
  pre.classList.add('folded');
  if (step) step.done(`${formatBytes(bytes)} of bash · ${(growMs / 1000).toFixed(1)} s`, true);
  setStage('seed', 'done');
  setStage('code', 'done');
  renderSabotageChips();
  updateSelfImageNote();
}

function revealCode(source, pre, step) {
  setStatus('revealing', 'running');
  return new Promise(resolve => {
    const total = source.length;
    let shown = 0;
    let last = performance.now();
    const tick = now => {
      shown = Math.min(total, shown + Math.ceil(REVEAL_BYTES_PER_SECOND * (now - last) / 1000));
      last = now;
      pre.textContent = source.slice(0, shown);
      pre.scrollTop = pre.scrollHeight;
      if (step) step.progress(formatBytes(utf8Bytes(pre.textContent)));
      if (shown < total) requestAnimationFrame(tick);
      else {
        pre.scrollTop = 0;
        els.code.value = source;
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}

function renderAttempts() {
  els.attempts.replaceChildren();
  for (const entry of attempts) {
    const item = document.createElement('li');
    item.dataset.pass = String(entry.pass);
    item.textContent = `try ${entry.attempt} · ${formatBytes(entry.bytes)} · ${entry.fingerprint} · ${entry.pass ? 'passed' : entry.fail}`;
    els.attempts.append(item);
  }
  els.regrow.hidden = codeOrigin !== 'grown';
  els.regrow2.hidden = codeOrigin !== 'grown';
}

async function loadChampion() {
  if (champion) return champion;
  const response = await fetch(CHAMPION_URL);
  if (!response.ok) throw new Error(`${CHAMPION_URL}: HTTP ${response.status}`);
  champion = await response.text();
  return champion;
}

async function loadArchivedChampion() {
  if (busy || runController) return;
  if (taskMissing()) return;
  busy = true;
  updateControls();
  try {
    resetDownstream();
    tx.clear();
    els.gateBoundary.hidden = true;
    setStage('run', 'running');
    const step = tx.step('loading the archived script grown from the 388 B sentence on 2026-07-05');
    await loadChampion();
    rawReply = '';
    await setCode(champion, { origin: 'archived' });
    step.done(`${formatBytes(utf8Bytes(code))} of bash`, true);
    const report = await gate();
    if (report.pass) await run({ both: false, auto: true });
  } catch (error) {
    notice(error.message || String(error));
  } finally {
    busy = false;
    updateControls();
  }
}

// ---------- sabotage ----------

function buildSabotageChips() {
  els.sabotage.replaceChildren();
  for (const entry of SABOTAGE) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.sabotage = entry.id;
    chip.textContent = entry.label;
    chip.disabled = true;
    els.sabotage.append(chip);
  }
}

function renderSabotageChips() {
  for (const chip of els.sabotage.querySelectorAll('.chip')) {
    const { matches } = applySabotage(code, chip.dataset.sabotage);
    chip.disabled = busy || Boolean(runController) || matches !== 1;
    chip.title = matches === 1 ? 'patch one line, then check again' : 'no matching line in this script';
    chip.setAttribute('aria-pressed', String(sabotagedBy === chip.dataset.sabotage));
  }
}

async function sabotage(id) {
  if (busy || runController) return;
  const result = applySabotage(grownCode || code, id);
  if (result.matches !== 1) return;
  code = result.source;
  sabotagedBy = id;
  edited = false;
  els.code.value = code;
  els.sabotageDiff.hidden = false;
  els.sabotageDiff.replaceChildren();
  const minus = document.createElement('span');
  minus.className = 'minus';
  minus.textContent = `- ${result.diff.before}\n`;
  const plus = document.createElement('span');
  plus.className = 'plus';
  plus.textContent = `+ ${result.diff.after}`;
  els.sabotageDiff.append(minus, plus);
  els.revert.hidden = false;
  renderSabotageChips();
  busy = true;
  updateControls();
  try {
    await gate({ label: `the script with "${SABOTAGE.find(entry => entry.id === id).label}" patched in` });
  } finally {
    busy = false;
    updateControls();
  }
}

async function revert() {
  if (busy || runController || !grownCode) return;
  code = grownCode;
  sabotagedBy = '';
  edited = false;
  els.code.value = code;
  els.sabotageDiff.hidden = true;
  els.revert.hidden = true;
  renderSabotageChips();
  busy = true;
  updateControls();
  try {
    await gate({ label: 'the original script again' });
  } finally {
    busy = false;
    updateControls();
  }
}

// ---------- gate ----------

function buildGateRows() {
  els.gateTier0.replaceChildren();
  els.gateTier1.replaceChildren();
  for (const check of GATE_CHECKS) {
    const row = document.createElement('li');
    row.className = 'gate-row';
    row.dataset.check = check.id;
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = '·';
    const label = document.createElement('span');
    label.className = 'label';
    const title = document.createElement('b');
    title.textContent = check.label;
    label.append(title);
    row.append(mark, label);
    (check.tier === 0 ? els.gateTier0 : els.gateTier1).append(row);
  }
}

async function gate({ label = '' } = {}) {
  if (!code.trim() || checking) return null;
  checking = true;
  updateControls();
  try {
    resetRun();
    setStage('gate', 'running');
    setStatus('checking', 'running');
    const step = tx.step(label
      ? `checking ${label}`
      : 'checking it: reads its own source, calls the model, runs the code, keeps its history, stops on exit');
    els.gateStamp.hidden = true;
    els.gateCaption.hidden = true;
    els.gateBoundary.hidden = true;
    els.gateMeta.textContent = 'running';
    for (const row of document.querySelectorAll('.gate-row')) {
      row.classList.remove('shown');
      delete row.dataset.ok;
      row.querySelector('.mark').textContent = '·';
      row.querySelector('.label').replaceChildren(row.querySelector('.label b'));
    }
    const report = await runGate(Bash, code, { timeoutMs: 20000 });
    gateReport = report;
    const passed = report.checks.filter(check => check.ok).length;
    const rows = [...document.querySelectorAll('.gate-row')];
    for (const [index, check] of report.checks.entries()) {
      const row = rows.find(entry => entry.dataset.check === check.id);
      if (!row) continue;
      const show = () => renderGateRow(row, check, report);
      if (reduceMotion || !els.hood.open) show();
      else setTimeout(show, GATE_ROW_STAGGER_MS * index);
    }
    const settle = reduceMotion || !els.hood.open ? 0 : GATE_ROW_STAGGER_MS * report.checks.length + 60;
    await new Promise(resolve => setTimeout(resolve, settle));

    const limit = report.pass ? null : classifySandboxLimit(report.stderr);
    els.gateStamp.hidden = false;
    els.gateStamp.dataset.pass = String(report.pass);
    els.gateStamp.replaceChildren();
    const stampText = document.createElement('span');
    const stampNote = document.createElement('small');
    if (report.pass) {
      stampText.textContent = `PASSED ${passed}/${report.checks.length} · ${report.ms} ms`;
      stampNote.textContent = 'scripted model · no network';
    } else if (limit) {
      stampText.textContent = 'FAILED · sandbox limit';
      stampNote.textContent = limit.what;
    } else {
      stampText.textContent = `FAILED · ${report.fails[0]}`;
      stampNote.textContent = `${passed}/${report.checks.length} · ${report.ms} ms`;
    }
    els.gateStamp.append(stampText, stampNote);
    els.gateCaption.hidden = false;
    if (limit) {
      const line = (report.stderr || '').split('\n').find(entry => limit.test.test(entry)) || '';
      els.gateCaption.textContent = `This shell can't run it: ${limit.what}. It may be fine on real bash; copy it and try.${line ? ` Shell said: ${line.trim()}` : ''}`;
    } else if (report.pass) {
      els.gateCaption.textContent = `${report.ms} ms of real time; the rows are revealed slower so you can read them.`;
    } else {
      els.gateCaption.textContent = report.fails.map(fail => `${fail}: ${glossFor(fail)}`).join(' ');
    }
    els.gateMeta.textContent = `${passed}/${report.checks.length} · ${report.ms} ms`;
    setStage('gate', report.pass ? 'done' : 'fail');
    setStatus(report.pass ? 'checks passed' : 'checks failed', report.pass ? 'done' : 'error');
    if (report.pass) step.done(`${passed}/${report.checks.length} · ${report.ms} ms`, true);
    else if (limit) step.done(`this shell can't run it: ${limit.what}`, false);
    else step.done(`${passed}/${report.checks.length} · ${plainFor(report.fails[0])}`, false);

    const attributable = codeOrigin === 'grown' || codeOrigin === 'hand-written' || (codeOrigin === 'archived' && seedId === 'champion-386');
    if (!sabotagedBy && !edited && attributable) {
      sessionResults.set(seedId, { bytes: seedId === CONTROL.id ? 1599 : utf8Bytes(seedText), pass: report.pass });
      renderSeedChips();
      renderFloor();
    }
    if (!report.pass) {
      setStage('run', 'fail');
      els.runMeta.textContent = 'not run · checks failed';
      tx.note(`not run: a script that fails the checks never gets the task. Details under the hood.`);
    }
    updateControls();
    return report;
  } finally {
    checking = false;
    updateControls();
  }
}

function renderGateRow(row, check, report) {
  row.classList.add('shown');
  row.dataset.ok = String(Boolean(check.ok));
  row.querySelector('.mark').textContent = check.ok ? '✓' : '✗';
  const label = row.querySelector('.label');
  const requestIndex = REQUEST_INDEX[check.id];
  if (requestIndex !== undefined) {
    const request = report.requests[requestIndex];
    const detail = document.createElement('small');
    const needles = NEEDLES[check.id];
    detail.textContent = request
      ? `request ${requestIndex + 1} · ${formatBytes(utf8Bytes(request.raw))} · looking for ${needles.join(' + ')}`
      : `request ${requestIndex + 1} · never sent`;
    label.append(detail);
    if (request) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'show the request';
      const pre = document.createElement('pre');
      appendHighlighted(pre, request.raw, needles);
      details.append(summary, pre);
      label.append(details);
    }
  } else if (check.id === 'calls' || check.id === 'exit') {
    const detail = document.createElement('small');
    detail.textContent = check.id === 'calls' ? `${report.calls} call${report.calls === 1 ? '' : 's'}` : report.calls === 3 ? 'stopped after 3 calls' : `${report.calls} calls`;
    label.append(detail);
  } else if (check.id === 'size') {
    const detail = document.createElement('small');
    detail.textContent = `${formatBytes(utf8Bytes(code))} < 4 KB`;
    label.append(detail);
  }
  if (!check.ok) {
    const candidates = check.tier === 0 ? [`missing:${check.id}`] : FAIL_FOR[check.id] || [];
    const key = report.fails.find(fail => candidates.some(prefix => fail.startsWith(prefix)));
    const gloss = document.createElement('span');
    gloss.className = 'gloss';
    gloss.textContent = glossFor(key);
    label.append(gloss);
  }
}

function failKey(fail) {
  if (!fail) return '';
  const head = fail.split(' ')[0].replace(/:$/, '');
  if (GLOSS[head]) return head;
  return fail.split(':')[0];
}

function glossFor(fail) {
  return GLOSS[failKey(fail)] || 'failed';
}

function plainFor(fail) {
  return PLAIN[failKey(fail)] || fail || 'failed';
}

function appendHighlighted(target, raw, needles) {
  const tail = raw.length > 1400 ? `…${raw.slice(-1400)}` : raw;
  const pattern = new RegExp(needles.map(needle => needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  let last = 0;
  for (const match of tail.matchAll(pattern)) {
    target.append(document.createTextNode(tail.slice(last, match.index)));
    const mark = document.createElement('mark');
    mark.textContent = match[0];
    target.append(mark);
    last = match.index + match[0].length;
  }
  target.append(document.createTextNode(tail.slice(last)));
  for (const needle of needles) {
    if (!raw.includes(needle)) {
      const ghost = document.createElement('mark');
      ghost.className = 'ghost';
      ghost.textContent = ` ${needle} missing `;
      target.append(document.createTextNode('\n'), ghost);
    }
  }
}

// ---------- run ----------

function buildTaskSelect() {
  els.task.replaceChildren();
  for (const task of TASKS) {
    const option = document.createElement('option');
    option.value = task.id;
    option.textContent = task.label.toLowerCase();
    els.task.append(option);
  }
  const custom = document.createElement('option');
  custom.value = CUSTOM_TASK_ID;
  custom.textContent = 'your own task…';
  els.task.append(custom);
  els.taskText.textContent = TASKS[0].prompt;
}

function currentTask() {
  return els.task.value === CUSTOM_TASK_ID ? customTask(els.taskCustom.value) : taskById(els.task.value);
}

function syncTaskUi() {
  const custom = els.task.value === CUSTOM_TASK_ID;
  els.taskCustomWrap.hidden = !custom;
  els.taskText.textContent = currentTask().prompt || '(type the task in the box above)';
  const bytes = utf8Bytes(els.taskCustom.value.trim());
  els.taskNote.hidden = bytes <= PARAM_MAX;
  els.taskNote.textContent = `${bytes.toLocaleString('en-US')} bytes · a link carries at most ${PARAM_MAX.toLocaleString('en-US')}, so this task stays in this tab and is not in the link`;
}

// The typed task also lives in sessionStorage so the sign-in round trip and a
// task too long for the URL do not lose it.
function rememberTask() {
  try {
    const text = els.taskCustom.value;
    if (text.trim()) sessionStorage.setItem(TASK_STORE, text);
    else sessionStorage.removeItem(TASK_STORE);
  } catch {
    // storage may be unavailable; the URL still carries short tasks
  }
}

function storedTask() {
  try {
    return sessionStorage.getItem(TASK_STORE) || '';
  } catch {
    return '';
  }
}

function exitHint(task) {
  return task.custom && !/\bexit\b/i.test(task.prompt) ? ' · your task never told it to say exit, so it kept going' : '';
}

function taskMissing() {
  if (els.task.value !== CUSTOM_TASK_ID || els.taskCustom.value.trim()) return false;
  notice('Type the task for the agent first.');
  els.taskCustom.focus();
  return true;
}

function updateSelfImageNote() {
  const { matches } = code ? applySelfImage(code) : { matches: 0 };
  const selected = selfImageValue();
  for (const input of els.selfImage.querySelectorAll('input')) {
    input.disabled = busy || checking || Boolean(runController) || (input.value !== 'code' && matches !== 1);
  }
  if (!code) els.selfNote.textContent = '';
  else if (matches !== 1) {
    els.selfNote.textContent = matches === 0 ? 'no $0 self-read found to swap' : `${matches} self-reads found; the swap needs exactly one`;
    if (selected !== 'code') els.selfImage.querySelector('input[value="code"]').checked = true;
  } else if (selected === 'code') els.selfNote.textContent = 'the prompt starts with the script\'s own source';
  else els.selfNote.textContent = `one line patched: $0 → \${SHPROUT_SELF:-$0} · ${selected === 'seed' ? 'the prompt starts with the sentence instead' : 'the source is withheld'}`;
  els.runBoth.hidden = matches !== 1;
}

function selfImageValue() {
  return els.selfImage.querySelector('input:checked')?.value || 'code';
}

async function run({ both, auto = false }) {
  if (runController || checking || !gateReport?.pass || (busy && !auto)) return;
  if (taskMissing()) {
    setStage('run', 'idle');
    els.runMeta.textContent = 'waiting for your task';
    return;
  }
  const task = currentTask();
  const modes = both ? ['code', 'seed'] : [selfImageValue()];
  clearNotice();
  runController = new AbortController();
  runStopped = false;
  lastRun = null;
  els.lanes.dataset.count = String(modes.length);
  els.lanes.replaceChildren();
  els.compareVerdict.hidden = true;
  els.receipt.hidden = true;
  setStage('run', 'running');
  setStage('turns', 'running');
  setStatus('running', 'running');
  els.runMeta.textContent = 'running';
  els.lanesMeta.textContent = 'running';
  updateControls();
  const step = tx.step(both
    ? `running agent.sh on “${task.label}” twice: once seeing its code, once the seed`
    : `running agent.sh on “${task.label}”`);
  if (!both && modes[0] !== 'code') tx.note(modes[0] === 'seed' ? 'this run: the script sees the sentence instead of its own source' : 'this run: the script sees nothing about itself');
  stopReason = null;
  const timeout = setTimeout(() => {
    if (!runController || runController.signal.aborted) return;
    runStopped = true;
    stopReason = `${RUN_CAP.ms / 1000} s time cap`;
    tx.note(`stopped: ${RUN_CAP.ms / 1000} s is the time cap for one run`);
    runController.abort('time cap');
  }, RUN_CAP.ms);
  const started = performance.now();
  const laneLabel = mode => (codeOrigin === 'hand-written' ? `hand-written · ${LANE_LABELS[mode]}` : LANE_LABELS[mode]);

  try {
    const results = await Promise.all(modes.map((mode, index) => runLane({ mode, task, label: laneLabel(mode), primary: index === 0 })));
    clearTimeout(timeout);
    const elapsed = (performance.now() - started) / 1000;
    const finished = results.filter(Boolean);
    const complete = finished.length === modes.length;
    // A typed task has no automatic check: pass is null, the run counts as finished
    // and the person judges the output.
    const judged = complete && finished.every(result => result.pass !== null);
    const solved = judged && finished.every(result => result.pass);
    const ok = runStopped || !complete ? false : judged ? solved : null;
    const stageState = runStopped ? 'idle' : ok === false ? 'fail' : 'done';
    const calls = finished.reduce((sum, result) => sum + result.calls, 0);
    const callsText = `${calls} model call${calls === 1 ? '' : 's'}`;
    els.runMeta.textContent = runStopped ? `stopped · ${callsText} · ${elapsed.toFixed(1)} s` : `${callsText} · ${elapsed.toFixed(1)} s`;
    els.lanesMeta.textContent = els.runMeta.textContent;
    setStage('run', stageState);
    setStage('turns', stageState);
    setStatus(runStopped ? 'stopped' : ok === null ? 'finished' : solved ? 'done' : 'not solved', runStopped ? 'idle' : ok === false ? 'error' : 'done');
    if (runStopped) {
      step.done(`stopped · ${callsText} · ${elapsed.toFixed(1)} s`, false);
      tx.final(stopReason
        ? `stopped by the ${stopReason} after ${callsText} · what it printed is above${exitHint(task)}`
        : `stopped before it finished · ${callsText}`, false);
      if (!both && results[0]) {
        lastRun = { ...results[0], task, elapsed, stopped: true, stopReason };
        renderReceipt();
      }
    } else if (both) {
      step.done(`${callsText} · ${elapsed.toFixed(1)} s`, ok);
      const compare = results.map((result, index) => `${LANE_LABELS[modes[index]]}: ${result ? `${result.pass === null ? 'finished' : result.pass ? 'solved' : 'not solved'} in ${result.calls} call${result.calls === 1 ? '' : 's'}, ${formatBytes(result.sent)} sent` : 'stopped'}`).join(' · ');
      els.compareVerdict.hidden = false;
      els.compareVerdict.dataset.pass = String(ok);
      els.compareVerdict.textContent = `${compare} · one run each, rerun to see variance`;
      tx.final(compare, ok);
    } else if (results[0]) {
      step.done(`${callsText} · ${elapsed.toFixed(1)} s`, ok);
      tx.final(ok === null
        ? `finished in ${callsText} · the terminal output is the result; quality has not been automatically judged`
        : solved
          ? `✓ ${task.expect} · ${task.label.toLowerCase()} done in ${callsText}`
          : `✗ ${task.label.toLowerCase()} not done · ${task.expect} never showed up`, ok);
      lastRun = { ...results[0], task, elapsed };
      renderReceipt();
    }
  } catch (error) {
    if (error?.name !== 'AbortError') notice(error.message || String(error));
    step.done('failed', false);
    setStage('run', 'fail');
    setStatus('failed', 'error');
  } finally {
    clearTimeout(timeout);
    runController = null;
    updateControls();
  }
}

async function runLane({ mode, task, label, primary }) {
  const lane = createLane(label, mode, primary);
  const replies = [];
  // Each lane has its own controller: Stop and the time cap end every lane,
  // but one lane reaching its call cap must not cut the other lane short.
  const controller = new AbortController();
  const run = runController;
  const forward = () => controller.abort(run.signal.reason);
  if (run.signal.aborted) forward(); else run.signal.addEventListener('abort', forward, { once: true });
  let previousPrompt = null;
  let previousReply = '';
  const inner = createApiBridge({ apiKey, onEvent: event => laneEvent(lane, event) });
  const metered = createMeteredFetch(inner.fetch, {
    code,
    seed: seedText,
    maxCalls: RUN_CAP.calls,
    onTurn: turn => {
      replies.push(turn.content ?? '');
      const prompt = promptOf(turn.raw);
      if (previousPrompt !== null && prompt.startsWith(previousPrompt)) {
        const output = outputFromAppended(prompt.slice(previousPrompt.length), previousReply);
        if (output) recordShell(lane, turn.index - 1, output);
      }
      previousPrompt = prompt;
      previousReply = turn.content ?? '';
      renderTurn(lane, turn, mode);
    },
    onEvent: event => {
      if (event.type === 'cap') {
        runStopped = true;
        stopReason = `${event.calls}-call cap`;
        lane.status.textContent = `stopped at ${event.calls} calls (cap)`;
        if (lane.primary) tx.note(`stopped: ${event.calls} model calls is the cap for one run`);
        inner.abort?.();
        controller.abort('cap');
      } else if (event.type === 'retry') {
        lane.status.textContent = `retry ${event.attempt} after HTTP ${event.status}`;
        if (lane.primary) tx.note(`the API answered ${event.status}; retrying (${event.attempt})`);
      }
    },
  });
  const onAbort = () => { inner.abort?.(); metered.abort(); };
  controller.signal.addEventListener('abort', onAbort, { once: true });
  const { bash } = mountAgent(Bash, { source: code, fetch: metered.fetch, selfImage: mode, seed: seedText });
  lane.status.textContent = 'thinking';
  const poll = setInterval(() => refreshFiles(lane, bash), 250);
  let result;
  try {
    result = await runTask(bash, task, { signal: controller.signal, replies });
  } catch (error) {
    clearInterval(poll);
    controller.signal.removeEventListener('abort', onAbort);
    run.signal.removeEventListener('abort', forward);
    const stopped = controller.signal.aborted || error?.name === 'AbortError';
    if (!stopped) notice(error.message || String(error));
    lane.status.textContent = stopped ? (runStopped ? lane.status.textContent : 'stopped') : 'failed';
    runStopped = runStopped || stopped;
    await refreshFiles(lane, bash);
    return null;
  }
  clearInterval(poll);
  controller.signal.removeEventListener('abort', onAbort);
  run.signal.removeEventListener('abort', forward);
  await refreshFiles(lane, bash);
  attachOutputs(lane, result);
  const calls = metered.calls();
  const stoppedLate = controller.signal.aborted;
  if (stoppedLate) runStopped = true;
  const verdict = lane.element.querySelector('.lane-verdict');
  verdict.hidden = false;
  verdict.dataset.pass = String(stoppedLate ? false : result.pass);
  const capped = controller.signal.reason === 'cap';
  verdict.textContent = stoppedLate
    ? `${capped ? `reached the ${calls}-call cap` : 'stopped before it finished'} · ${calls} call${calls === 1 ? '' : 's'} · ${(result.ms / 1000).toFixed(1)} s`
    : result.pass === null
    ? `finished; no automatic quality check · ${calls} call${calls === 1 ? '' : 's'} · ${(result.ms / 1000).toFixed(1)} s`
    : result.pass
    ? `${task.expect} · solved · ${calls} call${calls === 1 ? '' : 's'} · ${(result.ms / 1000).toFixed(1)} s`
    : `${task.expect.replace(' printed', '')} not found in the shell's output · not solved · ${calls} call${calls === 1 ? '' : 's'} · exit ${result.exitCode}`;
  lane.status.textContent = capped ? `stopped at ${calls} calls (cap)` : controller.signal.aborted ? 'stopped' : result.pass === null ? 'finished' : result.pass ? 'solved' : 'not solved';
  if (lane.primary && lane.files.dataset.count && lane.files.dataset.count !== '0') tx.note(`files left in the workspace: ${lane.files.dataset.names}`);
  return { pass: result.pass, calls, sent: lane.sentBytes, exitCode: result.exitCode, ms: result.ms, output: result.output };
}

function promptOf(raw) {
  try {
    const body = JSON.parse(raw);
    return (body.messages || []).map(message => (typeof message.content === 'string' ? message.content : '')).join('\n');
  } catch {
    return '';
  }
}

function createLane(label, mode, primary) {
  const element = document.createElement('article');
  element.className = 'lane';
  element.dataset.mode = mode;
  const head = document.createElement('header');
  head.className = 'lane-head';
  const title = document.createElement('b');
  title.textContent = label;
  const status = document.createElement('span');
  status.className = 'lane-status';
  status.textContent = 'mounting';
  head.append(title, status);
  const cols = document.createElement('div');
  cols.className = 'lane-cols';
  const sendsSection = document.createElement('section');
  const sendsTitle = document.createElement('h4');
  sendsTitle.textContent = 'What it sends';
  const sends = document.createElement('ol');
  sends.className = 'sends';
  sendsSection.append(sendsTitle, sends);
  const happensSection = document.createElement('section');
  const happensTitle = document.createElement('h4');
  happensTitle.textContent = 'What happens';
  const happens = document.createElement('ol');
  happens.className = 'happens';
  happensSection.append(happensTitle, happens);
  cols.append(sendsSection, happensSection);
  const files = document.createElement('p');
  files.className = 'lane-files';
  files.textContent = 'files: none yet';
  const verdict = document.createElement('p');
  verdict.className = 'lane-verdict';
  verdict.hidden = true;
  element.append(head, cols, files, verdict);
  els.lanes.append(element);
  return { element, status, sends, happens, files, primary, sentBytes: 0, pending: null, cards: [], filesKey: null };
}

function laneEvent(lane, event) {
  if (event.type === 'request') {
    lane.status.textContent = 'thinking';
    setStatus('thinking', 'running');
    if (!lane.pending) {
      const pending = document.createElement('li');
      pending.className = 'card pending';
      pending.textContent = `turn ${lane.cards.length + 1} · waiting for the model`;
      lane.happens.append(pending);
      lane.pending = pending;
    }
  } else if (event.type === 'response') {
    lane.status.textContent = 'acting';
    setStatus('acting', 'running');
  } else if (event.type === 'error') {
    if (runStopped || runController?.signal.aborted) return;
    notice(event.message);
    lane.status.textContent = 'API error';
  }
}

function renderTurn(lane, turn, mode) {
  const number = turn.index + 1;
  const measure = turn.measure;
  lane.sentBytes += measure.bytes;
  const sendCard = document.createElement('li');
  sendCard.className = 'card';
  const head = document.createElement('div');
  head.className = 'card-head';
  const title = document.createElement('span');
  title.textContent = `Turn ${number} · sent ${formatBytes(measure.bytes)}`;
  head.append(title);
  if (measure.delta !== null && measure.delta !== undefined) {
    const delta = document.createElement('span');
    delta.className = 'delta';
    delta.textContent = `(${measure.delta >= 0 ? '+' : ''}${formatBytes(measure.delta)})`;
    head.append(delta);
  }
  sendCard.append(head);
  const note = document.createElement('span');
  if (number === 1) {
    if (mode === 'code' && measure.selfVerified) {
      note.textContent = `${formatBytes(measure.selfBytes)} of that is its own source `;
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'verified';
      note.append(badge);
    } else if (mode === 'seed' && measure.seedVerified) {
      note.textContent = `${formatBytes(measure.seedBytes)} of that is the sentence `;
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'verified';
      note.append(badge);
    } else if (mode === 'none') {
      note.textContent = 'the source is withheld from the model';
    } else {
      note.textContent = 'could not find the script\'s source in the request ';
      const badge = document.createElement('span');
      badge.className = 'badge warn';
      badge.textContent = 'unverified';
      note.append(badge);
    }
  } else {
    note.textContent = 'its reply and the shell\'s answer, appended';
  }
  sendCard.append(note);
  lane.sends.append(sendCard);

  const { thought, action } = replyParts(turn.content ?? '');
  const card = lane.pending || document.createElement('li');
  card.className = 'card';
  card.replaceChildren();
  const cardHead = document.createElement('div');
  cardHead.className = 'card-head';
  cardHead.textContent = `Turn ${number}${action ? '' : ' · done'}`;
  card.append(cardHead);
  if (thought) {
    const prose = document.createElement('span');
    prose.className = 'thought';
    prose.textContent = thought.length > 400 ? `${thought.slice(0, 400)}…` : thought;
    card.append(prose);
  }
  if (action) {
    const pre = document.createElement('pre');
    pre.textContent = action;
    card.append(pre);
  }
  if (!lane.pending) lane.happens.append(card);
  lane.pending = null;
  let agentEl = null;
  if (lane.primary) {
    const text = action || thought || '(empty reply)';
    agentEl = tx.turn('agent', text.length > 4000 ? `${text.slice(0, 4000)}…` : text, { prose: !action });
  }
  lane.cards.push({ card, action, number, agentEl, shellDone: false });
}

function recordShell(lane, index, output) {
  const entry = lane.cards[index];
  if (!entry || entry.shellDone || !entry.action) return;
  entry.shellDone = true;
  const text = output.out ? output.out : `(no output${output.rc ? `, rc=${output.rc}` : ''})`;
  const pre = document.createElement('pre');
  pre.className = 'out';
  pre.textContent = `→ ${text}`;
  if (/command not found/.test(output.out || '') && !/command not found/.test(entry.action)) pre.classList.add('dim');
  entry.card.append(pre);
  if (lane.primary && entry.agentEl) {
    const el = tx.turn('shell', text.length > 6000 ? `${text.slice(0, 6000)}…` : text);
    entry.agentEl.after(el);
  }
}

function attachOutputs(lane, result) {
  const text = `${result.stdout || ''}${result.stderr ? `\n${result.stderr}` : ''}`.trim();
  const iterations = [...text.matchAll(/===== iteration (\d+) =====\n>>> reply:\n[\s\S]*?\n>>> output \(rc=(\d+)\):\n([\s\S]*?)(?=\n===== iteration \d+ =====|\n\[agent\]|$)/g)];
  const perTurn = new Map(iterations.map(match => [Number(match[1]), { rc: match[2], out: match[3].trim() }]));
  if (!perTurn.size) for (const [index, out] of quotedTurns(result.stdout || '').entries()) perTurn.set(index + 1, { rc: null, out });
  for (const entry of lane.cards) {
    const output = perTurn.get(entry.number);
    if (output && entry.action && !entry.shellDone) recordShell(lane, entry.number - 1, output);
  }
  const anyShell = lane.cards.some(entry => entry.shellDone);
  if (/^bash: execution aborted$/.test(text)) {
    // just-bash drops what the script had printed when it is stopped mid-command.
    if (lane.primary && !anyShell && lane.cards.length) tx.note('stopped mid-command: the shell dropped what it had printed');
    return;
  }
  if (!anyShell && text) {
    const last = lane.cards.at(-1)?.card;
    const pre = document.createElement('pre');
    pre.className = 'out';
    pre.textContent = text.length > 3000 ? `${text.slice(0, 3000)}…` : text;
    (last || lane.happens).append(pre);
    if (lane.primary) tx.turn('shell', text.length > 6000 ? `${text.slice(0, 6000)}…` : text);
  }
}

// The hand-written shprout echoes each reply with a "> " prefix and prints the
// eval output bare after it, so the bare runs between quoted blocks are the outputs.
function quotedTurns(stdout) {
  const turns = [];
  let inQuote = false;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('> ')) {
      if (!inQuote) turns.push([]);
      inQuote = true;
    } else if (turns.length) {
      inQuote = false;
      turns.at(-1).push(line);
    }
  }
  return turns.map(lines => lines.join('\n').trim());
}

async function refreshFiles(lane, bash) {
  let files;
  try {
    files = await readWorkspace(bash);
  } catch {
    return;
  }
  const key = JSON.stringify([...files]);
  if (key === lane.filesKey) return;
  lane.filesKey = key;
  lane.files.replaceChildren();
  lane.files.dataset.count = String(files.size);
  lane.files.dataset.names = [...files.keys()].join(', ');
  if (!files.size) {
    lane.files.textContent = 'files: none';
    return;
  }
  lane.files.append(document.createTextNode('files: '));
  let first = true;
  for (const [path, content] of files) {
    if (!first) lane.files.append(document.createTextNode(' · '));
    first = false;
    const name = document.createElement('b');
    name.textContent = path;
    lane.files.append(name, document.createTextNode(` ${formatBytes(utf8Bytes(content))}`));
    const preview = content.trim().split('\n')[0];
    if (preview) lane.files.append(document.createTextNode(` "${preview.length > 40 ? `${preview.slice(0, 40)}…` : preview}"`));
  }
}

function stop() {
  if (growController) { growController.abort('stopped'); return; }
  if (!runController) return;
  runStopped = true;
  setStatus('stopping', 'running');
  runController.abort('stopped');
}

function renderReceipt() {
  if (!lastRun || !gateReport) return;
  const codeBytes = utf8Bytes(code);
  const calls = `${lastRun.calls} model call${lastRun.calls === 1 ? '' : 's'}`;
  const job = lastRun.task.custom ? 'your task' : `“${lastRun.task.label}”`;
  const identity = selfImageValue() === 'code' ? 'used its source as context' : selfImageValue() === 'seed' ? 'used the seed as its self-description' : 'ran with its initial self-description withheld';
  const head = codeOrigin === 'hand-written'
    ? `The hand-written ${formatBytes(codeBytes)} shprout`
    : codeOrigin === 'archived'
      ? `388 bytes of English became ${codeBytes.toLocaleString('en-US')} bytes of bash, back in July. The archived script`
      : `${utf8Bytes(generationSeed).toLocaleString('en-US')} bytes of English became ${codeBytes.toLocaleString('en-US')} bytes of bash. The script`;
  els.receiptLine.textContent = lastRun.stopped
    ? `${head} ${identity} and worked on ${job} for ${calls} before ${lastRun.stopReason ? `the ${lastRun.stopReason} stopped it` : 'you stopped it'}. The result is partial.`
    : lastRun.pass === null
    ? `${head} ${identity} and worked on ${job} for ${calls}. Whether it did the job is yours to judge from the output.`
    : lastRun.pass
    ? `${head} ${identity} and passed the check for ${job} in ${calls}.`
    : `${head} ${identity} and tried ${job}, but the expected result was not found after ${calls}.`;
  els.receiptSub.textContent = codeOrigin === 'hand-written'
    ? 'Pick a sentence under the hood to grow one instead.'
    : `Written by ${GEN_MODEL} in ${(growMs / 1000).toFixed(1)} s${selfImageValue() === 'code' ? '' : ` · it saw ${selfImageValue() === 'seed' ? 'the sentence' : 'nothing'} instead of its code`}.`;
  els.receipt.hidden = false;
}

// ---------- shared ----------

function resetDownstream() {
  gateReport = null;
  els.gateStamp.hidden = true;
  els.gateCaption.hidden = true;
  els.gateBoundary.hidden = true;
  els.gateMeta.textContent = 'run before every run';
  setStage('gate', 'idle');
  resetRun();
}

function resetRun() {
  if (runController) stop();
  lastRun = null;
  els.lanes.replaceChildren();
  els.lanes.dataset.count = '0';
  els.compareVerdict.hidden = true;
  els.receipt.hidden = true;
  els.lanesMeta.textContent = 'after a run';
  setStage('turns', 'idle');
}

function setStage(name, state) {
  els.stages[name].dataset.state = state;
}

function setStatus(text, kind) {
  els.statusLabel.textContent = text;
  els.status.dataset.kind = kind;
}

function updateControls() {
  const idle = !busy && !checking && !runController;
  const canGrow = idle;
  els.grow.disabled = !canGrow;
  els.gateAgain.disabled = !idle || !code.trim();
  els.code.disabled = !code || !idle;
  const canRun = idle && Boolean(gateReport?.pass);
  els.run.disabled = !canRun;
  els.runBoth.disabled = !canRun;
  els.stop.hidden = !runController && !growController;
  els.task.disabled = !idle;
  els.seed.disabled = !idle;
  els.auth.disabled = !idle;
  for (const button of [els.regrow, els.regrow2, els.tryAgain, els.loadArchived, els.revert]) button.disabled = !idle;
  els.taskCustom.disabled = !idle;
  for (const chip of els.seedChips.querySelectorAll('.chip')) {
    chip.disabled = !idle;
  }
  renderSabotageChips();
  updateSelfImageNote();
}

function authorize() {
  if (apiKey) {
    clearAuthSession();
    location.reload();
    return;
  }
  // The sentence, task and self-image live in the query string, so sending the
  // search along brings the person back to exactly what they set up.
  location.href = createAuthorizationUrl({ redirectUrl: `${location.origin}${location.pathname}${location.search}` });
}

function notice(message) {
  els.notice.hidden = false;
  els.notice.textContent = message;
}

function clearNotice() {
  els.notice.hidden = true;
  els.notice.textContent = '';
}

async function copyText(text, button) {
  const label = button.querySelector('span');
  const previous = label.textContent;
  try {
    await navigator.clipboard.writeText(text);
    label.textContent = 'Copied';
  } catch {
    label.textContent = 'Copy failed';
  }
  setTimeout(() => { label.textContent = previous; }, 1400);
}

function applyQueryState() {
  const requestedSeed = query.get('seed');
  const custom = query.get('custom') ? decodeParam(query.get('custom')) : null;
  if (custom) {
    seedText = custom;
    seedId = SEEDS.find(seed => seed.text === custom)?.id || 'custom';
  } else if (requestedSeed && (requestedSeed === CONTROL.id || SEEDS.some(seed => seed.id === requestedSeed))) {
    seedId = requestedSeed;
    seedText = SEEDS.find(seed => seed.id === requestedSeed)?.text || '';
  }
  els.seed.value = seedText;
  const requestedTask = query.get('task');
  if (requestedTask === CUSTOM_TASK_ID) {
    els.task.value = CUSTOM_TASK_ID;
    const typed = (query.get('q') && decodeParam(query.get('q'))) || storedTask();
    if (typed) els.taskCustom.value = typed;
  } else if (requestedTask && TASKS.some(task => task.id === requestedTask)) els.task.value = requestedTask;
  syncTaskUi();
  const requestedSelf = query.get('self');
  if (['code', 'seed', 'none'].includes(requestedSelf)) els.selfImage.querySelector(`input[value="${requestedSelf}"]`).checked = true;
  renderSeedBytes();
  renderSeedChips();
}

function syncQuery() {
  const params = new URLSearchParams();
  if (seedId === 'custom') {
    const encoded = encodeParam(seedText);
    if (encoded) params.set('custom', encoded);
  } else if (seedId !== 'champion-386') params.set('seed', seedId);
  if (els.task.value === CUSTOM_TASK_ID) {
    params.set('task', CUSTOM_TASK_ID);
    const encoded = encodeParam(els.taskCustom.value.trim());
    if (encoded) params.set('q', encoded);
  } else if (els.task.value !== TASKS[0].id) params.set('task', els.task.value);
  if (selfImageValue() !== 'code') params.set('self', selfImageValue());
  const search = params.toString();
  history.replaceState(null, '', `${location.pathname}${search ? `?${search}` : ''}`);
  renderFloor();
}

// Free text rides the URL as base64url so a link reproduces the exact sentence and task.
function encodeParam(text) {
  const bytes = new TextEncoder().encode(text);
  if (!bytes.length || bytes.length > PARAM_MAX) return null;
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeParam(value) {
  try {
    const text = new TextDecoder().decode(Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0)));
    return text.trim() && utf8Bytes(text) <= PARAM_MAX ? text : null;
  } catch {
    return null;
  }
}
