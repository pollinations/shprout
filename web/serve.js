#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRoutes } from './routes.js';
import { buildJustBashBundle } from './vendor.js';

const port = Number(process.env.PORT || 8088);
const routes = createRoutes({ justBashBundle: await buildJustBashBundle() });

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
      ...(new URL(request.url, 'http://localhost').pathname === '/shell.html' ? {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      } : {}),
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
