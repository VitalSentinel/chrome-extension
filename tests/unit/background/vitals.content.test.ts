import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals/attribution';
import script from '../../../src/entrypoints/vitals.content';

const webVitals = { onCLS, onFCP, onINP, onLCP, onTTFB };

vi.mock('web-vitals/attribution', () => ({
  onCLS: vi.fn(),
  onFCP: vi.fn(),
  onINP: vi.fn(),
  onLCP: vi.fn(),
  onTTFB: vi.fn(),
}));

type Metric = {
  name: string;
  value: number;
  rating: string;
  attribution: Record<string, unknown>;
  entries: unknown[];
};
type ShiftEntry = { value: number; hadRecentInput: boolean; sources?: { node?: Node }[] };

const callback = (fn: keyof typeof webVitals) =>
  vi.mocked(webVitals[fn] as unknown as (cb: (m: Metric) => void) => void).mock.calls[0][0];
const metric = (
  name: string,
  value: number,
  rating: string,
  attribution: Record<string, unknown> = {},
  entries: unknown[] = [],
): Metric => ({
  name,
  value,
  rating,
  attribution,
  entries,
});

let sendMessage: ReturnType<typeof vi.fn>;
let observed: ((list: { getEntries: () => ShiftEntry[] }) => void) | undefined;
let observe: ReturnType<typeof vi.fn>;

function el(tag: string, attrs: { id?: string; className?: string; rect?: Partial<DOMRect> } = {}) {
  const e = document.createElement(tag);
  if (attrs.id) e.id = attrs.id;
  if (attrs.className) e.className = attrs.className;
  const r = { left: 0, top: 0, width: 0, height: 0, ...attrs.rect };
  e.getBoundingClientRect = () => r as DOMRect;
  document.body.append(e);
  return e;
}

const shifts = (...entries: ShiftEntry[]) => observed!({ getEntries: () => entries });

const overlay = (msg: { type: string; on?: boolean }) =>
  new Promise<unknown>((resolve) => {
    void fakeBrowser.runtime.onMessage.trigger(msg, {}, resolve).then(() => resolve('no response'));
  });

beforeEach(() => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  vi.useFakeTimers();
  document.body.innerHTML = '';
  document.getElementById('vitalsentinel-overlay')?.remove();
  sendMessage = vi.fn(async () => undefined);
  fakeBrowser.runtime.sendMessage = sendMessage as never;
  observed = undefined;
  observe = vi.fn();
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      constructor(cb: typeof observed) {
        observed = cb;
      }
      observe = observe;
    },
  );
  script.main({} as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('vitals collection', () => {
  it('subscribes to every metric, reporting all changes of the core three', () => {
    for (const fn of ['onLCP', 'onCLS', 'onINP'] as const)
      expect(webVitals[fn]).toHaveBeenCalledWith(expect.any(Function), { reportAllChanges: true });
    for (const fn of ['onFCP', 'onTTFB'] as const)
      expect(webVitals[fn]).toHaveBeenCalledWith(expect.any(Function));
    expect(observe).toHaveBeenCalledWith({ type: 'layout-shift', buffered: true });
  });

  it('reports at most once a second, with everything collected by then', async () => {
    callback('onLCP')(metric('LCP', 2_900, 'needs-improvement', { target: 'main > img.hero' }));
    await vi.advanceTimersByTimeAsync(600);
    callback('onCLS')(metric('CLS', 0.31, 'poor', { largestShiftTarget: 'div#banner' }));
    callback('onINP')(metric('INP', 180, 'good', { interactionTarget: 'button.add-to-cart' }));
    callback('onTTFB')(metric('TTFB', 420, 'good'));
    await vi.advanceTimersByTimeAsync(399);
    expect(sendMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'vitals:report',
      url: location.href,
      metrics: {
        LCP: { name: 'LCP', value: 2_900, rating: 'needs-improvement', target: 'main > img.hero' },
        CLS: { name: 'CLS', value: 0.31, rating: 'poor', target: 'div#banner' },
        INP: { name: 'INP', value: 180, rating: 'good', target: 'button.add-to-cart' },
        TTFB: { name: 'TTFB', value: 420, rating: 'good', target: undefined },
      },
      shifts: [],
    });
  });

  it('sends a new report only when something changed', async () => {
    callback('onLCP')(metric('LCP', 1_200, 'good'));
    await vi.advanceTimersByTimeAsync(1_000);
    callback('onLCP')(metric('LCP', 1_200, 'good'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    callback('onLCP')(metric('LCP', 3_100, 'needs-improvement'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1][0].metrics.LCP.value).toBe(3_100);
  });

  it('reports the ten largest layout shifts without recent input, with selectors', async () => {
    const hero = el('div', { id: 'hero', className: 'banner wide extra' });
    const text = document.createTextNode('Late text');
    el('p', { className: 'lede' }).append(text);
    shifts(
      { value: 0.12, hadRecentInput: false, sources: [{ node: hero }, { node: text }, {}] },
      { value: 0.5, hadRecentInput: true, sources: [{ node: hero }] },
      ...Array.from({ length: 6 }, (_, i) => ({ value: 0.001 * (i + 1), hadRecentInput: false })),
    );
    // A long-lived page keeps shifting; only the ten largest are kept.
    shifts(
      ...Array.from({ length: 5 }, (_, i) => ({ value: 0.001 * (i + 7), hadRecentInput: false })),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    const reported = sendMessage.mock.calls[0][0].shifts as {
      value: number;
      selectors: string[];
    }[];
    expect(reported).toHaveLength(10);
    expect(reported[0]).toEqual({ value: 0.12, selectors: ['div#hero.banner.wide', 'p.lede'] });
    expect(reported.slice(1).map((s) => Number(s.value.toFixed(3)))).toEqual([
      0.011, 0.01, 0.009, 0.008, 0.007, 0.006, 0.005, 0.004, 0.003,
    ]);
  });

  it('shortens long ids and class names in selectors', async () => {
    el('div', { id: 'x'.repeat(60), className: `${'c'.repeat(50)} b` });
    shifts({
      value: 0.2,
      hadRecentInput: false,
      sources: [{ node: document.body.lastElementChild! }],
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sendMessage.mock.calls[0][0].shifts[0].selectors).toEqual([
      `div#${'x'.repeat(40)}.${'c'.repeat(40)}.b`,
    ]);
  });

  it.each([
    {
      name: 'a rejected report (the worker may be asleep)',
      fail: () => sendMessage.mockRejectedValue(new Error('Could not establish connection.')),
    },
    {
      name: 'a throw from an orphaned script',
      fail: () =>
        sendMessage.mockImplementation(() => {
          throw new Error('Extension context invalidated.');
        }),
    },
  ])('ignores $name', async ({ fail }) => {
    fail();
    callback('onFCP')(metric('FCP', 900, 'good'));
    await expect(vi.advanceTimersByTimeAsync(1_000)).resolves.not.toThrow();
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it('still collects metrics where layout-shift is unsupported', async () => {
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        observe() {
          throw new TypeError(
            "Failed to execute 'observe': entryTypes contained no supported types",
          );
        }
      },
    );
    fakeBrowser.reset();
    expect(() => script.main({} as never)).not.toThrow();
  });
});

describe('messages', () => {
  // The popup injects the overlay with the analyser; the every-page script only reports.
  it('answers no message, the overlay included', async () => {
    expect(await overlay({ type: 'overlay', on: true })).toBe('no response');
    expect(document.getElementById('vitalsentinel-overlay')).toBeNull();
  });
});
