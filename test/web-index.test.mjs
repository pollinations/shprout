import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildJustBashBundle } from '../web/vendor.js';
import { gunzipSync, gzipSync } from '../web/zlib-browser.js';

const index = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const indexJs = await readFile(new URL('../web/index.js', import.meta.url), 'utf8');
const workshop = await readFile(new URL('../web/workshop.html', import.meta.url), 'utf8');
const workshopJs = await readFile(new URL('../web/workshop.js', import.meta.url), 'utf8');
const workshopCss = await readFile(new URL('../web/workshop.css', import.meta.url), 'utf8');
const domprout = await readFile(new URL('../web/domprout.html', import.meta.url), 'utf8');
const domproutJs = await readFile(new URL('../web/domprout.js', import.meta.url), 'utf8');
const domproutCss = await readFile(new URL('../web/domprout.css', import.meta.url), 'utf8');
const server = await readFile(new URL('../web/serve.js', import.meta.url), 'utf8');

test('experiment index links every active surface and deterministic demo', () => {
  for (const path of [
    '/workshop.html',
    '/workshop.html?demo=1',
    '/domprout.html',
    '/domprout.html?demo=1',
  ]) {
    assert.match(index, new RegExp(`href="${path.replaceAll('?', '\\?')}"`));
  }
  assert.doesNotMatch(index, /<iframe/);
  assert.match(index, /body=.*jq -Rs/);
  assert.match(workshop, /href="\/" aria-label="All experiments"/);
});

test('application styles preserve the native hidden contract', () => {
  assert.match(workshopCss, /\[hidden\]\s*{\s*display:\s*none\s*!important;/);
  assert.match(domproutCss, /\[hidden\]\s*{\s*display:\s*none\s*!important;/);
});

test('authenticated pages execute dependencies from same-origin routes', () => {
  for (const source of [indexJs, workshopJs, domproutJs]) {
    assert.doesNotMatch(source, /(?:import|from)\s*['"]https?:\/\//);
  }
  assert.match(workshopJs, /from '\/vendor\/just-bash\.js'/);
  for (const page of [index, workshop, domprout]) {
    assert.match(page, /src="\/vendor\/lucide\.js"/);
  }
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
  ]) {
    assert.ok(server.includes(`['${path}'`), `missing route ${path}`);
  }
});
