import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  onCLS,
  onFCP,
  onINP,
  onLCP,
  onTTFB,
  type MetricWithAttribution,
} from 'web-vitals/attribution';
import type { LayoutShiftInfo, TabVitals, VitalSample } from '../lib/types';

// The only script that runs on every page: measures Core Web Vitals of this load on the
// device and reports them to the worker. Everything else, the LCP / layout-shift overlay
// included, is injected on demand when the popup opens.

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    const vitals: TabVitals = { url: location.href, metrics: {}, shifts: [] };
    const shiftNodes: { value: number; nodes: WeakRef<Node>[] }[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    let last = '';
    // At most one report a second, and only when something changed.
    const report = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        vitals.shifts = shiftNodes.map((s): LayoutShiftInfo => ({
          value: s.value,
          selectors: s.nodes.map((n) => describe(n.deref())).filter(Boolean),
        }));
        const body = JSON.stringify(vitals);
        if (body === last) return;
        last = body;
        try {
          browser.runtime.sendMessage({ type: 'vitals:report', ...vitals }).catch(() => {});
        } catch {
          // The extension was updated or removed; this orphaned script has nobody to tell.
        }
      }, 1000);
    };

    const record = (m: MetricWithAttribution) => {
      const a = m.attribution as {
        target?: string;
        largestShiftTarget?: string;
        interactionTarget?: string;
      };
      const sample: VitalSample = {
        name: m.name as VitalSample['name'],
        value: m.value,
        rating: m.rating,
        target: a.target ?? a.largestShiftTarget ?? a.interactionTarget,
      };
      vitals.metrics[sample.name] = sample;
      report();
    };
    const opts = { reportAllChanges: true };
    onLCP(record, opts);
    onCLS(record, opts);
    onINP(record, opts);
    onFCP(record);
    onTTFB(record);

    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: { node?: Node }[];
        })[]) {
          if (e.hadRecentInput) continue;
          shiftNodes.push({
            value: e.value,
            nodes: (e.sources ?? []).flatMap((s) => (s.node ? [new WeakRef(s.node)] : [])),
          });
        }
        // Keep the ten largest: long-lived pages can shift thousands of times.
        shiftNodes.sort((a, b) => b.value - a.value).splice(10);
        report();
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      // layout-shift is Chromium only; nothing to collect elsewhere.
    }
  },
});

function describe(node: Node | undefined): string {
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el) return '';
  const id = el.id ? `#${el.id.slice(0, 40)}` : '';
  const cls = [...el.classList]
    .slice(0, 2)
    .map((c) => `.${c.slice(0, 40)}`)
    .join('');
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}
