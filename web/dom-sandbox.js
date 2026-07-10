// Injected into an opaque-origin, script-only iframe. The parent owns model
// access and credentials; this runtime owns only the visible DOM workspace.
(() => {
  const channel = 'domprout-runtime-v1';
  const AsyncFunction = (async () => {}).constructor;
  const handles = new Map();

  const format = value => {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); }
    catch { return String(value); }
  };

  const element = handle => {
    const value = handles.get(handle);
    if (!value || !value.isConnected) throw new Error(`stale or unknown stage: ${handle}`);
    return value;
  };

  const snapshot = handle => element(handle).outerHTML;

  const execute = async (handle, code) => {
    const logs = [];
    const cap = prefix => (...values) => logs.push(prefix + values.map(format).join(' '));
    const console = { log: cap(''), warn: cap('? '), error: cap('!! ') };
    const blocked = () => { throw new Error('network is disabled inside the DOM sandbox'); };
    try {
      const fn = new AsyncFunction('stage', 'console', 'fetch', 'XMLHttpRequest', 'WebSocket', code);
      const value = await fn(element(handle), console, blocked, blocked, blocked);
      try { structuredClone(value); }
      catch { throw new Error('return value is not cloneable; use {task, target} with selector strings'); }
      return { output: logs.join('\n') || '(no output)', value, error: null };
    } catch (error) {
      return { output: logs.join('\n'), value: null, error: error.stack || error.message || String(error) };
    }
  };

  const resolve = (parentHandle, specs, paths) => {
    const parentStage = element(parentHandle);
    const targets = specs.map((spec, index) => {
      if (!spec.target) return parentStage;
      let matches;
      try { matches = [...parentStage.querySelectorAll(spec.target)]; }
      catch (error) { throw new Error(`child ${index} selector is invalid: ${error.message}`); }
      if (matches.length !== 1) {
        throw new Error(`child ${index} selector ${JSON.stringify(spec.target)} matched ${matches.length} elements`);
      }
      return matches[0];
    });

    if (targets.length > 1) {
      for (let a = 0; a < targets.length; a += 1) {
        for (let b = a + 1; b < targets.length; b += 1) {
          if (targets[a] === targets[b] || targets[a].contains(targets[b]) || targets[b].contains(targets[a])) {
            throw new Error(`children ${a} and ${b} target overlapping subtrees`);
          }
        }
      }
    }

    targets.forEach((target, index) => handles.set(paths[index], target));
    return paths;
  };

  const respond = (id, ok, result) => parent.postMessage({ channel, type: 'response', id, ok, result }, '*');

  const boot = () => {
    handles.set('0', document.getElementById('stage'));
    addEventListener('message', async event => {
      if (event.source !== parent || event.data?.channel !== channel || event.data.type !== 'request') return;
      const { id, method, payload = {} } = event.data;
      try {
        let result;
        if (method === 'snapshot') result = snapshot(payload.handle);
        else if (method === 'execute') result = await execute(payload.handle, payload.code);
        else if (method === 'resolve') result = resolve(payload.handle, payload.specs, payload.paths);
        else throw new Error(`unknown runtime method: ${method}`);
        respond(id, true, result);
      } catch (error) {
        respond(id, false, error.stack || error.message || String(error));
      }
    });
    parent.postMessage({ channel, type: 'ready' }, '*');
  };

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
