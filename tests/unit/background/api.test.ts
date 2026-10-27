import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { accessToken, isSignedIn } from '../../../src/background/auth';
import {
  authState,
  domains,
  forgetAccount,
  unwrap,
  pruneOverviews,
  urlOverview,
  unwatchPage,
  watchPage,
} from '../../../src/background/api';
import type { Domain, Page, UrlOverview, Workspace } from '../../../src/lib/app';
import { API_PREFIX, API_URL, OVERVIEW_TTL_MS, TERMS_VERSION } from '../../../src/lib/config';
import { SETTINGS_KEY } from '../../../src/lib/settings';
import { calls, json, stubFetch } from './helpers';

vi.mock('../../../src/background/auth', () => ({ accessToken: vi.fn(), isSignedIn: vi.fn() }));

const BASE = `${API_URL}${API_PREFIX}`;
const page = <T>(items: T[], total: number | null = items.length): Page<T> => ({
  items,
  next_cursor: null,
  has_more: false,
  total,
});
const workspace: Workspace = { id: 'ws_1', name: 'Acme', plan: 'pro' };
const domain: Domain = {
  id: 'dom_1',
  workspace_id: 'ws_1',
  domain: 'example.com',
  active_modules: ['gsc', 'rum'],
};
const overview = { url: 'https://www.example.com/pricing', sections: {} } as unknown as UrlOverview;

beforeEach(async () => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  await forgetAccount();
  await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { termsAccepted: TERMS_VERSION } });
  vi.mocked(isSignedIn).mockResolvedValue(true);
  vi.mocked(accessToken).mockImplementation(async (force?: boolean) =>
    force ? 'at-refreshed' : 'at-1',
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('calls to the API', () => {
  it('sends the bearer token and JSON accept header', async () => {
    const fetchMock = stubFetch(() => json(overview));
    expect(await urlOverview('dom_1', 'https://www.example.com/pricing')).toEqual({
      ok: true,
      data: overview,
    });
    const [{ url, init }] = calls(fetchMock);
    expect(url).toBe(
      `${BASE}/domains/dom_1/url-overview?url=https%3A%2F%2Fwww.example.com%2Fpricing&fallback=domain&sections=search_console%2Cindexing%2Ccrux%2Cweb_analytics%2Ccrawl&days=90`,
    );
    expect(init.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer at-1' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('asks for and caches the page without its tracking parameters or hash', async () => {
    const fetchMock = stubFetch(() => json(overview));
    await urlOverview('dom_1', 'https://www.example.com/pricing?utm_source=x&plan=pro&gclid=1#faq');
    await urlOverview('dom_1', 'https://www.example.com/pricing?plan=pro');
    expect(calls(fetchMock)).toHaveLength(1);
    expect(new URL(calls(fetchMock)[0].url).searchParams.get('url')).toBe(
      'https://www.example.com/pricing?plan=pro',
    );
    expect(Object.keys(await fakeBrowser.storage.session.get(null))).toEqual([
      'app:overview:dom_1:https://www.example.com/pricing?plan=pro',
    ]);
  });

  it('makes no request in offline mode', async () => {
    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { offline: true } });
    const fetchMock = stubFetch(() => json({}));
    expect(await urlOverview('dom_1', 'https://www.example.com/')).toEqual({
      ok: false,
      status: 0,
      error: 'offline',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('makes no request before the Terms in force are accepted', async () => {
    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { termsAccepted: '2000-01-01' } });
    const fetchMock = stubFetch(() => json({}));
    expect(await urlOverview('dom_1', 'https://www.example.com/')).toEqual({
      ok: false,
      status: 0,
      error: 'terms',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 401 signed_out without a token', async () => {
    vi.mocked(accessToken).mockResolvedValue(null);
    const fetchMock = stubFetch(() => json({}));
    expect(await urlOverview('dom_1', 'https://www.example.com/')).toEqual({
      ok: false,
      status: 401,
      error: 'signed_out',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a network failure', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await urlOverview('dom_1', 'https://www.example.com/')).toEqual({
      ok: false,
      status: 0,
      error: 'network',
    });
  });

  it('retries a 401 once with a forced refresh', async () => {
    const fetchMock = stubFetch((_url, init) =>
      (init.headers as Record<string, string>).Authorization === 'Bearer at-refreshed'
        ? json(overview)
        : json({ code: 'token_expired' }, 401),
    );
    expect(await urlOverview('dom_1', 'https://www.example.com/')).toEqual({
      ok: true,
      data: overview,
    });
    expect(vi.mocked(accessToken).mock.calls).toEqual([[false], [true]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the second 401', async () => {
    const fetchMock = stubFetch(() => json({ code: 'token_revoked' }, 401));
    expect(await urlOverview('dom_1', 'https://www.example.com/')).toEqual({
      ok: false,
      status: 401,
      error: 'token_revoked',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      body: { code: 'domain_not_found', detail: 'No such domain', title: 'Not Found' },
      status: 404,
      error: 'domain_not_found',
    },
    {
      body: { detail: 'You are not a member of this workspace', title: 'Forbidden' },
      status: 403,
      error: 'You are not a member of this workspace',
    },
    { body: { title: 'Too Many Requests' }, status: 429, error: 'Too Many Requests' },
    { body: {}, status: 400, error: 'HTTP 400' },
    { body: null, status: 500, error: 'HTTP 500' },
  ])('maps a $status error body to "$error"', async ({ body, status, error }) => {
    stubFetch(() =>
      body ? json(body, status) : new Response('<html>Internal error</html>', { status }),
    );
    expect(await urlOverview('dom_1', 'https://www.example.com/')).toEqual({
      ok: false,
      status,
      error,
    });
  });
});

describe('unwrap', () => {
  it('returns the data or throws the error', () => {
    expect(unwrap({ ok: true, data: 3 })).toBe(3);
    expect(() => unwrap({ ok: false, status: 403, error: 'forbidden' })).toThrow('forbidden');
  });
});

describe('authState', () => {
  it('is signed out without a request', async () => {
    vi.mocked(isSignedIn).mockResolvedValue(false);
    const fetchMock = stubFetch(() => json({}));
    expect(await authState()).toEqual({ signedIn: false, workspaces: [], roles: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads workspaces and roles once and caches them', async () => {
    const fetchMock = stubFetch((url) =>
      url.endsWith('/workspaces')
        ? json(page([workspace]))
        : json({ id: 'u_1', roles: { ws_1: 'owner' } }),
    );
    const expected = { signedIn: true, workspaces: [workspace], roles: { ws_1: 'owner' } };
    expect(await authState()).toEqual(expected);
    expect(await authState()).toEqual(expected);
    expect(
      calls(fetchMock)
        .map((c) => c.url)
        .sort(),
    ).toEqual([`${BASE}/me`, `${BASE}/workspaces`]);
    expect((await fakeBrowser.storage.local.get('app:account'))['app:account']).toMatchObject({
      value: { workspaces: [workspace] },
    });
  });

  it('without waiting, answers signed in with no workspaces and loads in the background', async () => {
    let answer!: () => void;
    const fetchMock = stubFetch((url) =>
      url.endsWith('/workspaces')
        ? json(page([workspace]))
        : new Promise<Response>(
            (r) => (answer = () => r(json({ id: 'u_1', roles: {}, name: 'Ada Lovelace' }))),
          ),
    );
    expect(await authState(false)).toEqual({
      signedIn: true,
      workspaces: [],
      roles: {},
      pending: 'loading',
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    answer();
    await vi.waitFor(async () =>
      expect(await authState(false)).toEqual({
        signedIn: true,
        workspaces: [workspace],
        roles: {},
        user: 'Ada Lovelace',
        pending: 'loading', // the domain list is not cached yet
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('says when the background load failed, and waits before trying again', async () => {
    const fetchMock = stubFetch(() => json({ code: 'server' }, 500));
    await authState(false);
    await vi.waitFor(async () => expect((await authState(false)).pending).toBe('failed'));
    const before = fetchMock.mock.calls.length;
    await authState(false);
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('stays signed in with no workspaces when the API fails', async () => {
    stubFetch(() => json({ title: 'Service Unavailable' }, 503));
    expect(await authState()).toEqual({ signedIn: true, workspaces: [], roles: {} });
    expect(await fakeBrowser.storage.local.get('app:account')).toEqual({});
  });
});

describe('domains', () => {
  it('is empty when signed out', async () => {
    vi.mocked(isSignedIn).mockResolvedValue(false);
    expect(await domains()).toEqual([]);
  });

  it('loads domains with their modules and caches them', async () => {
    const fetchMock = stubFetch(() => json(page([domain])));
    expect(await domains()).toEqual([domain]);
    expect(await domains()).toEqual([domain]);
    expect(calls(fetchMock).map((c) => c.url)).toEqual([`${BASE}/domains?include_modules=true`]);
  });

  it('is empty when the request fails', async () => {
    stubFetch(() => json({}, 500));
    expect(await domains()).toEqual([]);
  });

  it('without waiting, answers from the cache, even an expired one, and refreshes it', async () => {
    const fetchMock = stubFetch(() => json(page([{ ...domain, id: 'dom_2' }])));
    expect(await domains(false)).toEqual([]);
    await vi.waitFor(async () => expect((await domains(false))[0]?.id).toBe('dom_2'));
    await fakeBrowser.storage.local.set({ 'app:domains': { at: 0, value: [domain] } });
    expect(await domains(false)).toEqual([domain]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('without waiting, swallows a failed background load', async () => {
    stubFetch(() => json({}, 500));
    expect(await domains(false)).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(await fakeBrowser.storage.local.get('app:domains')).toEqual({});
  });

  it('does not cache a load that finished after the account changed', async () => {
    let answer!: () => void;
    stubFetch(() => new Promise<Response>((r) => (answer = () => r(json(page([domain]))))));
    const loading = domains();
    await new Promise((r) => setTimeout(r, 0));
    await forgetAccount();
    answer();
    await loading;
    expect(await fakeBrowser.storage.local.get('app:domains')).toEqual({});
  });
});

describe('urlOverview', () => {
  it('serves a repeat within the TTL from storage.session and refetches on refresh', async () => {
    const fetchMock = stubFetch(() => json(overview));
    await urlOverview('dom_1', 'https://www.example.com/pricing');
    expect(
      await fakeBrowser.storage.session.get('app:overview:dom_1:https://www.example.com/pricing'),
    ).toEqual({
      'app:overview:dom_1:https://www.example.com/pricing': {
        at: expect.any(Number),
        data: overview,
      },
    });
    await urlOverview('dom_1', 'https://www.example.com/pricing');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await urlOverview('dom_1', 'https://www.example.com/pricing', true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refetches once the TTL has passed', async () => {
    const fetchMock = stubFetch(() => json(overview));
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await urlOverview('dom_1', 'https://www.example.com/pricing');
    now.mockReturnValue(1_000_000 + OVERVIEW_TTL_MS);
    await urlOverview('dom_1', 'https://www.example.com/pricing');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keys the cache by domain and URL', async () => {
    const fetchMock = stubFetch(() => json(overview));
    await urlOverview('dom_1', 'https://www.example.com/a');
    await urlOverview('dom_1', 'https://www.example.com/b');
    await urlOverview('dom_2', 'https://www.example.com/a');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps at most 50 overviews, dropping the oldest', async () => {
    const fetchMock = stubFetch(() => json(overview));
    let t = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (t += 1));
    for (let i = 0; i <= 50; i++) await urlOverview('dom_1', `https://www.example.com/p/${i}`);
    const kept = Object.keys(await fakeBrowser.storage.session.get(null));
    expect(kept.filter((k) => k.startsWith('app:overview:'))).toHaveLength(50);
    expect(fetchMock).toHaveBeenCalledTimes(51);
    await urlOverview('dom_1', 'https://www.example.com/p/50');
    expect(fetchMock).toHaveBeenCalledTimes(51);
    await urlOverview('dom_1', 'https://www.example.com/p/0');
    expect(fetchMock).toHaveBeenCalledTimes(52);
  });

  it('does not cache an answer asked for before the page was watched', async () => {
    let answer!: () => void;
    stubFetch((url) =>
      url.includes('/watches')
        ? json({ duplicate: false, watch: { id: 'w1' } }, 201)
        : new Promise<Response>((r) => (answer = () => r(json(overview)))),
    );
    const loading = urlOverview('dom_1', 'https://www.example.com/');
    await vi.waitFor(() => expect(answer).toBeDefined());
    expect((await watchPage('dom_1', 'https://www.example.com/')).ok).toBe(true);
    answer();
    expect(await loading).toEqual({ ok: true, data: overview });
    expect(Object.keys(await fakeBrowser.storage.session.get(null))).toEqual([]);
  });

  it('tolerates cached overviews that vanished while it pruned', async () => {
    stubFetch(() => json(overview));
    for (let i = 0; i < 50; i++) await urlOverview('dom_1', `https://www.example.com/p/${i}`);
    const get = fakeBrowser.storage.session.get.bind(fakeBrowser.storage.session);
    vi.spyOn(fakeBrowser.storage.session, 'get').mockImplementation(((keys?: unknown) =>
      Array.isArray(keys) ? Promise.resolve({}) : get(keys as never)) as never);
    expect(await urlOverview('dom_1', 'https://www.example.com/new')).toEqual({
      ok: true,
      data: overview,
    });
    vi.restoreAllMocks();
  });

  it('still answers when the session store refuses the write', async () => {
    stubFetch(() => json(overview));
    vi.spyOn(fakeBrowser.storage.session, 'set').mockRejectedValue(new Error('quota'));
    expect(await urlOverview('dom_1', 'https://www.example.com/')).toEqual({
      ok: true,
      data: overview,
    });
    vi.restoreAllMocks();
  });

  it('does not cache an answer that arrives after the account changed', async () => {
    let answer!: () => void;
    stubFetch(() => new Promise<Response>((r) => (answer = () => r(json(overview)))));
    const loading = urlOverview('dom_1', 'https://www.example.com/');
    await new Promise((r) => setTimeout(r, 0));
    await forgetAccount();
    answer();
    expect((await loading).ok).toBe(true);
    expect(await fakeBrowser.storage.session.get(null)).toEqual({});
  });

  it('does not cache a failure', async () => {
    const fetchMock = stubFetch(() => json({}, 500));
    await urlOverview('dom_1', 'https://www.example.com/');
    await urlOverview('dom_1', 'https://www.example.com/');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('watchPage', () => {
  it('watches the page without its tracking parameters', async () => {
    const fetchMock = stubFetch(() => json({ duplicate: false }, 201));
    await watchPage('dom_1', 'https://www.example.com/pricing?utm_campaign=launch');
    expect(JSON.parse(calls(fetchMock)[0].init.body as string)).toEqual({
      url: 'https://www.example.com/pricing',
    });
  });

  it("posts the URL as JSON and drops the domain's cached overviews", async () => {
    const fetchMock = stubFetch((url) =>
      url.includes('/watches') ? json({ duplicate: false }, 201) : json(overview),
    );
    await urlOverview('dom_2', 'https://www.example.com/pricing');
    await urlOverview('dom_1', 'https://www.example.com/pricing');
    expect(await watchPage('dom_1', 'https://www.example.com/pricing')).toEqual({
      ok: true,
      data: { duplicate: false },
    });

    expect(Object.keys(await fakeBrowser.storage.session.get(null))).toEqual([
      'app:overview:dom_2:https://www.example.com/pricing',
    ]);
    const post = calls(fetchMock)[2];
    expect(post.url).toBe(`${BASE}/domains/dom_1/page-monitoring/watches`);
    expect(post.init.method).toBe('POST');
    expect(JSON.parse(post.init.body as string)).toEqual({
      url: 'https://www.example.com/pricing',
    });
    expect(post.init.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer at-1',
      'Content-Type': 'application/json',
    });

    await urlOverview('dom_1', 'https://www.example.com/pricing');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('unwatchPage', () => {
  it("deletes the watch and drops the domain's cached overviews", async () => {
    const fetchMock = stubFetch((url) =>
      url.includes('/watches/') ? new Response(null, { status: 204 }) : json(overview),
    );
    await urlOverview('dom_1', 'https://www.example.com/pricing');
    expect(await unwatchPage('dom_1', 'w1')).toEqual({ ok: true, data: null });
    const del = calls(fetchMock)[1];
    expect(del.url).toBe(`${BASE}/domains/dom_1/page-monitoring/watches/w1`);
    expect(del.init.method).toBe('DELETE');
    expect(del.init.body).toBeUndefined();
    expect(await fakeBrowser.storage.session.get(null)).toEqual({});
  });

  it('keeps the cache when the app refuses', async () => {
    stubFetch((url) =>
      url.includes('/watches/') ? json({ code: 'forbidden' }, 403) : json(overview),
    );
    await urlOverview('dom_1', 'https://www.example.com/pricing');
    expect(await unwatchPage('dom_1', 'w1')).toEqual({
      ok: false,
      status: 403,
      error: 'forbidden',
    });
    expect(Object.keys(await fakeBrowser.storage.session.get(null))).toHaveLength(1);
  });

  it('keeps cached overviews when the watch fails', async () => {
    const fetchMock = stubFetch((url) =>
      url.includes('/watches') ? json({ code: 'page_limit_reached' }, 402) : json(overview),
    );
    await urlOverview('dom_1', 'https://www.example.com/');
    expect(await watchPage('dom_1', 'https://www.example.com/')).toEqual({
      ok: false,
      status: 402,
      error: 'page_limit_reached',
    });
    await urlOverview('dom_1', 'https://www.example.com/');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('forgetAccount', () => {
  it('removes every app:* key and nothing else', async () => {
    await fakeBrowser.storage.local.set({
      'app:account': { at: 1, value: {} },
      'app:domains': { at: 1, value: [] },
      'dr:example.com': { at: 1, value: null, error: null },
      'auth:refresh': 'rt',
      [SETTINGS_KEY]: { offline: false },
    });
    await forgetAccount();
    expect(Object.keys(await fakeBrowser.storage.local.get(null)).sort()).toEqual([
      'auth:refresh',
      'dr:example.com',
      SETTINGS_KEY,
    ]);
  });

  it('drops cached overviews and nothing else in storage.session', async () => {
    const fetchMock = stubFetch(() => json(overview));
    await urlOverview('dom_1', 'https://www.example.com/');
    await fakeBrowser.storage.session.set({ 'nav:1': { status: 200 } });
    await forgetAccount();
    expect(Object.keys(await fakeBrowser.storage.session.get(null))).toEqual(['nav:1']);
    await urlOverview('dom_1', 'https://www.example.com/');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('pruneOverviews', () => {
  it('deletes page data past its hour and keeps the rest', async () => {
    const now = 10 * OVERVIEW_TTL_MS;
    await fakeBrowser.storage.session.set({
      'app:overview:dom_1:old': { at: now - OVERVIEW_TTL_MS, data: overview },
      'app:overview:dom_1:new': { at: now - 1, data: overview },
      'vitals:7': { url: 'x' },
    });
    await pruneOverviews(now);
    expect(Object.keys(await fakeBrowser.storage.session.get(null)).sort()).toEqual([
      'app:overview:dom_1:new',
      'vitals:7',
    ]);
  });
});
