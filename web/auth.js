// Pollinations BYOP fragment flow without a registered app: the page sends the
// person to enter.pollinations.ai with only a redirect_uri and a state; they
// come back with #api_key=sk_… in the URL fragment. The key lives in
// sessionStorage and is read by the API bridge; the shell never sees it.
export const AUTH_URL = 'https://enter.pollinations.ai/authorize';
export const KEY_STORE = 'shprout.apiKey';
export const STATE_STORE = 'shprout.oauthState';

export function consumeAuthCallback({
  location = globalThis.location,
  session = globalThis.sessionStorage,
  legacy = globalThis.localStorage,
} = {}) {
  const params = new URLSearchParams(location.hash.slice(1));
  const incomingKey = params.get('api_key');
  const incomingState = params.get('state');
  const oauthError = params.get('error');
  const errorDescription = params.get('error_description');
  const cleanedUrl = incomingKey || oauthError ? location.pathname + location.search : null;
  let error = null;

  if (incomingKey) {
    const expectedState = session.getItem(STATE_STORE);
    if (!expectedState || incomingState !== expectedState) {
      error = 'Authorization response had an invalid state';
    } else if (!incomingKey.startsWith('sk_')) {
      session.removeItem(STATE_STORE);
      error = 'Authorization response did not contain a Pollinations API key';
    } else {
      session.removeItem(STATE_STORE);
      session.setItem(KEY_STORE, incomingKey);
    }
  } else if (oauthError) {
    if (incomingState === session.getItem(STATE_STORE)) session.removeItem(STATE_STORE);
    error = errorDescription || oauthError;
  }

  const legacyKey = legacy?.getItem(KEY_STORE);
  if (legacyKey && !session.getItem(KEY_STORE)) session.setItem(KEY_STORE, legacyKey);
  if (legacyKey) legacy.removeItem(KEY_STORE);

  return { apiKey: session.getItem(KEY_STORE), cleanedUrl, error };
}

export function createAuthorizationUrl({
  redirectUrl,
  session = globalThis.sessionStorage,
  state = globalThis.crypto.randomUUID(),
} = {}) {
  session.setItem(STATE_STORE, state);
  const url = new URL(AUTH_URL);
  url.searchParams.set('redirect_uri', redirectUrl);
  url.searchParams.set('state', state);
  return url.toString();
}

export function clearAuthSession(session = globalThis.sessionStorage) {
  session.removeItem(KEY_STORE);
  session.removeItem(STATE_STORE);
}
