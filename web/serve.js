#!/usr/bin/env node
// Tiny static server with COOP/COEP for SharedArrayBuffer (WebContainer requirement).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const PORT = process.env.PORT || 8088;
const ROOT = new URL('.', import.meta.url).pathname;
const SHPROUT = new URL('../shprout', import.meta.url).pathname;
const SHIM_AWK = new URL('./shims/awk', import.meta.url).pathname;
const SHIM_SED = new URL('./shims/sed', import.meta.url).pathname;

const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  if (req.url.startsWith('/index.html') || req.url === '/') {
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  }

  let path = req.url.split('?')[0];
  if (path === '/') path = '/index.html';

  try {
    const file = path === '/shprout.txt' ? SHPROUT
      : path === '/shims/awk' ? SHIM_AWK
      : path === '/shims/sed' ? SHIM_SED
      : join(ROOT, path);
    const body = await readFile(file);
    res.setHeader('Content-Type', types[extname(file)] || 'text/plain');
    res.end(body);
  } catch {
    res.statusCode = 404; res.end('not found');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
