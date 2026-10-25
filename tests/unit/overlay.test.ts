import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawOverlay, overlayShown, shiftedElements } from '../../src/lib/overlay';

type Entry = Record<string, unknown>;
let buffered: Record<string, Entry[]>;

function el(tag: string, rect: Partial<DOMRect> = {}) {
  const e = document.createElement(tag);
  const r = { left: 0, top: 0, width: 0, height: 0, ...rect };
  e.getBoundingClientRect = () => r as DOMRect;
  document.body.append(e);
  return e;
}

/** The overlay's boxes, read through the host because its shadow root is closed. */
const host = () => document.getElementById('vitalsentinel-overlay');

beforeEach(() => {
  document.body.innerHTML = '';
  host()?.remove();
  buffered = {};
  // Delivers the buffered entries of the observed type asynchronously, as Chrome does.
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      constructor(private cb: (l: { getEntries: () => Entry[] }) => void) {}
      observe({ type }: { type: string }) {
        const entries = buffered[type];
        if (entries?.length) setTimeout(() => this.cb({ getEntries: () => entries }), 0);
      }
      disconnect() {}
    },
  );
});
afterEach(() => {
  host()?.remove();
  vi.unstubAllGlobals();
});

describe('shiftedElements', () => {
  it('sums shifts per element, skips input-driven and tiny ones, largest first, ten at most', () => {
    const a = el('div');
    const b = el('p');
    const text = document.createTextNode('moved');
    b.append(text);
    const gone = document.createElement('span'); // not in the page any more
    const many = Array.from({ length: 12 }, () => el('li'));
    const out = shiftedElements([
      { value: 0.05, hadRecentInput: false, sources: [{ node: a }, { node: text }] },
      { value: 0.03, hadRecentInput: false, sources: [{ node: a }, { node: gone }] },
      { value: 0.5, hadRecentInput: true, sources: [{ node: b }] },
      { value: 0.0004, hadRecentInput: false, sources: [{ node: el('i') }] },
      ...many.map((n, i) => ({
        value: 0.002 + i / 1000,
        hadRecentInput: false,
        sources: [{ node: n }],
      })),
    ] as never);
    expect(out[0]).toEqual({ el: a, value: 0.08 });
    expect(out[1]).toEqual({ el: b, value: 0.05 });
    expect(out).toHaveLength(10);
    expect(out.some((s) => s.el === gone)).toBe(false);
  });
});

describe('drawOverlay', () => {
  it('outlines the LCP element and shifted elements from buffered entries, then removes them', async () => {
    const img = el('img', { left: 10, top: 200, width: 600, height: 300 });
    const ad = el('aside', { left: 0, top: 400, width: 300, height: 250 });
    const hidden = el('span');
    buffered['largest-contentful-paint'] = [
      { element: el('h1', { width: 5, height: 5 }) },
      { element: img },
    ];
    buffered['layout-shift'] = [
      { value: 0.08, hadRecentInput: false, sources: [{ node: ad }, { node: hidden }] },
    ];
    expect(await drawOverlay(true)).toEqual({ lcp: true, shifts: 1 });
    expect(overlayShown()).toBe(true);
    // Fixed to the window, so boxes can follow sticky and scrolled elements.
    expect(host()!.style.position).toBe('fixed');
    expect(host()!.style.pointerEvents).toBe('none');

    // Drawing again replaces the old overlay instead of stacking a second one.
    await drawOverlay(true);
    expect(document.querySelectorAll('#vitalsentinel-overlay')).toHaveLength(1);

    expect(await drawOverlay(false)).toEqual({ lcp: false, shifts: 0 });
    expect(overlayShown()).toBe(false);
  });

  it('finds a replaced LCP image by its URL', async () => {
    const img = el('img', { width: 100, height: 100 }) as HTMLImageElement;
    img.src = 'https://cdn.example.com/hero.jpg';
    buffered['largest-contentful-paint'] = [
      { element: document.createElement('img'), url: 'https://cdn.example.com/hero.jpg' },
    ];
    expect(await drawOverlay(true)).toEqual({ lcp: true, shifts: 0 });
  });

  it('draws an empty overlay when nothing was buffered or the API is missing', async () => {
    expect(await drawOverlay(true)).toEqual({ lcp: false, shifts: 0 });
    vi.stubGlobal('PerformanceObserver', undefined);
    expect(await drawOverlay(true)).toEqual({ lcp: false, shifts: 0 });
    expect(overlayShown()).toBe(true);
  });

  it('keeps one overlay when the switch is toggled quickly', async () => {
    const first = drawOverlay(true);
    const second = drawOverlay(true);
    await Promise.all([first, second]);
    expect(document.querySelectorAll('#vitalsentinel-overlay')).toHaveLength(1);
    // On, then off before the entries were read: nothing is left on the page.
    const on = drawOverlay(true);
    await drawOverlay(false);
    await on;
    expect(overlayShown()).toBe(false);
  });

  it('stops following scrolls once removed', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    await drawOverlay(true);
    await drawOverlay(false);
    expect(remove.mock.calls.map(([type]) => type)).toEqual(['scroll', 'resize']);
  });
});
