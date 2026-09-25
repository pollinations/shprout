import { shellQuote, POLLI_ENDPOINT } from './workshop-runtime.js';
import { consoleProtocol } from './shell-protocol.js';

export async function createLinuxShell({ terminal, source, model = 'claude-large', complete, status, ready }) {
  if (!crossOriginIsolated) throw new Error('Browser Linux needs COOP/COEP response headers. Use npm run dev.');
  status('Loading GNU Bash in WebAssembly…');
  const C = await import('https://cxrtnc.leaningtech.com/1.2.8/cx.esm.js');
  const remote = await C.CloudDevice.create('wss://disks.webvm.io/debian_large_20230522_5044875331.ext2');
  const disk = await C.OverlayDevice.create(remote, await C.IDBDevice.create('shprout-linux-v2'));
  const data = await C.DataDevice.create();
  const cx = await C.Linux.create({ mounts: [
    { type: 'ext2', path: '/', dev: disk }, { type: 'dir', path: '/data', dev: data },
    { type: 'devs', path: '/dev' }, { type: 'proc', path: '/proc' },
  ] });
  const nonce = crypto.randomUUID();
  const decoder = new TextDecoder();
  let requests = 0, pending = null, booted = false, firstReady, sourceDirty = false, sourcePath = '/data/shprout';
  const shellReady = new Promise(resolve => { firstReady = resolve; });
  const dispatch = async payload => {
    if (payload === 'ready') {
      if (!booted) return;
      firstReady(); ready(); pending?.resolve(); pending = null; return;
    }
    let request;
    try {
      request = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), c => c.charCodeAt(0))));
      if (!/^[a-f0-9]{32}$/.test(request.id) || typeof request.body !== 'string') throw new Error('Invalid VM request');
      let response;
      if (++requests > 20) response = { status: 429, body: '{"error":"20-call cap reached"}' };
      else {
        status(`Agent is thinking · call ${requests}`);
        const result = await complete(POLLI_ENDPOINT, { method: 'POST', body: request.body });
        response = { status: result.status, body: new TextDecoder().decode(result.body) };
      }
      await data.writeFile('/reply-' + request.id, JSON.stringify(response));
    } catch (error) {
      status(error.message);
      if (request?.id && /^[a-f0-9]{32}$/.test(request.id)) await data.writeFile('/reply-' + request.id, JSON.stringify({ status: 502, body: '{}' }));
    }
  };
  const consume = consoleProtocol({ nonce, output: text => terminal.write(text), message: payload => { void dispatch(payload); } });
  let send = cx.setCustomConsole(bytes => consume(decoder.decode(bytes, { stream: true })), terminal.cols, terminal.rows);
  const assets = await Promise.all(['/linux/jq-linux-i386', '/linux/curl-bridge.py'].map(async path => {
    const r = await fetch(path); if (!r.ok) throw new Error(`Missing runtime asset: ${path}`); return new Uint8Array(await r.arrayBuffer());
  }));
  await data.writeFile('/jq', assets[0]);
  await data.writeFile('/curl', assets[1]);
  await data.writeFile('/shprout', source);
  await data.writeFile('/rc', `export PS1='\\[\\e[32m\\]shprout\\[\\e[0m\\]:\\w $ '\nexport PROMPT_COMMAND='printf "\\033]777;shprout;${nonce};ready\\007"'\n`);
  const env = ['HOME=/home/user', 'USER=user', 'PATH=/home/user/bin:/usr/local/bin:/usr/bin:/bin', 'TERM=xterm-256color',
    'LANG=C.UTF-8', 'OPENAI_API_KEY=managed-by-browser', 'OPENAI_BASE_URL=https://gen.pollinations.ai/v1',
    `MODEL=${model}`, `SHPROUT_BRIDGE=${nonce}`,
    'SHPROUT_RUNTIME=GNU Bash on Debian x86 in browser WebAssembly; real Linux programs, persistent files, Python, native jq. Output is a terminal. curl is a Pollinations-only browser transport; no general internet; /dev/fd process substitution is unsupported in this VM, use files or ordinary pipes.'];
  const installed = await cx.run('/bin/bash', ['-c', 'set -e; mkdir -p /home/user/bin /home/user/.shprout; cp -f /data/jq /home/user/bin/jq; cp -f /data/curl /home/user/bin/curl; cp -f /data/shprout /home/user/shprout; chmod 755 /home/user/bin/* /home/user/shprout; chown 1000:1000 /home/user; chown -R 1000:1000 /home/user/bin /home/user/.shprout /home/user/shprout; jq --version; echo "GNU Bash $BASH_VERSION · inside this browser"'], { env, cwd: '/home/user', uid: 0, gid: 0 });
  if (installed.status !== 0) throw new Error('Linux tools could not be installed');
  booted = true;
  cx.run('/bin/bash', ['--noprofile', '--rcfile', '/data/rc', '-i'], { env, cwd: '/home/user', uid: 1000, gid: 1000 })
    .then(() => { status('Shell exited. Reload to start another.'); pending?.reject(new Error('Shell exited')); })
    .catch(error => { status(error.message); pending?.reject(error); });
  await shellReady;
  // The VM console reads bytes: send UTF-8, not code points, or non-ASCII input stalls the line.
  const encoder = new TextEncoder();
  const input = text => { for (const byte of encoder.encode(text)) send(byte); };
  return {
    input(text) { if (!pending && /[\r\n]/.test(text)) requests = 0; input(text); },
    async setSource(text) {
      const file = '/shprout-' + crypto.randomUUID();
      await data.writeFile(file, text); sourcePath = '/data' + file; sourceDirty = true;
    },
    run(task, { model: selectedModel = model } = {}) {
      if (pending) return Promise.reject(new Error('An agent task is already running'));
      return new Promise((resolve, reject) => {
        requests = 0;
        pending = { resolve, reject };
        const install = sourceDirty ? `cp -f ${shellQuote(sourcePath)} ~/shprout && chmod u+wx ~/shprout && ` : '';
        sourceDirty = false;
        input(`${install}MODEL=${shellQuote(selectedModel)} bash ~/shprout ${shellQuote(task)}\r`);
      });
    },
    resize() { send = cx.setCustomConsole(bytes => consume(decoder.decode(bytes, { stream: true })), terminal.cols, terminal.rows); },
    stop() { input('\x03'); },
  };
}
