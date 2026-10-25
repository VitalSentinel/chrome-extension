// "Show on page" in Performance: outlines the LCP element and the elements that shifted, in
// the inspected tab. Injected with the analyser when the popup asks, never on every page, and
// read from the page's buffered performance entries, so it also works on tabs that were open
// before the extension started. Free of chrome.* so it is unit-tested against happy-dom.

export const OVERLAY_ID = 'vitalsentinel-overlay';

export interface OverlayResult {
  lcp: boolean;
  shifts: number;
}

type LcpEntry = PerformanceEntry & { element?: Element | null; url?: string; id?: string };
type ShiftEntry = PerformanceEntry & {
  value: number;
  hadRecentInput: boolean;
  sources?: { node?: Node | null }[];
};
type Host = HTMLElement & { vsStop?: () => void };

const LCP_COLOUR = '#9333EA';
const SHIFT_COLOUR = '#DC2626';
/** More boxes than this hide the page instead of explaining it. */
const MAX_SHIFT_BOXES = 10;
/** Shifts this small round to 0.000 in a label and are noise on screen. */
const MIN_SHIFT = 0.001;

/** The buffered entries of one type; resolves empty when there are none or no support. */
function buffered<T extends PerformanceEntry>(win: Window, type: string): Promise<T[]> {
  return new Promise((resolve) => {
    try {
      const po = new PerformanceObserver((list) => {
        po.disconnect();
        resolve(list.getEntries() as T[]);
      });
      po.observe({ type, buffered: true });
      // The callback never runs when nothing was buffered.
      win.setTimeout(() => {
        po.disconnect();
        resolve([]);
      }, 250);
    } catch {
      resolve([]);
    }
  });
}

/** The LCP element, else the image whose URL the entry names (the node was replaced). */
function lcpElement(doc: Document, entries: LcpEntry[]): Element | null {
  const last = entries.at(-1);
  if (!last) return null;
  if (last.element?.isConnected) return last.element;
  if (last.id) {
    const byId = doc.getElementById(last.id);
    if (byId) return byId;
  }
  if (last.url)
    return (
      [...doc.querySelectorAll('img')].find(
        (img) => img.currentSrc === last.url || img.src === last.url,
      ) ?? null
    );
  return null;
}

/** Elements that moved, each once with the sum of its shifts, largest first. */
export function shiftedElements(entries: ShiftEntry[]): { el: Element; value: number }[] {
  const score = new Map<Element, number>();
  for (const e of entries) {
    if (e.hadRecentInput) continue;
    for (const s of e.sources ?? []) {
      const node = s.node;
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      if (el?.isConnected) score.set(el, (score.get(el) ?? 0) + e.value);
    }
  }
  return [...score]
    .map(([el, value]) => ({ el, value }))
    .filter((s) => s.value >= MIN_SHIFT)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_SHIFT_BOXES);
}

/** Whether the overlay is on the page now, so the popup's switch can show it. */
export function overlayShown(doc: Document = document): boolean {
  return !!doc.getElementById(OVERLAY_ID);
}

/**
 * Draws or removes the overlay. Boxes follow their elements on scroll and resize, so sticky
 * headers, fixed bars and inner scroll containers stay outlined in the right place.
 */
let drawing = 0;

export async function drawOverlay(on: boolean, win: Window = window): Promise<OverlayResult> {
  const doc = win.document;
  const clear = () => {
    const old = doc.getElementById(OVERLAY_ID) as Host | null;
    old?.vsStop?.();
    old?.remove();
  };
  const call = ++drawing;
  clear();
  if (!on) return { lcp: false, shifts: 0 };

  const [lcpEntries, shiftEntries] = await Promise.all([
    buffered<LcpEntry>(win, 'largest-contentful-paint'),
    buffered<ShiftEntry>(win, 'layout-shift'),
  ]);
  // A later call (on or off) took over while the entries were read; it decides.
  if (call !== drawing) return { lcp: false, shifts: 0 };
  const targets: { el: Element; colour: string; label: string; fill: boolean }[] = [];
  const lcp = lcpElement(doc, lcpEntries);
  if (lcp) targets.push({ el: lcp, colour: LCP_COLOUR, label: 'LCP element', fill: true });
  for (const s of shiftedElements(shiftEntries))
    targets.push({
      el: s.el,
      colour: SHIFT_COLOUR,
      label: `Layout shift ${s.value.toFixed(3)}`,
      fill: false,
    });

  const host = doc.createElement('div') as Host;
  host.id = OVERLAY_ID;
  host.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden;margin:0;padding:0;border:0';
  const root = host.attachShadow({ mode: 'closed' });
  const boxes = targets.map((t) => {
    const b = doc.createElement('div');
    b.style.cssText = `position:absolute;outline:3px solid ${t.colour};outline-offset:-1px;background:${t.fill ? `${t.colour}1f` : 'transparent'};box-sizing:border-box;font:600 11px/1 Inter,system-ui,sans-serif`;
    const tag = doc.createElement('span');
    tag.textContent = t.label;
    tag.style.cssText = `position:absolute;left:-1px;padding:3px 6px;border-radius:999px;background:${t.colour};color:#fff;white-space:nowrap`;
    b.append(tag);
    root.append(b);
    return { ...t, box: b, tag };
  });

  const place = () => {
    for (const { el, box, tag } of boxes) {
      const r = el.getBoundingClientRect();
      const hidden = !el.isConnected || (!r.width && !r.height);
      box.style.display = hidden ? 'none' : 'block';
      if (hidden) continue;
      box.style.left = `${r.left}px`;
      box.style.top = `${r.top}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      // Inside the box when there is no room above it at the top of the window.
      tag.style.top = r.top < 20 ? '2px' : '-19px';
    }
  };
  let frame = 0;
  const schedule = () => {
    if (!frame)
      frame = win.requestAnimationFrame(() => {
        frame = 0;
        place();
      });
  };
  win.addEventListener('scroll', schedule, { capture: true, passive: true });
  win.addEventListener('resize', schedule, { passive: true });
  host.vsStop = () => {
    win.removeEventListener('scroll', schedule, { capture: true });
    win.removeEventListener('resize', schedule);
    if (frame) win.cancelAnimationFrame(frame);
  };
  place();
  doc.documentElement.append(host);

  const visible = (b: (typeof boxes)[number]) => b.box.style.display !== 'none';
  return {
    lcp: boxes.some((b) => b.el === lcp && b.colour === LCP_COLOUR && visible(b)),
    shifts: boxes.filter((b) => b.colour === SHIFT_COLOUR && visible(b)).length,
  };
}
