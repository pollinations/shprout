import { runDomAgent } from './dom-engine.js';

const CHANNEL = 'domprout-runtime-v1';
const API_BASE = 'https://gen.pollinations.ai/v1';

const delay = (ms, signal) => {
  if (signal?.aborted) {
    return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
};

const sandboxDocument = source => {
  const script = source.replaceAll('</script', '<\\/script');
  return `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; form-action 'none'">
<style>
  * { box-sizing: border-box; }
  html, body, #stage { margin: 0; width: 100%; min-height: 100%; }
  body { overflow: auto; font-family: system-ui, sans-serif; }
  #stage { position: relative; }
</style>
<main id="stage"></main>
<script>${script}<\/script>`;
};

async function createRuntime(iframe, sandboxSource, signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
  let sequence = 0;
  let closed = false;
  const pending = new Map();
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const rejectPending = reason => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(reason);
    }
    pending.clear();
  };

  const onMessage = event => {
    if (event.source !== iframe.contentWindow || event.data?.channel !== CHANNEL) return;
    if (event.data.type === 'ready') {
      readyResolve();
      return;
    }
    if (event.data.type !== 'response') return;
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    clearTimeout(entry.timer);
    if (event.data.ok) entry.resolve(event.data.result);
    else entry.reject(new Error(event.data.result));
  };

  addEventListener('message', onMessage);
  const onAbort = () => {
    const error = signal.reason || new DOMException('Aborted', 'AbortError');
    readyReject(error);
    rejectPending(error);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  iframe.srcdoc = sandboxDocument(sandboxSource);

  const readyTimer = setTimeout(() => readyReject(new Error('DOM sandbox did not become ready')), 10000);
  try {
    await ready;
  } catch (error) {
    removeEventListener('message', onMessage);
    signal?.removeEventListener('abort', onAbort);
    rejectPending(error);
    throw error;
  } finally {
    clearTimeout(readyTimer);
  }

  const request = (method, payload) => {
    if (closed) return Promise.reject(new Error('DOM sandbox is closed'));
    if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`DOM sandbox ${method} timed out`));
      }, 30000);
      pending.set(id, { resolve, reject, timer });
      iframe.contentWindow.postMessage({ channel: CHANNEL, type: 'request', id, method, payload }, '*');
    });
  };

  return {
    snapshot: handle => request('snapshot', { handle }),
    execute: (handle, code) => request('execute', { handle, code }),
    resolve: (handle, specs, paths) => request('resolve', { handle, specs, paths }),
    destroy() {
      closed = true;
      removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      rejectPending(new Error('DOM sandbox closed'));
    },
  };
}

const completeWithPollinations = key => async ({ model, messages, signal }) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const timeout = AbortSignal.timeout(120000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: requestSignal,
      body: JSON.stringify({ model, messages, stop: ['```\n'] }),
    });
    const raw = await response.text();
    let body;
    try { body = JSON.parse(raw); }
    catch { throw new Error(`model HTTP ${response.status}: ${raw.slice(0, 200)}`); }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await delay(1000 * (attempt + 1), signal);
      continue;
    }
    if (!response.ok) {
      throw new Error(body?.error?.message || `model HTTP ${response.status}`);
    }
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('model response did not contain message content');
    return content;
  }
  throw new Error('model retries exhausted');
};

export const completeDomproutDemo = async ({ path }) => {
  const actions = {
    '0': `stage.innerHTML = \`
      <style>
        .demo { min-height: 100vh; padding: 32px; background: #f6f7f9; color: #18181b; font-family: system-ui, sans-serif; }
        .demo h1 { margin: 0 0 8px; font-size: 30px; }
        .demo > p { margin: 0 0 24px; color: #62646a; }
        .panels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
        article { min-height: 180px; padding: 20px; border: 1px solid #d8dbe2; border-radius: 8px; background: white; }
        article h2 { margin: 0 0 12px; font-size: 18px; }
        @media (max-width: 600px) { .panels { grid-template-columns: 1fr; } }
      </style>
      <section class="demo">
        <h1>Parallel DOM work</h1>
        <p>Each panel is assigned to a separate recursive branch.</p>
        <div class="panels"><article id="left"></article><article id="right"></article></div>
      </section>\`;
      return [
        { task: 'Build the planning panel, then delegate its detail.', target: '#left' },
        { task: 'Build the verification panel.', target: '#right' }
      ];`,
    '0.0': `stage.innerHTML = '<h2>Plan</h2><div class="detail">Delegating this subtree...</div>';
      stage.style.borderTop = '4px solid #3977e8';
      return [{ task: 'Finish this delegated detail.', target: '.detail' }];`,
    '0.0.0': `stage.innerHTML = '<strong>Nested branch complete</strong><p>The child worked only inside the assigned detail node.</p>';
      return [];`,
    '0.1': `stage.innerHTML = '<h2>Verify</h2><p>Sibling branches ran concurrently on non-overlapping targets.</p><output>Runtime bridge OK</output>';
      stage.style.borderTop = '4px solid #16805c';
      return [];`,
  };
  const code = actions[path] || 'return [];';
  return `\`\`\`js\n${code}\n\`\`\``;
};

const fetchText = async path => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`failed to load ${path}: HTTP ${response.status}`);
  return response.text();
};

export async function runDomprout({ iframe, task, model, key, complete, onEvent, maxSteps = 24, signal }) {
  const [engineSource, sandboxSource] = await Promise.all([
    fetchText('/dom-engine.js'),
    fetchText('/dom-sandbox.js'),
  ]);
  const runtime = await createRuntime(iframe, sandboxSource, signal);
  try {
    return await runDomAgent({
      task,
      model,
      complete: complete || completeWithPollinations(key),
      runtime,
      source: `<engine>\n${engineSource}\n</engine>\n<sandbox>\n${sandboxSource}\n</sandbox>`,
      onEvent,
      maxSteps,
      signal,
    });
  } finally {
    runtime.destroy();
  }
}
