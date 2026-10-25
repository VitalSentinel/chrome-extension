import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { isSignedIn } from '../../../src/background/auth';
import { USAGE_KEY, count, pruneUsage, sendDue } from '../../../src/background/usage';
import { API_PREFIX, API_URL, TERMS_VERSION } from '../../../src/lib/config';
import { SETTINGS_KEY } from '../../../src/lib/settings';

// Both statistics are opt-in; these tests start from a user who ticked both.
const OPTED_IN = { usageStats: true, errorReports: true };
import { calls, stubFetch } from './helpers';

vi.mock('../../../src/background/auth', () => ({ isSignedIn: vi.fn() }));

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 25, 12);
const ENDPOINT = `${API_URL}${API_PREFIX}/extension/telemetry`;
const stored = async () => (await fakeBrowser.storage.local.get(USAGE_KEY))[USAGE_KEY];
const allow = (extra: Record<string, unknown> = {}) =>
  fakeBrowser.storage.local.set({
    [SETTINGS_KEY]: { termsAccepted: TERMS_VERSION, ...OPTED_IN, ...extra },
  });

beforeEach(async () => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  vi.mocked(isSignedIn).mockResolvedValue(true);
  fakeBrowser.i18n.getUILanguage = () => 'en-GB';
  fakeBrowser.runtime.getManifest = (() => ({ version: '1.0.1' })) as never;
  await allow();
});
afterEach(() => vi.unstubAllGlobals());

describe('count', () => {
  it('sums events per UTC day and sends nothing for today', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }));
    await count('popup.open', T0);
    await Promise.all([count('popup.open', T0), count('page.links', T0)]);
    expect(await stored()).toEqual({ '2026-10-25': { 'popup.open': 2, 'page.links': 1 } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['before the Terms are accepted', { termsAccepted: '' }],
    ['with the switch off', { usageStats: false }],
    ['in offline mode', { offline: true }],
  ])('counts nothing %s', async (_, s) => {
    await allow(s);
    await count('popup.open', T0);
    expect(await stored()).toBeUndefined();
  });
});

describe('sendDue', () => {
  it('sends a finished day once, anonymously, and keeps today', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }));
    await count('axe.run', T0);
    await count('popup.open', T0 + DAY);
    const [call] = calls(fetchMock);
    expect(calls(fetchMock)).toHaveLength(1);
    expect(call!.url).toBe(ENDPOINT);
    expect(call!.init.credentials).toBe('omit');
    expect(call!.init.headers).toEqual({ 'Content-Type': 'application/json' });
    const body = JSON.parse(String(call!.init.body));
    expect(body).toMatchObject({
      schema: 1,
      day: '2026-10-25',
      browser: 'chrome',
      build: 'dev',
      lang: 'en',
      signedIn: true,
      counts: { 'axe.run': 1 },
    });
    expect(Object.keys(body).sort()).toEqual(
      [
        'browser',
        'build',
        'counts',
        'day',
        'flags',
        'lang',
        'schema',
        'signedIn',
        'version',
      ].sort(),
    );
    expect(await stored()).toEqual({ '2026-10-26': { 'popup.open': 1 } });
  });

  it('keeps a day after a server or network error and retries after an hour', async () => {
    let fail: 'server' | 'network' | null = 'server';
    const fetchMock = stubFetch(() => {
      if (fail === 'network') throw new TypeError('Failed to fetch');
      return new Response(null, { status: fail ? 503 : 204 });
    });
    await count('axe.run', T0);
    await sendDue(T0 + DAY);
    expect(await stored()).toEqual({ '2026-10-25': { 'axe.run': 1 } });
    await sendDue(T0 + DAY + 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fail = 'network';
    await sendDue(T0 + DAY + 3_600_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fail = null;
    await sendDue(T0 + DAY + 7_200_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await stored()).toEqual({});
  });

  it('drops a day the app refuses, and days older than a week unsent', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 422 }));
    await count('axe.run', T0 - 9 * DAY);
    await count('axe.run', T0 - DAY);
    await sendDue(T0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await stored()).toEqual({});
  });

  it('sends nothing once usage statistics are off', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }));
    await count('axe.run', T0);
    await allow({ usageStats: false });
    await sendDue(T0 + DAY);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports Edge from its user agent', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/141.0 Safari/537.36 Edg/141.0' });
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }));
    await count('axe.run', T0);
    await sendDue(T0 + DAY);
    expect(JSON.parse(String(calls(fetchMock)[0]!.init.body)).browser).toBe('edge');
  });
});

describe('rate limits and timeouts', () => {
  it.each([408, 429])('keeps a day the app answers with %i for a retry', async (status) => {
    stubFetch(() => new Response(null, { status }));
    await count('axe.run', T0);
    await sendDue(T0 + DAY);
    expect(await stored()).toEqual({ '2026-10-25': { 'axe.run': 1 } });
  });

  it('sends nothing in offline mode', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }));
    await count('axe.run', T0);
    await fakeBrowser.storage.local.set({
      [SETTINGS_KEY]: { termsAccepted: TERMS_VERSION, ...OPTED_IN, offline: true },
    });
    await sendDue(T0 + DAY);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps counting while a report is in flight', async () => {
    let release!: () => void;
    stubFetch(
      () => new Promise<Response>((r) => (release = () => r(new Response(null, { status: 204 })))),
    );
    await count('axe.run', T0);
    const sending = sendDue(T0 + DAY);
    await new Promise((r) => setTimeout(r, 0));
    await count('popup.open', T0 + DAY);
    expect(await stored()).toMatchObject({ '2026-10-26': { 'popup.open': 1 } });
    release();
    await sending;
    expect(await stored()).toEqual({ '2026-10-26': { 'popup.open': 1 } });
  });
});

describe('error counts', () => {
  it('follow the error report switch, not the usage switch', async () => {
    await allow({ usageStats: false });
    await count('popup.open', T0);
    await count('error.axe', T0);
    expect(await stored()).toEqual({ '2026-10-25': { 'error.axe': 1 } });
  });

  it('are sent without the settings when usage statistics are off', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }));
    await allow({ usageStats: false });
    await count('error.axe', T0);
    await sendDue(T0 + DAY);
    const body = JSON.parse(String(calls(fetchMock)[0]!.init.body));
    expect(body.counts).toEqual({ 'error.axe': 1 });
    expect(body.flags).toBeUndefined();
  });
});

describe('pruneUsage', () => {
  it('drops the counters of a switch turned off and keeps the rest', async () => {
    await count('popup.open', T0);
    await count('error.axe', T0);
    await allow({ usageStats: false });
    await pruneUsage();
    expect(await stored()).toEqual({ '2026-10-25': { 'error.axe': 1 } });
    await allow({ usageStats: false, errorReports: false });
    await pruneUsage();
    expect(await stored()).toBeUndefined();
  });

  it('removes days left empty', async () => {
    await count('popup.open', T0);
    await allow({ usageStats: false });
    await pruneUsage();
    expect(await stored()).toEqual({});
  });
});
