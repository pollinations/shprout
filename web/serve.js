#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.PORT || 8088);
const routes = new Map([
  ['/', { path: new URL('./index.html', import.meta.url), type: 'text/html; charset=utf-8' }],
  ['/index.html', { path: new URL('./index.html', import.meta.url), type: 'text/html; charset=utf-8' }],
  ['/shprout.txt', { path: new URL('../shprout', import.meta.url), type: 'text/plain; charset=utf-8' }],
]);

createServer(async (request, response) => {
  const route = routes.get(new URL(request.url, 'http://localhost').pathname);
  if (!route) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('not found');
    return;
  }

  try {
    response.writeHead(200, { 'Content-Type': route.type, 'Cache-Control': 'no-store' });
    response.end(await readFile(route.path));
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(String(error));
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
