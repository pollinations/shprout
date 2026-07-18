import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const workshop = await readFile(new URL('../web/workshop.html', import.meta.url), 'utf8');
const workshopCss = await readFile(new URL('../web/workshop.css', import.meta.url), 'utf8');
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

test('development server exposes the index and workshop assets', () => {
  for (const path of [
    '/index.css',
    '/index.js',
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
