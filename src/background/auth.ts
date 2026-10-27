import { browser } from 'wxt/browser';
import { API_PREFIX, API_URL, OAUTH_CLIENT_ID, OAUTH_RESOURCE, OAUTH_SCOPES } from '../lib/config';
import { getLocal, getSession, setLocal, setSession, getSettings } from './store';

// OAuth 2.1 with PKCE against the VitalSentinel app, through chrome.identity.launchWebAuthFlow.
// The access token lives in storage.session (memory only, gone with the browser session),
// the rotating refresh token in storage.local. Refresh tokens are single-use: presenting an
// old one revokes the whole grant, so refreshes are serialised through one promise.

interface Endpoints {
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  issuer: string;
}

interface AccessToken {
  token: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string | null;
}

const ACCESS = 'auth:access';
const REFRESH = 'auth:refresh';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

const TIMEOUT = 15_000;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export function randomString(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function challengeFor(verifier: string): Promise<string> {
  return b64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
}

async function endpoints(): Promise<Endpoints> {
  const fallback: Endpoints = {
    issuer: API_URL,
    authorization_endpoint: `${API_URL}${API_PREFIX}/oauth/authorize`,
    token_endpoint: `${API_URL}${API_PREFIX}/oauth/token`,
    revocation_endpoint: `${API_URL}${API_PREFIX}/oauth/revoke`,
  };
  try {
    const res = await fetch(`${API_URL}/.well-known/oauth-authorization-server`, {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    return res.ok ? { ...fallback, ...((await res.json()) as Partial<Endpoints>) } : fallback;
  } catch {
    return fallback;
  }
}

async function tokenRequest(url: string, form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok)
    throw new AuthError(body.error_description || body.error || `HTTP ${res.status}`, res.status);
  return body;
}

async function store(tokens: TokenResponse) {
  // The rotated refresh token first: if the worker stops in between, the next refresh still
  // holds the token the server expects.
  if (tokens.refresh_token) await setLocal(REFRESH, tokens.refresh_token);
  await setSession(ACCESS, {
    token: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  } satisfies AccessToken);
}

// api.ts imports this module, so it registers what to forget (the cached account) through
// onSessionLost instead of auth.ts importing it back.
let sessionLost: () => Promise<void> = async () => {};

/** Registers what runs once a rejected refresh has ended the session. */
export function onSessionLost(fn: () => Promise<void>) {
  sessionLost = fn;
}

export async function clearTokens() {
  await browser.storage.session.remove(ACCESS);
  await browser.storage.local.remove(REFRESH);
}

export async function isSignedIn(): Promise<boolean> {
  return !!(await getLocal<string>(REFRESH)) || !!(await getSession<AccessToken>(ACCESS));
}

export async function signIn(): Promise<void> {
  if ((await getSettings()).offline)
    throw new AuthError('Offline mode is on. Turn it off in Settings to sign in.');
  const ep = await endpoints();
  const verifier = randomString(48);
  const state = randomString(16);
  const redirectUri = browser.identity.getRedirectURL();
  const url = new URL(ep.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPES.join(' '),
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    resource: OAUTH_RESOURCE,
  }).toString();

  const result = await browser.identity.launchWebAuthFlow({ url: url.href, interactive: true });
  if (!result) throw new AuthError('Sign-in was cancelled.');
  const back = new URL(result).searchParams;
  if (back.get('error')) throw new AuthError(back.get('error_description') || back.get('error')!);
  if (back.get('state') !== state)
    throw new AuthError('Sign-in failed: the response did not match the request.');
  const iss = back.get('iss');
  if (iss && iss.replace(/\/$/, '') !== ep.issuer.replace(/\/$/, ''))
    throw new AuthError('Sign-in failed: unexpected issuer.');

  await store(
    await tokenRequest(ep.token_endpoint, {
      grant_type: 'authorization_code',
      code: back.get('code') ?? '',
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: OAUTH_CLIENT_ID,
      resource: OAUTH_RESOURCE,
    }),
  );
}

let refreshing: Promise<string | null> | null = null;

async function refresh(): Promise<string | null> {
  const token = await getLocal<string>(REFRESH);
  if (!token) return null;
  try {
    const ep = await endpoints();
    const tokens = await tokenRequest(ep.token_endpoint, {
      grant_type: 'refresh_token',
      refresh_token: token,
      client_id: OAUTH_CLIENT_ID,
      resource: OAUTH_RESOURCE,
    });
    // Signed out while the request was in flight: do not bring the session back.
    if ((await getLocal<string>(REFRESH)) !== token) return null;
    await store(tokens);
    return tokens.access_token;
  } catch (e) {
    // Only a rejected refresh token (reused, revoked or expired: 400/401) ends the session;
    // a server error, rate limit or timeout keeps it for the next try.
    if (e instanceof AuthError && (e.status === 400 || e.status === 401)) {
      await clearTokens();
      await sessionLost();
    }
    return null;
  }
}

/** A valid access token, refreshing it when it has under a minute left; null when signed out. */
export async function accessToken(force = false): Promise<string | null> {
  const current = await getSession<AccessToken>(ACCESS);
  if (!force && current && current.expiresAt - Date.now() > 60_000) return current.token;
  refreshing ??= refresh().finally(() => (refreshing = null));
  return refreshing;
}

export async function signOut(): Promise<void> {
  const token = (await getLocal<string>(REFRESH)) ?? (await getSession<AccessToken>(ACCESS))?.token;
  await clearTokens();
  // Offline, sign out locally only; the grant expires on its own.
  if (!token || (await getSettings()).offline) return;
  try {
    const ep = await endpoints();
    await fetch(ep.revocation_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, client_id: OAUTH_CLIENT_ID }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch {
    // Signed out locally either way; the grant expires on its own.
  }
}
