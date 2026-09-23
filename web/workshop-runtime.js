export const POLLI_BASE = 'https://gen.pollinations.ai/v1';
export const POLLI_ENDPOINT = `${POLLI_BASE}/chat/completions`;
export const WORKSPACE_ROOT = '/home/user';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const previewPolicy = "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src data:; form-action 'none'; img-src data: blob:; media-src data: blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'";

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function parseModelResponse(response) {
  const text = String(response || '');
  const fence = text.match(/```[^\n]*\n([\s\S]*?)(?:\n```|$)/);
  return {
    thought: (fence ? text.slice(0, fence.index) : text).trim(),
    action: fence?.[1]?.trim() || '',
  };
}

export function preparePreview(source) {
  if (!source?.trim()) return '';
  const meta = `<meta http-equiv="Content-Security-Policy" content="${previewPolicy}">`;
  if (/<head(?:\s[^>]*)?>/i.test(source)) {
    return source.replace(/<head(\s[^>]*)?>/i, match => `${match}\n${meta}`);
  }
  if (/<html(?:\s[^>]*)?>/i.test(source)) {
    return source.replace(/<html(\s[^>]*)?>/i, match => `${match}\n<head>${meta}</head>`);
  }
  return `${meta}\n${source}`;
}

export function relativeWorkspacePath(path) {
  return path.startsWith(`${WORKSPACE_ROOT}/`) ? path.slice(WORKSPACE_ROOT.length + 1) : path;
}

export function isVisibleWorkspacePath(path) {
  if (!path.startsWith(`${WORKSPACE_ROOT}/`)) return false;
  const relative = relativeWorkspacePath(path);
  return relative !== 'shprout'
    && !relative.startsWith('approaches/')
    && relative !== '.shprout/.keep';
}

export function workspacePath(relative) {
  const clean = String(relative).replaceAll('\\', '/').replace(/^\/+/, '');
  if (!clean || clean.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid workspace path');
  }
  return `${WORKSPACE_ROOT}/${clean}`;
}

function completionContent(body) {
  try {
    return JSON.parse(body).choices?.[0]?.message?.content;
  } catch {
    return undefined;
  }
}

function assertRequest(url, options) {
  if (url !== POLLI_ENDPOINT) throw new Error(`Network denied: ${url}`);
  if ((options.method || 'GET').toUpperCase() !== 'POST') {
    throw new Error(`Method denied: ${options.method || 'GET'}`);
  }
}

export function createApiBridge({ apiKey, fetchImpl = globalThis.fetch, onEvent = () => {} }) {
  const controllers = new Set();

  const fetch = async (url, options = {}) => {
    assertRequest(url, options);
    const controller = new AbortController();
    controllers.add(controller);
    onEvent({ type: 'request' });

    try {
      const headers = new Headers({
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      });
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: options.body,
        redirect: 'error',
        signal: controller.signal,
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const body = decoder.decode(bytes);
      const content = completionContent(body);
      if (response.ok && typeof content !== 'string') {
        throw new Error('API response did not contain message content');
      }
      if (typeof content === 'string') onEvent({ type: 'response', content });
      if (!response.ok) onEvent({ type: 'error', message: `API ${response.status}: ${body}` });
      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers),
        body: bytes,
        url: response.url || url,
      };
    } catch (error) {
      if (error?.name !== 'AbortError' && !controller.signal.aborted) {
        onEvent({ type: 'error', message: `Request failed: ${error?.message || error}` });
      }
      throw error;
    } finally {
      controllers.delete(controller);
    }
  };

  return {
    fetch,
    abort() {
      for (const controller of controllers) controller.abort();
      controllers.clear();
    },
  };
}

const demoArtifact = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Signal Garden</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; }
    body { overflow: hidden; background: #121813; color: #f4f5df; font: 14px system-ui, sans-serif; }
    header { position: fixed; z-index: 2; inset: 0 0 auto; display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; }
    strong { font-size: 15px; letter-spacing: 0; }
    button { border: 1px solid #81936b; border-radius: 6px; padding: 8px 12px; background: #e7f29b; color: #1c2919; font: 700 12px inherit; cursor: pointer; }
    canvas { width: 100%; height: 100%; display: block; }
    footer { position: fixed; inset: auto 20px 18px; display: flex; justify-content: space-between; color: #a8b29e; font-size: 11px; }
  </style>
</head>
<body>
  <header><strong>signal garden</strong><button id="grow">grow a signal</button></header>
  <canvas id="garden" aria-label="Animated signal garden"></canvas>
  <footer><span>click anywhere to plant</span><span id="count">12 signals</span></footer>
  <script>
    const canvas = document.querySelector('#garden');
    const ctx = canvas.getContext('2d');
    const signals = [];
    let width = 0, height = 0, time = 0;
    const colors = ['#d8ef72', '#66c7a5', '#f4bd61', '#78a8e8'];
    function size() { width = canvas.width = innerWidth * devicePixelRatio; height = canvas.height = innerHeight * devicePixelRatio; }
    function plant(x = Math.random() * width, y = height * (.55 + Math.random() * .35)) {
      signals.push({ x, y, height: height * (.12 + Math.random() * .28), phase: Math.random() * 6, color: colors[signals.length % colors.length] });
      document.querySelector('#count').textContent = signals.length + ' signals';
    }
    function draw() {
      ctx.fillStyle = '#121813'; ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#263228'; ctx.lineWidth = devicePixelRatio;
      for (let x = 0; x < width; x += 42 * devicePixelRatio) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
      for (const signal of signals) {
        const sway = Math.sin(time + signal.phase) * 12 * devicePixelRatio;
        ctx.strokeStyle = signal.color; ctx.lineWidth = 2.5 * devicePixelRatio; ctx.beginPath();
        ctx.moveTo(signal.x, signal.y); ctx.quadraticCurveTo(signal.x + sway, signal.y - signal.height * .5, signal.x + sway * .4, signal.y - signal.height); ctx.stroke();
        ctx.fillStyle = signal.color; ctx.beginPath(); ctx.arc(signal.x + sway * .4, signal.y - signal.height, (4 + Math.sin(time * 2 + signal.phase) * 2) * devicePixelRatio, 0, Math.PI * 2); ctx.fill();
      }
      time += .012; requestAnimationFrame(draw);
    }
    addEventListener('resize', size); size();
    for (let i = 0; i < 12; i++) plant();
    document.querySelector('#grow').onclick = () => plant();
    canvas.onclick = event => plant(event.clientX * devicePixelRatio, event.clientY * devicePixelRatio);
    draw();
  </script>
</body>
</html>`;

const demoResponses = [
  `I will give the run a durable goal, then build a self-contained artifact.\n\`\`\`bash\nmkdir -p .shprout\ncat > .shprout/GOAL.md <<'GOAL'\nBuild and verify a playful interactive signal garden.\nGOAL\ncat > index.html <<'HTML'\n${demoArtifact}\nHTML\nprintf 'created index.html\\n'\n\`\`\``,
  `The artifact exists. I will verify its title, canvas, and interaction, then leave a compact recent note.\n\`\`\`bash\ngrep -q 'Signal Garden' index.html && grep -q '<canvas' index.html && grep -q 'canvas.onclick' index.html\nprintf 'index.html verified: title, canvas, and interaction.\\n' > .shprout/RECENT.md\nwc -c index.html\n\`\`\``,
  'The signal garden is built, interactive, and verified. The goal and recent state are available for the next run.',
];

export function createDemoBridge({ onEvent = () => {}, delayMs = 280 } = {}) {
  let turn = 0;
  let stopped = false;

  return {
    async fetch(url, options = {}) {
      assertRequest(url, options);
      if (stopped) throw new DOMException('Stopped', 'AbortError');
      onEvent({ type: 'request' });
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      if (stopped) throw new DOMException('Stopped', 'AbortError');
      const content = demoResponses[turn++];
      if (content === undefined) throw new Error('Demo exhausted its model responses');
      onEvent({ type: 'response', content });
      const body = encoder.encode(JSON.stringify({ choices: [{ message: { content } }] }));
      return {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body,
        url,
      };
    },
    abort() { stopped = true; },
    reset() { turn = 0; stopped = false; },
  };
}
