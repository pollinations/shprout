import { installReplSandbox } from './repl-sandbox.js';

export const REPL_POLICY = "default-src 'none'; base-uri 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; form-action 'none'";

export async function createReplRuntime(iframe, { signal, timeoutMs = 10000 } = {}) {
  signal?.throwIfAborted();
  const channel = `shprout-repl-${crypto.randomUUID()}`;
  const pending = new Map();
  let sequence = 0;
  let closed = false;
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const cleanup = (reason = new Error('REPL reset')) => {
    if (closed) return;
    closed = true;
    clearTimeout(readyTimer);
    removeEventListener('message', receive);
    signal?.removeEventListener('abort', abort);
    readyReject(reason);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(reason); }
    pending.clear();
    iframe.srcdoc = '';
  };
  const abort = () => cleanup(signal.reason ?? new DOMException('Stopped', 'AbortError'));
  const receive = event => {
    if (event.source !== iframe.contentWindow || event.data?.channel !== channel) return;
    if (event.data.type === 'ready') { clearTimeout(readyTimer); readyResolve(); return; }
    if (event.data.type !== 'response') return;
    const item = pending.get(event.data.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(event.data.id);
    if (event.data.error) item.reject(new Error(event.data.error));
    else item.resolve(event.data.result);
  };
  const readyTimer = setTimeout(() => cleanup(new Error('The REPL did not start. Try resetting it.')), timeoutMs);
  addEventListener('message', receive);
  signal?.addEventListener('abort', abort, { once: true });
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('csp', REPL_POLICY);
  const script = `(${installReplSandbox.toString()})(${JSON.stringify(channel)})`.replace(/<\/script/gi, '<\\/script');
  iframe.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${REPL_POLICY}"><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:system-ui,sans-serif}#stage{min-height:100vh;padding:24px}</style><main id="stage"></main><script>${script}<\/script>`;
  await ready;
  return {
    get closed() { return closed; },
    inspect: () => request('inspect'),
    execute: code => request('execute', code),
    destroy: cleanup,
  };
  function request(method, code) {
    if (closed) return Promise.reject(new Error('The REPL was reset. Start another task.'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => cleanup(new Error(`REPL ${method} timed out; its state was reset.`)), timeoutMs);
      pending.set(id, { resolve, reject, timer });
      iframe.contentWindow.postMessage({ channel, type: 'request', id, method, code }, '*');
    });
  }
}
