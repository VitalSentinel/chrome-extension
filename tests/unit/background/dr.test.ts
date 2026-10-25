import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { domainRating, pruneDr } from '../../../src/background/dr';
import { API_PREFIX, API_URL, DR_TTL_MS, TERMS_VERSION } from '../../../src/lib/config';
import { SETTINGS_KEY } from '../../../src/lib/settings';
import { count } from '../../../src/background/usage';
import { calls, json, stubFetch } from './helpers';

vi.mock('../../../src/background/usage', () => ({ count: vi.fn(async () => {}) }));

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1);
const drBody = (domain: string, rating: number | null = 71) => ({
  domain,
  domain_rating: rating,
  fetched_at: '2026-09-28T08:00:00Z',
  stale: false,
});
const consent = (extra: Record<string, unknown> = {}) =>
  fakeBrowser.storage.local.set({
    [SETTINGS_KEY]: { drConsent: true, termsAccepted: TERMS_VERSION, ...extra },
  });

let now: ReturnType<typeof vi.spyOn>;
const at = (ms: number) => now.mockReturnValue(T0 + ms);

beforeEach(async () => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  now = vi.spyOn(Date, 'now').mockReturnValue(T0);
  await consent();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('domainRating preconditions', () => {
  it.each([
    'localhost',
    'intranet',
    '192.168.1.20',
    'shop.localhost',
    'printer.local',
    'app.test',
    '[::1]',
  ])('does not look up %s', async (host) => {
    const fetchMock = stubFetch(() => json(drBody(host)));
    expect(await domainRating(host)).toEqual({ dr: null, error: 'unsupported' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'before consent', settings: { drConsent: false }, error: 'no_consent' },
    { name: 'in offline mode', settings: { offline: true }, error: 'offline' },
  ])('sends nothing $name', async ({ settings, error }) => {
    await consent(settings);
    const fetchMock = stubFetch(() => json(drBody('example.com')));
    expect(await domainRating('www.example.com')).toEqual({ dr: null, error });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('domainRating lookups', () => {
  it('fetches anonymously and caches the answer for 7 days by site', async () => {
    const fetchMock = stubFetch(() => json(drBody('example.co.uk')));
    const expected = {
      dr: {
        domain: 'example.co.uk',
        domainRating: 71,
        fetchedAt: '2026-09-28T08:00:00Z',
        stale: false,
      },
      error: null,
    };
    expect(await domainRating('www.blog.example.co.uk')).toEqual(expected);

    const [{ url, init }] = calls(fetchMock);
    // Only the registrable domain leaves the browser, never the full host.
    expect(url).toBe(`${API_URL}${API_PREFIX}/domain-rating?target=example.co.uk`);
    expect(init.headers).toEqual({ Accept: 'application/json' });
    expect(init.credentials).toBe('omit');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((await fakeBrowser.storage.local.get('dr:example.co.uk'))['dr:example.co.uk']).toEqual({
      at: T0,
      value: expected.dr,
      error: null,
    });

    // Another host of the same site, days later, is served from the cache.
    at(DR_TTL_MS - 1);
    expect(await domainRating('example.co.uk')).toEqual(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    at(DR_TTL_MS);
    await domainRating('example.co.uk');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never sends a token, signed in or not', async () => {
    const fetchMock = stubFetch(() => json(drBody('example.com')));
    await domainRating('example.com');
    expect(calls(fetchMock)[0].init.headers).toEqual({ Accept: 'application/json' });
  });

  it('looks nothing up before the current Terms are accepted', async () => {
    await consent({ termsAccepted: '' });
    const fetchMock = stubFetch(() => json(drBody('example.com')));
    expect(await domainRating('example.com')).toEqual({ dr: null, error: 'no_consent' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches an unsupported domain (422) as long as a rating', async () => {
    const fetchMock = stubFetch(() => json({ code: 'unsupported_domain' }, 422));
    expect(await domainRating('example.com')).toEqual({ dr: null, error: 'unsupported' });
    at(DR_TTL_MS - 1);
    expect(await domainRating('example.com')).toEqual({ dr: null, error: 'unsupported' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: 'a 503', res: () => json({ title: 'Service Unavailable' }, 503), error: 'HTTP 503' },
    {
      name: 'a network error',
      res: () => {
        throw new TypeError('Failed to fetch');
      },
      error: 'network',
    },
  ])('retries $name after an hour', async ({ res, error }) => {
    const fetchMock = stubFetch(res);
    expect(await domainRating('example.com')).toEqual({ dr: null, error });
    at(HOUR - 1);
    await domainRating('example.com');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    at(HOUR);
    await domainRating('example.com');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(count).toHaveBeenCalledWith('error.dr');
  });

  it('keeps the last good value when a refresh fails and retries it in an hour', async () => {
    const good = {
      domain: 'example.com',
      domainRating: 64,
      fetchedAt: '2026-09-01T00:00:00Z',
      stale: false,
    };
    await fakeBrowser.storage.local.set({
      'dr:example.com': { at: T0 - DR_TTL_MS - HOUR, value: good, error: null },
    });
    const fetchMock = stubFetch(() => json({}, 503));

    expect(await domainRating('example.com')).toEqual({ dr: good, error: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    at(HOUR - 1);
    expect(await domainRating('example.com')).toEqual({ dr: good, error: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    at(HOUR);
    await domainRating('example.com');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one request between concurrent lookups of a site', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = stubFetch(async () => {
      await gate;
      return json(drBody('example.com', 55));
    });
    const both = Promise.all([domainRating('www.example.com'), domainRating('blog.example.com')]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    release();
    const [a, b] = await both;
    expect(a.dr?.domainRating).toBe(55);
    expect(b).toEqual(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a null rating as a successful answer', async () => {
    stubFetch(() => json(drBody('example.com', null)));
    expect(await domainRating('example.com')).toEqual({
      dr: {
        domain: 'example.com',
        domainRating: null,
        fetchedAt: '2026-09-28T08:00:00Z',
        stale: false,
      },
      error: null,
    });
  });
});

describe('pruneDr', () => {
  const entry = (age: number) => ({ at: T0 - age, value: null, error: 'network' });
  const keys = async () =>
    Object.keys(await fakeBrowser.storage.local.get(null)).filter((k) => k.startsWith('dr:'));

  it('drops ratings older than the cache lifetime', async () => {
    await fakeBrowser.storage.local.set({
      'dr:old.com': entry(DR_TTL_MS + 1),
      'dr:new.com': entry(1),
    });
    await pruneDr(T0);
    expect(await keys()).toEqual(['dr:new.com']);
  });

  it.each([{ drConsent: false }, { showDrBadge: false }])('drops all with %o', async (s) => {
    await consent(s);
    await fakeBrowser.storage.local.set({ 'dr:new.com': entry(1) });
    await pruneDr(T0);
    expect(await keys()).toEqual([]);
  });
});
