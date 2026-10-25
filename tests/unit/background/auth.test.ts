import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  AuthError,
  accessToken,
  challengeFor,
  clearTokens,
  isSignedIn,
  randomString,
  signIn,
  signOut,
} from '../../../src/background/auth';
import {
  API_PREFIX,
  API_URL,
  OAUTH_CLIENT_ID,
  OAUTH_RESOURCE,
  OAUTH_SCOPES,
} from '../../../src/lib/config';
import { calls, json, stubFetch } from './helpers';

const REDIRECT = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/';
const TOKEN_URL = `${API_URL}${API_PREFIX}/oauth/token`;
const REVOKE_URL = `${API_URL}${API_PREFIX}/oauth/revoke`;
const WELL_KNOWN = `${API_URL}/.well-known/oauth-authorization-server`;

const tokens = (overrides: Record<string, unknown> = {}) => ({
  access_token: 'at-new',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'rt-new',
  ...overrides,
});

/** Discovery fails (the fallback endpoints are used); the token endpoint answers `token`. */
function stubAuthServer(token: () => Response | Promise<Response> = () => json(tokens())) {
  return stubFetch((url) => {
    if (url === WELL_KNOWN) return new Response('Not found', { status: 404 });
    if (url === TOKEN_URL) return token();
    if (url === REVOKE_URL) return new Response(null, { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  });
}

const formOf = (init: RequestInit) => Object.fromEntries(init.body as URLSearchParams);

/** Stubs identity; the auth server answers with `reply(state)` as query parameters. */
function stubIdentity(reply: (authorize: URL) => Record<string, string> | undefined) {
  let authorize: URL | undefined;
  const launchWebAuthFlow = vi.fn(async ({ url }: { url: string }) => {
    authorize = new URL(url);
    const params = reply(authorize);
    return params ? `${REDIRECT}?${new URLSearchParams(params)}` : undefined;
  });
  fakeBrowser.identity.getRedirectURL = vi.fn(() => REDIRECT) as never;
  fakeBrowser.identity.launchWebAuthFlow = launchWebAuthFlow as never;
  return { launchWebAuthFlow, authorize: () => authorize! };
}

const okReply = (u: URL) => ({
  code: 'auth-code-123',
  state: u.searchParams.get('state')!,
  iss: API_URL,
});

beforeEach(() => fakeBrowser.reset());
afterEach(() => vi.unstubAllGlobals());

describe('PKCE helpers', () => {
  it('matches the RFC 7636 appendix B test vector', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it.each([16, 32, 48])('randomString(%i) is unpadded base64url of that many bytes', (bytes) => {
    const s = randomString(bytes);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s).toHaveLength(Math.ceil((bytes * 4) / 3));
  });

  it('randomString differs on every call', () => {
    expect(randomString()).not.toBe(randomString());
  });
});

describe('offline mode', () => {
  it('refuses to sign in and signs out without a request', async () => {
    const fetchMock = stubAuthServer();
    await fakeBrowser.storage.local.set({ settings: { offline: true }, 'auth:refresh': 'rt-1' });
    await expect(signIn()).rejects.toThrow('Offline mode is on');
    await signOut();
    expect(await isSignedIn()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('signIn', () => {
  it('runs the authorization code flow with PKCE and stores both tokens', async () => {
    const fetchMock = stubAuthServer();
    const { authorize } = stubIdentity(okReply);
    await signIn();

    const q = authorize().searchParams;
    expect(authorize().origin + authorize().pathname).toBe(
      `${API_URL}${API_PREFIX}/oauth/authorize`,
    );
    expect(Object.fromEntries(q)).toMatchObject({
      response_type: 'code',
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: REDIRECT,
      scope: OAUTH_SCOPES.join(' '),
      code_challenge_method: 'S256',
      resource: OAUTH_RESOURCE,
    });
    expect(q.get('state')).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const exchange = calls(fetchMock).find((c) => c.url === TOKEN_URL)!;
    expect(exchange.init.method).toBe('POST');
    expect(exchange.init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(exchange.init.signal).toBeInstanceOf(AbortSignal);
    const form = formOf(exchange.init);
    expect(form).toMatchObject({
      grant_type: 'authorization_code',
      code: 'auth-code-123',
      redirect_uri: REDIRECT,
      client_id: OAUTH_CLIENT_ID,
      resource: OAUTH_RESOURCE,
    });
    // The verifier sent with the code is the one the challenge was made from.
    expect(await challengeFor(form.code_verifier)).toBe(q.get('code_challenge'));

    expect(await fakeBrowser.storage.local.get('auth:refresh')).toEqual({
      'auth:refresh': 'rt-new',
    });
    const { 'auth:access': access } = await fakeBrowser.storage.session.get('auth:access');
    expect(access).toMatchObject({ token: 'at-new' });
    expect(await isSignedIn()).toBe(true);
  });

  it('uses the endpoints the server advertises', async () => {
    const issuer = `${API_URL}/`;
    const fetchMock = stubFetch((url) => {
      if (url === WELL_KNOWN) {
        return json({
          issuer,
          authorization_endpoint: 'https://login.example.com/authorize',
          token_endpoint: 'https://login.example.com/token',
        });
      }
      if (url === 'https://login.example.com/token') return json(tokens());
      throw new Error(`unexpected fetch ${url}`);
    });
    const { authorize } = stubIdentity(okReply);
    await signIn();
    expect(authorize().href.startsWith('https://login.example.com/authorize?')).toBe(true);
    expect(calls(fetchMock).map((c) => c.url)).toEqual([
      WELL_KNOWN,
      'https://login.example.com/token',
    ]);
  });

  it('falls back to the default endpoints when discovery fails on the network', async () => {
    stubFetch((url) => {
      if (url === WELL_KNOWN) throw new TypeError('Failed to fetch');
      return json(tokens());
    });
    const { authorize } = stubIdentity(okReply);
    await signIn();
    expect(authorize().pathname).toBe(`${API_PREFIX}/oauth/authorize`);
  });

  it.each([
    { name: 'cancelled', reply: () => undefined, message: 'Sign-in was cancelled.' },
    {
      name: 'error with description',
      reply: () => ({ error: 'access_denied', error_description: 'The user denied access.' }),
      message: 'The user denied access.',
    },
    {
      name: 'error without description',
      reply: () => ({ error: 'access_denied' }),
      message: 'access_denied',
    },
    {
      name: 'state mismatch',
      reply: () => ({ code: 'c', state: 'forged-state' }),
      message: 'Sign-in failed: the response did not match the request.',
    },
    {
      name: 'issuer mismatch',
      reply: (u: URL) => ({
        code: 'c',
        state: u.searchParams.get('state')!,
        iss: 'https://evil.example.com',
      }),
      message: 'Sign-in failed: unexpected issuer.',
    },
  ])('rejects a $name response without exchanging a code', async ({ reply, message }) => {
    const fetchMock = stubAuthServer();
    stubIdentity(reply);
    const err = await signIn().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as Error).message).toBe(message);
    expect(calls(fetchMock).some((c) => c.url === TOKEN_URL)).toBe(false);
    expect(await isSignedIn()).toBe(false);
  });

  it('accepts an issuer that differs only by a trailing slash', async () => {
    stubAuthServer();
    stubIdentity((u) => ({ code: 'c', state: u.searchParams.get('state')!, iss: `${API_URL}/` }));
    await expect(signIn()).resolves.toBeUndefined();
  });

  it.each([
    {
      name: 'error_description',
      res: () => json({ error: 'invalid_grant', error_description: 'Code expired.' }, 400),
      message: 'Code expired.',
    },
    {
      name: 'error code',
      res: () => json({ error: 'invalid_grant' }, 400),
      message: 'invalid_grant',
    },
    {
      name: 'status for a non-JSON body',
      res: () => new Response('<h1>Bad gateway</h1>', { status: 502 }),
      message: 'HTTP 502',
    },
  ])('reports a failed code exchange by its $name', async ({ res, message }) => {
    stubAuthServer(res);
    stubIdentity(okReply);
    await expect(signIn()).rejects.toThrow(message);
  });
});

describe('accessToken', () => {
  const setAccess = (token: string, msLeft: number) =>
    fakeBrowser.storage.session.set({ 'auth:access': { token, expiresAt: Date.now() + msLeft } });

  it('returns a stored token with more than a minute left without a request', async () => {
    const fetchMock = stubAuthServer();
    await setAccess('at-current', 10 * 60_000);
    expect(await accessToken()).toBe('at-current');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null without a request when signed out', async () => {
    const fetchMock = stubAuthServer();
    expect(await accessToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes a token with under a minute left and stores the rotated refresh token', async () => {
    const fetchMock = stubAuthServer();
    await setAccess('at-old', 30_000);
    await fakeBrowser.storage.local.set({ 'auth:refresh': 'rt-old' });

    expect(await accessToken()).toBe('at-new');
    const refresh = calls(fetchMock).find((c) => c.url === TOKEN_URL)!;
    expect(formOf(refresh.init)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'rt-old',
      client_id: OAUTH_CLIENT_ID,
      resource: OAUTH_RESOURCE,
    });
    expect((await fakeBrowser.storage.local.get('auth:refresh'))['auth:refresh']).toBe('rt-new');
  });

  it('refreshes a still-valid token when forced', async () => {
    stubAuthServer();
    await setAccess('at-current', 10 * 60_000);
    await fakeBrowser.storage.local.set({ 'auth:refresh': 'rt-old' });
    expect(await accessToken(true)).toBe('at-new');
  });

  it('keeps the refresh token when the response does not rotate it', async () => {
    stubAuthServer(() => json(tokens({ refresh_token: null })));
    await fakeBrowser.storage.local.set({ 'auth:refresh': 'rt-old' });
    expect(await accessToken()).toBe('at-new');
    expect((await fakeBrowser.storage.local.get('auth:refresh'))['auth:refresh']).toBe('rt-old');
  });

  it('serialises concurrent refreshes through one token request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = stubAuthServer(async () => {
      await gate;
      return json(tokens());
    });
    await fakeBrowser.storage.local.set({ 'auth:refresh': 'rt-old' });

    const both = Promise.all([accessToken(), accessToken()]);
    await vi.waitFor(() => expect(calls(fetchMock).some((c) => c.url === TOKEN_URL)).toBe(true));
    release();
    expect(await both).toEqual(['at-new', 'at-new']);
    expect(calls(fetchMock).filter((c) => c.url === TOKEN_URL)).toHaveLength(1);

    // Once settled, a later forced call starts a new refresh.
    await accessToken(true);
    expect(calls(fetchMock).filter((c) => c.url === TOKEN_URL)).toHaveLength(2);
  });

  it.each([
    { status: 400, body: { error: 'invalid_grant', error_description: 'Refresh token reused.' } },
    { status: 401, body: { error: 'invalid_client' } },
  ])(
    'signs out when the token endpoint rejects the refresh token with $status',
    async ({ status, body }) => {
      stubAuthServer(() => json(body, status));
      await setAccess('at-old', 10_000);
      await fakeBrowser.storage.local.set({ 'auth:refresh': 'rt-reused' });
      expect(await accessToken()).toBeNull();
      expect(await isSignedIn()).toBe(false);
    },
  );

  it.each([
    { status: 429, body: { error: 'slow_down' } },
    { status: 500, body: {} },
    { status: 503, body: { error: 'temporarily_unavailable' } },
  ])('keeps the refresh token on a $status for the next try', async ({ status, body }) => {
    stubAuthServer(() => json(body, status));
    await fakeBrowser.storage.local.set({ 'auth:refresh': 'rt-old' });
    expect(await accessToken()).toBeNull();
    expect((await fakeBrowser.storage.local.get('auth:refresh'))['auth:refresh']).toBe('rt-old');
  });

  it('does not bring the session back when sign-out happens during a refresh', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = stubAuthServer(async () => {
      await gate;
      return json(tokens());
    });
    await fakeBrowser.storage.local.set({ 'auth:refresh': 'rt-old' });
    const pending = accessToken();
    await vi.waitFor(() => expect(calls(fetchMock).some((c) => c.url === TOKEN_URL)).toBe(true));
    await signOut();
    release();
    expect(await pending).toBeNull();
    expect(await isSignedIn()).toBe(false);
  });

  it('keeps the session on a network failure', async () => {
    stubFetch((url) => {
      if (url === TOKEN_URL) throw new TypeError('Failed to fetch');
      return new Response(null, { status: 404 });
    });
    await fakeBrowser.storage.local.set({ 'auth:refresh': 'rt-old' });
    expect(await accessToken()).toBeNull();
    expect(await isSignedIn()).toBe(true);
  });
});

describe('signOut', () => {
  it('clears the tokens and revokes the refresh token', async () => {
    const fetchMock = stubAuthServer();
    await fakeBrowser.storage.local.set({ 'auth:refresh': 'rt-1' });
    await fakeBrowser.storage.session.set({
      'auth:access': { token: 'at-1', expiresAt: Date.now() + 60_000 },
    });
    await signOut();
    expect(await isSignedIn()).toBe(false);
    const revoke = calls(fetchMock).find((c) => c.url === REVOKE_URL)!;
    expect(revoke.init.method).toBe('POST');
    expect(formOf(revoke.init)).toEqual({ token: 'rt-1', client_id: OAUTH_CLIENT_ID });
  });

  it('revokes the access token when there is no refresh token', async () => {
    const fetchMock = stubAuthServer();
    await fakeBrowser.storage.session.set({
      'auth:access': { token: 'at-only', expiresAt: Date.now() + 60_000 },
    });
    await signOut();
    expect(formOf(calls(fetchMock).find((c) => c.url === REVOKE_URL)!.init).token).toBe('at-only');
  });

  it('makes no request when already signed out', async () => {
    const fetchMock = stubAuthServer();
    await signOut();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signs out locally even when revocation fails', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    await fakeBrowser.storage.local.set({ 'auth:refresh': 'rt-1' });
    await expect(signOut()).resolves.toBeUndefined();
    expect(await isSignedIn()).toBe(false);
  });
});

describe('clearTokens', () => {
  it('removes only the auth keys', async () => {
    await fakeBrowser.storage.local.set({ 'auth:refresh': 'rt', settings: { offline: false } });
    await fakeBrowser.storage.session.set({ 'auth:access': { token: 'at', expiresAt: 0 } });
    await clearTokens();
    expect(await fakeBrowser.storage.local.get(null)).toEqual({ settings: { offline: false } });
    expect(await fakeBrowser.storage.session.get(null)).toEqual({});
  });
});
