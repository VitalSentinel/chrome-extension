import { describe, expect, it } from 'vitest';
import {
  cookiePurpose,
  readConsentMode,
  scanTracking,
  trackerFor,
  type CookieRow,
} from '../../../src/lib/checks/tracking';
import type { RequestInfo } from '../../../src/lib/types';

const req = (host: string): RequestInfo => ({
  url: `https://${host}/x`,
  host,
  type: 'script',
  status: 200,
  t: 0,
  encoding: '',
  cacheControl: '',
  size: 0,
});
const cookie = (name: string, overrides: Partial<CookieRow> = {}): CookieRow => ({
  name,
  domain: '.example.com',
  purpose: cookiePurpose(name),
  secure: true,
  httpOnly: false,
  sameSite: 'lax',
  session: false,
  expires: null,
  ...overrides,
});

describe('trackerFor', () => {
  it.each([
    ['www.google-analytics.com', 'Google Analytics', 'analytics'],
    ['region1.analytics.google.com', 'Google Analytics', 'analytics'],
    ['www.googletagmanager.com', 'Google Tag Manager', 'analytics'],
    ['stats.g.doubleclick.net', 'Google Ads', 'marketing'],
    ['connect.facebook.net', 'Meta', 'marketing'],
    ['t.co', 'X (Twitter)', 'marketing'],
    ['mc.yandex.ru', 'Yandex Metrica', 'analytics'],
    ['js.hs-scripts.com', 'HubSpot', 'marketing'],
  ])('%s → %s', (host, vendor, purpose) => {
    expect(trackerFor(host)).toEqual({ vendor, purpose });
  });

  it('anchors on label boundaries', () => {
    expect(trackerFor('notfacebook.net')).toBeNull();
    expect(trackerFor('www.example.com')).toBeNull();
  });
});

describe('cookiePurpose', () => {
  it.each([
    ['_ga', 'analytics'],
    ['_ga_ABC123', 'analytics'],
    ['_hjSessionUser_1', 'analytics'],
    ['_fbp', 'marketing'],
    ['_gcl_au', 'marketing'],
    ['MUID', 'marketing'],
    ['OptanonConsent', 'necessary'],
    ['euconsent-v2', 'necessary'],
    ['PHPSESSID', 'necessary'],
    ['__Host-session', 'necessary'],
    ['theme', 'unknown'],
  ])('%s → %s', (name, purpose) => {
    expect(cookiePurpose(name)).toBe(purpose);
  });
});

describe('readConsentMode', () => {
  it('reads defaults and updates from gtag commands, later values winning', () => {
    const dataLayer: unknown[] = [
      { event: 'gtm.js', 'gtm.start': 1 },
      [
        'consent',
        'default',
        { ad_storage: 'denied', analytics_storage: 'denied', wait_for_update: 500, region: ['DE'] },
      ],
      { 0: 'consent', 1: 'default', 2: { ad_storage: 'granted' } }, // an arguments object copied as a plain object
      ['config', 'G-XYZ', { send_page_view: true }],
      ['consent', 'update', { analytics_storage: 'granted' }],
    ];
    expect(readConsentMode(dataLayer)).toEqual({
      defaults: { ad_storage: 'granted', analytics_storage: 'denied' },
      updates: { analytics_storage: 'granted' },
    });
  });

  it('is null without consent commands', () => {
    expect(readConsentMode([])).toBeNull();
    expect(
      readConsentMode([null, 42, ['consent', 'default'], ['event', 'page_view', {}]]),
    ).toBeNull();
  });

  it('notices consent calls even with an unknown sub-command', () => {
    expect(readConsentMode([['consent', 'other', { ad_storage: 'denied' }]])).toEqual({
      defaults: {},
      updates: {},
    });
  });
});

describe('scanTracking', () => {
  const fullConsent = {
    defaults: {
      ad_storage: 'denied',
      analytics_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    },
    updates: {},
  };

  it('counts requests per vendor, most first', () => {
    const r = scanTracking(
      [
        req('www.google-analytics.com'),
        req('connect.facebook.net'),
        req('region1.google-analytics.com'),
        req('cdn.example.com'),
      ],
      [],
      fullConsent,
      true,
    );
    expect(r.trackers).toEqual([
      { vendor: 'Google Analytics', purpose: 'analytics', requests: 2 },
      { vendor: 'Meta', purpose: 'marketing', requests: 1 },
    ]);
  });

  it('flags trackers and cookies set while the banner is waiting for a choice', () => {
    const cookies = [
      cookie('_ga'),
      cookie('_fbp'),
      cookie('PHPSESSID'),
      cookie('theme', { secure: false }),
    ];
    const r = scanTracking(
      [req('www.googletagmanager.com'), req('connect.facebook.net')],
      cookies,
      fullConsent,
      true,
    );
    expect(r.consentStored).toBe(false);
    expect(r.beforeConsent).toEqual({ trackers: 2, cookies: 2 });
    expect(r.findings).toEqual([
      { id: 'track.beforeConsent', level: 'bad', params: { trackers: 2, cookies: 2 } },
    ]);
  });

  it('does not judge pre-consent loading once a choice is stored', () => {
    const r = scanTracking(
      [req('connect.facebook.net')],
      [cookie('OptanonConsent'), cookie('_fbp')],
      null,
      true,
    );
    expect(r).toMatchObject({ consentStored: true, beforeConsent: null, findings: [] });
  });

  it('wants a CMP for marketing tags and Consent Mode for Google tags', () => {
    const r = scanTracking([req('www.googleadservices.com')], [], null, false);
    expect(r.findings.map((f) => f.id)).toEqual(['track.noCmp', 'track.noConsentMode']);
  });

  it('lists Consent Mode v2 keys missing from the defaults', () => {
    const r = scanTracking(
      [req('www.googletagmanager.com')],
      [],
      { defaults: { ad_storage: 'denied', analytics_storage: 'denied' }, updates: {} },
      false,
    );
    expect(r.findings).toEqual([
      { id: 'track.consentKeyMissing', level: 'warn', params: { key: 'ad_user_data' } },
      { id: 'track.consentKeyMissing', level: 'warn', params: { key: 'ad_personalization' } },
    ]);
  });

  it('counts known cookies without the Secure flag', () => {
    const r = scanTracking(
      [],
      [cookie('_ga', { secure: false }), cookie('unknown_one', { secure: false })],
      null,
      false,
    );
    expect(r.findings).toEqual([{ id: 'track.insecureCookies', level: 'info', params: { n: 1 } }]);
  });
});
