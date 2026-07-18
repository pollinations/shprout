#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { buildJustBashBundle } from './vendor.js';

const port = Number(process.env.PORT || 8088);
const justBashBundle = await buildJustBashBundle();
const routes = new Map([
  ['/', { path: new URL('./index.html', import.meta.url), type: 'text/html; charset=utf-8' }],
  ['/index.html', { path: new URL('./index.html', import.meta.url), type: 'text/html; charset=utf-8' }],
  ['/index.css', { path: new URL('./index.css', import.meta.url), type: 'text/css; charset=utf-8' }],
  ['/index.js', { path: new URL('./index.js', import.meta.url), type: 'text/javascript; charset=utf-8' }],
  ['/vendor/lucide.js', { path: new URL('../node_modules/lucide/dist/umd/lucide.min.js', import.meta.url), type: 'text/javascript; charset=utf-8' }],
  ['/vendor/just-bash.js', { body: justBashBundle, type: 'text/javascript; charset=utf-8' }],
  ['/workshop.html', { path: new URL('./workshop.html', import.meta.url), type: 'text/html; charset=utf-8' }],
  ['/workshop.css', { path: new URL('./workshop.css', import.meta.url), type: 'text/css; charset=utf-8' }],
  ['/workshop.js', { path: new URL('./workshop.js', import.meta.url), type: 'text/javascript; charset=utf-8' }],
  ['/workshop-runtime.js', { path: new URL('./workshop-runtime.js', import.meta.url), type: 'text/javascript; charset=utf-8' }],
  ['/auth.js', { path: new URL('./auth.js', import.meta.url), type: 'text/javascript; charset=utf-8' }],
  ['/domprout.html', { path: new URL('./domprout.html', import.meta.url), type: 'text/html; charset=utf-8' }],
  ['/domprout.css', { path: new URL('./domprout.css', import.meta.url), type: 'text/css; charset=utf-8' }],
  ['/domprout.js', { path: new URL('./domprout.js', import.meta.url), type: 'text/javascript; charset=utf-8' }],
  ['/dom-agent.js', { path: new URL('./dom-agent.js', import.meta.url), type: 'text/javascript; charset=utf-8' }],
  ['/dom-engine.js', { path: new URL('./dom-engine.js', import.meta.url), type: 'text/javascript; charset=utf-8' }],
  ['/dom-sandbox.js', { path: new URL('./dom-sandbox.js', import.meta.url), type: 'text/javascript; charset=utf-8' }],
  ['/shprout.txt', { path: new URL('../shprout', import.meta.url), type: 'text/plain; charset=utf-8' }],
  ['/approaches/classic.txt', { path: new URL('../approaches/classic', import.meta.url), type: 'text/plain; charset=utf-8' }],
  ['/approaches/syscap.txt', { path: new URL('../approaches/syscap', import.meta.url), type: 'text/plain; charset=utf-8' }],
  ['/approaches/self-mod.txt', { path: new URL('../approaches/self-mod', import.meta.url), type: 'text/plain; charset=utf-8' }],
]);

createServer(async (request, response) => {
  const route = routes.get(new URL(request.url, 'http://localhost').pathname);
  if (!route) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('not found');
    return;
  }

  try {
    response.writeHead(200, {
      'Content-Type': route.type,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(route.body ?? await readFile(route.path));
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(String(error));
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
