import axe from 'axe-core';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

// Injected only when the Accessibility page opens (axe-core is large).
export default defineUnlistedScript(() => {
  (globalThis as { __vsAxe?: () => Promise<unknown> }).__vsAxe = async () => {
    const r = await axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
      resultTypes: ['violations'],
      // Preloading fetches every stylesheet again, which fails on cross-origin CSS; the rules
      // we run do not need it.
      preload: false,
    });
    // Only what the popup shows, so the message stays small.
    return {
      violations: r.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? 'minor',
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes
          .slice(0, 20)
          .map((n) => ({ target: n.target.join(' '), summary: n.failureSummary ?? '' })),
        count: v.nodes.length,
      })),
      passes: r.passes.length,
      passIds: r.passes.slice(0, 8).map((p) => p.id),
    };
  };
});
