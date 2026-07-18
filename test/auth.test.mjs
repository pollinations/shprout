import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KEY_STORE,
  STATE_STORE,
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

test('authorization URLs include the registered callback and a stored state', () => {
  const session = storage();
  const url = new URL(createAuthorizationUrl({
    redirectUrl: 'http://localhost:8088/workshop.html',
    session,
    state: 'known-state',
  }));

  assert.equal(url.origin + url.pathname, 'https://enter.pollinations.ai/authorize');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:8088/workshop.html');
  assert.match(url.searchParams.get('client_id'), /^pk_/);
  assert.equal(url.searchParams.get('state'), 'known-state');
  assert.equal(session.getItem(STATE_STORE), 'known-state');
});

test('a matching callback stores the API key and cleans the auth fragment', () => {
  const session = storage([[STATE_STORE, 'known-state']]);
  const result = consumeAuthCallback({
    location: {
      hash: '#api_key=sk_example&state=known-state',
      pathname: '/workshop.html',
      search: '?mode=test',
    },
    session,
    legacy: storage(),
  });

  assert.deepEqual(result, {
    apiKey: 'sk_example',
    cleanedUrl: '/workshop.html?mode=test',
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
