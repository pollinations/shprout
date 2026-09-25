import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildJustBashBundle } from '../web/vendor.js';
import { createRoutes } from '../web/routes.js';
import { gunzipSync, gzipSync } from '../web/zlib-browser.js';

const index = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const indexJs = await readFile(new URL('../web/index.js', import.meta.url), 'utf8');
const workshop = await readFile(new URL('../web/workshop.html', import.meta.url), 'utf8');
const workshopJs = await readFile(new URL('../web/workshop.js', import.meta.url), 'utf8');
const workshopCss = await readFile(new URL('../web/workshop.css', import.meta.url), 'utf8');
const domprout = await readFile(new URL('../web/domprout.html', import.meta.url), 'utf8');
const domproutJs = await readFile(new URL('../web/domprout.js', import.meta.url), 'utf8');
const domproutCss = await readFile(new URL('../web/domprout.css', import.meta.url), 'utf8');
const server = await readFile(new URL('../web/routes.js', import.meta.url), 'utf8');
const seed = await readFile(new URL('../web/seed.html', import.meta.url), 'utf8');
const seedJs = await readFile(new URL('../web/seed.js', import.meta.url), 'utf8');
const seedCss = await readFile(new URL('../web/seed.css', import.meta.url), 'utf8');

test('the landing page is the terminal demo and the other approaches remain accessible', () => {
  const routes = createRoutes({ justBashBundle: '' });
  assert.equal(routes.get('/').path.pathname, routes.get('/seed.html').path.pathname);
  assert.equal(routes.get('/index.html').path.pathname, routes.get('/seed.html').path.pathname);
  assert.equal(routes.get('/experiments.html').path.pathname, new URL('../web/index.html', import.meta.url).pathname);
  assert.doesNotMatch(seed, /<iframe/);
});

test('experiment index links every active surface and deterministic demo', () => {
  for (const path of [
    '/workshop.html',
    '/workshop.html?demo=1',
    '/domprout.html',
    '/domprout.html?demo=1',
    '/seed.html',
  ]) {
    assert.match(index, new RegExp(`href="${path.replaceAll('?', '\\?')}"`));
  }
  assert.match(index, /4 active/);
  for (const page of [workshop, domprout]) assert.match(page, /href="\/seed\.html"/);
  assert.doesNotMatch(index, /<iframe/);
  assert.match(index, /body=.*jq -Rs/);
  assert.match(workshop, /href="\/" aria-label="All experiments"/);
});

test('application styles preserve the native hidden contract', () => {
  assert.match(workshopCss, /\[hidden\]\s*{\s*display:\s*none\s*!important;/);
  assert.match(domproutCss, /\[hidden\]\s*{\s*display:\s*none\s*!important;/);
  assert.match(seedCss, /\[hidden\]\s*{\s*display:\s*none\s*!important;/);
});

test('authenticated pages execute dependencies from same-origin routes', () => {
  for (const source of [indexJs, workshopJs, domproutJs, seedJs]) {
    assert.doesNotMatch(source, /(?:import|from)\s*['"]https?:\/\//);
  }
  assert.match(workshopJs, /from '\/vendor\/just-bash\.js'/);
  assert.match(seedJs, /from '\/vendor\/just-bash\.js'/);
  assert.doesNotMatch(seedJs, /pk_|Bearer /);
  for (const page of [index, workshop, domprout, seed]) {
    assert.match(page, /src="\/vendor\/lucide\.js"/);
  }
  for (const id of ['stage-seed', 'stage-run', 'transcript', 'hood', 'stage-code', 'stage-gate']) {
    assert.match(seed, new RegExp(`id="${id}"`), `seed.html lacks #${id}`);
  }
  for (const asset of ['/seed.css', '/seed.js']) assert.ok(seed.includes(`"${asset}"`), `seed.html lacks ${asset}`);
});

test('local just-bash browser bundle has no unresolved imports', async () => {
  const source = new TextDecoder().decode(await buildJustBashBundle());
  assert.doesNotMatch(source, /\b(?:from|import)\s*[(']*['"](?:node:|[a-z@])/);
});

test('browser zlib adapter round-trips data and enforces output limits', () => {
  const input = new TextEncoder().encode('shprout '.repeat(64));
  assert.deepEqual(gunzipSync(gzipSync(input)), input);
  assert.throws(
    () => gunzipSync(gzipSync(input), { maxOutputLength: input.length - 1 }),
    /decompressed data exceeds limit/,
  );
});

test('development server exposes the index and workshop assets', () => {
  for (const path of [
    '/index.css',
    '/index.js',
    '/vendor/lucide.js',
    '/vendor/just-bash.js',
    '/auth.js',
    '/workshop.html',
    '/workshop.css',
    '/workshop.js',
    '/domprout.css',
    '/domprout.js',
    '/seed.html',
    '/seed.css',
    '/seed.js',
    '/seed-runtime.js',
    '/samples/champion-386B.txt',
  ]) {
    assert.ok(server.includes(`['${path}'`), `missing route ${path}`);
  }
});
