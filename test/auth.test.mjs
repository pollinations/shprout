import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KEY_STORE,
  STATE_STORE,
  clearAuthSession,
  consumeAuthCallback,
  createAuthorizationUrl,
} from '../web/auth.js';

const storage = entries => {
  const values = new Map(entries);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
};

test('authorization URLs carry the callback and a stored state, and no app key', () => {
  const session = storage();
  const url = new URL(createAuthorizationUrl({
    redirectUrl: 'http://localhost:8088/seed.html?task=arith',
    session,
    state: 'known-state',
  }));

  assert.equal(url.origin + url.pathname, 'https://enter.pollinations.ai/authorize');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:8088/seed.html?task=arith');
  assert.equal(url.searchParams.get('state'), 'known-state');
  assert.equal(url.searchParams.has('client_id'), false);
  assert.equal(url.searchParams.has('app_key'), false);
  assert.equal(session.getItem(STATE_STORE), 'known-state');
});

test('a matching callback stores the API key and cleans the auth fragment', () => {
  const session = storage([[STATE_STORE, 'known-state']]);
  const result = consumeAuthCallback({
    location: {
      hash: '#api_key=sk_example&state=known-state',
      pathname: '/seed.html',
      search: '?task=arith',
    },
    session,
    legacy: storage(),
  });

  assert.deepEqual(result, {
    apiKey: 'sk_example',
    cleanedUrl: '/seed.html?task=arith',
    error: null,
  });
  assert.equal(session.getItem(KEY_STORE), 'sk_example');
  assert.equal(session.getItem(STATE_STORE), null);
});

test('a planted callback cannot replace the browser session key', () => {
  const session = storage([
    [STATE_STORE, 'real-state'],
    [KEY_STORE, 'sk_existing'],
  ]);
  const result = consumeAuthCallback({
    location: {
      hash: '#api_key=sk_attacker&state=wrong-state',
      pathname: '/domprout.html',
      search: '',
    },
    session,
    legacy: storage(),
  });

  assert.equal(result.apiKey, 'sk_existing');
  assert.match(result.error, /invalid state/i);
  assert.equal(session.getItem(STATE_STORE), 'real-state');
});

test('a denial is reported and a legacy localStorage key is moved into the session', () => {
  const session = storage([[STATE_STORE, 'known-state']]);
  const denied = consumeAuthCallback({
    location: { hash: '#error=access_denied&state=known-state', pathname: '/workshop.html', search: '' },
    session,
    legacy: storage(),
  });
  assert.equal(denied.apiKey, null);
  assert.equal(denied.error, 'access_denied');
  assert.equal(denied.cleanedUrl, '/workshop.html');

  const legacy = storage([[KEY_STORE, 'sk_legacy']]);
  const migrated = consumeAuthCallback({ location: { hash: '', pathname: '/workshop.html', search: '' }, session, legacy });
  assert.equal(migrated.apiKey, 'sk_legacy');
  assert.equal(legacy.getItem(KEY_STORE), null);

  clearAuthSession(session);
  assert.equal(session.getItem(KEY_STORE), null);
});
