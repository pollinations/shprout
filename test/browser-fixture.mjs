// Manual browser integration fixture, deliberately absent from production routes.
// Run: node test/browser-fixture.mjs, then open http://127.0.0.1:8089
// for Bash, or /repl.html for persistent DOM cells. PORT overrides the test port.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRoutes } from '../web/routes.js';
import { buildJustBashBundle } from '../web/vendor.js';

const champion = await readFile(new URL('../research/compression/samples/champion-386B.sh', import.meta.url), 'utf8');
const routes = createRoutes({ justBashBundle: await buildJustBashBundle() });
const action = 'printf "source -> model -> bash -> output\\n"; wc -c < "$0"';
function install(source, action) {
  sessionStorage.setItem('shprout.apiKey', 'sk_browser_integration_fixture');
  const realFetch = window.fetch.bind(window);
  let turns = 0;
  let replTurns = 0;
  window.fetch = async (url, options) => {
    if (String(url) !== 'https://gen.pollinations.ai/v1/chat/completions') return realFetch(url, options);
    const body = JSON.parse(options.body);
    let content;
    if (/^\/repl(?:-(console|canvas|notebook))?\.html$/.test(location.pathname)) {
      const cells = [
        `state.count = 0; stage.innerHTML = '<h1>Persistent counter</h1><button>Water</button><output>0</output>'; state.inc = (n = 1) => { state.count += n; stage.querySelector('output').textContent = state.count; }; stage.querySelector('button').onclick = () => state.inc(); console.log('created');`,
        `missingFixtureFunction();`,
        `stage.style.background = '#dcebe1'; let isolated = false; try { parent.document.body; } catch { isolated = true; } console.log('persistent function:', typeof state.inc, 'parent blocked:', isolated);`,
        null,
        `state.inc(10); console.log('new count:', state.count);`,
        null,
      ];
      const cell = cells[replTurns++];
      content = cell ? '```js\n' + cell + '\n```' : 'done';
    } else if (location.pathname === '/shell.html' && !('temperature' in body)) {
      const prompt = body.messages.map(m => m.content).join('\n');
      let report = document.getElementById('fixture-report');
      if (!report) { report = document.createElement('p'); report.id = 'fixture-report'; document.body.prepend(report); }
      report.textContent = 'Fixture: source included=' + (prompt.includes('<you>#!/bin/bash') || prompt.includes(document.getElementById('source').value.trim())) + '; computed history=' + prompt.includes('computed:42');
      content = ++turns % 2 === 1 ? '```bash\nprintf \'computed:%s\\n\' \"$((6*7))\"; python3 -c \"print(7*8)\"; cat <(printf \'process substitution works\\n\'); printf \'{\"n\":3}\' | jq \'.n+4\'\n```' : 'exit';
    } else if ('temperature' in body) {
      turns = 0;
      await new Promise(resolve => setTimeout(resolve, 2000));
      content = '```bash\n' + source + '```';
    } else content = ++turns % 2 === 1 ? action : 'exit';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
}

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/fixture-init.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(`(${install.toString()})(${JSON.stringify(champion)}, ${JSON.stringify(action)});`);
    }
    const route = routes.get(path);
    if (!route) { res.writeHead(404); return res.end(); }
    let body = route.body ?? await readFile(route.path);
    if (route.type.startsWith('text/html')) {
      body = body.toString().replace(/<body[^>]*>/, '$&<p role="note">Integration test: scripted model replies; real execution.</p><script src="/fixture-init.js"></script>');
    }
    res.setHeader('Content-Type', route.type);
    res.setHeader('Cache-Control', 'no-store');
    if (path === '/shell.html') { res.setHeader('Cross-Origin-Opener-Policy','same-origin'); res.setHeader('Cross-Origin-Embedder-Policy','require-corp'); }
    res.end(body);
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
const port = Number(process.env.PORT || 8089);
server.listen(port, '127.0.0.1', () => console.log(`Browser fixture: http://127.0.0.1:${port} (expires in 8 minutes)`));
setTimeout(() => { server.close(); server.closeAllConnections(); }, 8 * 60 * 1000).unref();
