#!/usr/bin/env node
// Static export: writes every served route into dist/ so the site can be hosted
// on GitHub Pages or any static host (the OAuth redirect must match that origin).
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRoutes } from './routes.js';
import { buildJustBashBundle } from './vendor.js';

const repo = fileURLToPath(new URL('..', import.meta.url));

// The output directory is deleted first, so refuse anything that could hold
// other work: the filesystem root, home, the repository or one of its parents,
// and any existing directory that is not a previous build.
export function assertSafeOutDir(outDir) {
  const target = resolve(outDir);
  const containsTarget = dir => { const rel = relative(target, dir); return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/')); };
  if (target === resolve('/') || containsTarget(homedir()) || containsTarget(repo)) {
    throw new Error(`Refusing to build into ${target}: it contains the home directory or this repository`);
  }
  if (existsSync(target) && !existsSync(join(target, '.nojekyll'))) {
    throw new Error(`Refusing to replace ${target}: it exists and is not a previous build (no .nojekyll)`);
  }
  return target;
}

export async function buildSite(outDir) {
  outDir = assertSafeOutDir(outDir);
  const routes = createRoutes({ justBashBundle: await buildJustBashBundle() });
  await rm(outDir, { recursive: true, force: true });
  const written = [];
  for (const [route, entry] of routes) {
    const relative = route === '/' ? '/index.html' : route;
    const target = join(outDir, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.body ?? await readFile(entry.path));
    written.push(relative);
  }
  await writeFile(join(outDir, '.nojekyll'), '');
  return written;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outDir = process.argv[2] || new URL('../dist', import.meta.url).pathname;
  const written = await buildSite(outDir);
  console.log(`${written.length} files -> ${outDir}`);
}
