// This function is serialized into an opaque-origin iframe; no credentials enter it.
export function installReplSandbox(channel) {
  const stage = document.getElementById('stage');
  const state = Object.create(null);
  const AsyncFunction = (async () => {}).constructor;
  const send = parent.postMessage.bind(parent);
  const warnings = [];
  const clip = (text, max = 6000) => text.length > max ? text.slice(0, max) + '\n[truncated]' : text;
  const format = value => {
    if (typeof value === 'string') return clip(value);
    if (value === undefined) return 'undefined';
    try {
      const seen = new WeakSet();
      return clip(JSON.stringify(value, (_key, item) => {
        if (typeof item === 'function') return '[Function]';
        if (typeof item === 'bigint') return String(item) + 'n';
        if (item instanceof Element) return item.outerHTML.slice(0, 500);
        if (item && typeof item === 'object') {
          if (seen.has(item)) return '[Circular]';
          seen.add(item);
        }
        return item;
      }) ?? String(value));
    } catch { return '[Unserializable]'; }
  };
  const warn = error => { warnings.push(clip(String(error), 1000)); if (warnings.length > 10) warnings.shift(); };
  addEventListener('error', event => warn(event.message));
  addEventListener('unhandledrejection', event => warn(event.reason));
  addEventListener('message', async event => {
    if (event.source !== parent || event.data?.channel !== channel || event.data.type !== 'request') return;
    const { id, method, code } = event.data;
    try {
      let result;
      if (method === 'inspect') {
        result = { dom: clip(stage.outerHTML, 16000), state: format(state), errors: warnings.splice(0) };
      } else if (method === 'execute') {
        const logs = [];
        const log = prefix => (...args) => { if (logs.length < 80) logs.push(prefix + args.map(format).join(' ')); };
        const console = { log: log(''), info: log(''), warn: log('Warning: '), error: log('Error: ') };
        try {
          const fn = new AsyncFunction('stage', 'state', 'console', String(code));
          const value = await fn(stage, state, console);
          result = { output: clip(logs.join('\n')), value: format(value), error: null };
        } catch (error) {
          result = { output: clip(logs.join('\n')), value: 'undefined', error: clip(error.stack || String(error)) };
        }
      } else throw new Error('Unknown REPL operation');
      send({ channel, type: 'response', id, result }, '*');
    } catch (error) {
      send({ channel, type: 'response', id, error: String(error) }, '*');
    }
  });
  send({ channel, type: 'ready' }, '*');
}
