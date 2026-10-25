import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { bufferedVitals } from '../lib/bufferedVitals';
import { drawOverlay } from '../lib/overlay';
import { collectSnapshot } from '../lib/snapshot';

// Injected into the current tab when the popup opens; the popup then calls __vsSnapshot(),
// and __vsOverlay() for Performance › Show on page.
export default defineUnlistedScript(() => {
  const g = globalThis as {
    __vsSnapshot?: () => Promise<unknown>;
    __vsOverlay?: (on: boolean) => Promise<unknown>;
  };
  g.__vsSnapshot = async () => ({
    ...collectSnapshot(document, window, location.href),
    bufferedVitals: await bufferedVitals(window, location.href),
  });
  g.__vsOverlay = (on) => drawOverlay(on, window);
});
