import type { TabContext } from '../lib/messages';
import type { Settings } from '../lib/settings';
import type { PageSnapshot } from '../lib/types';
import type { PageKey } from './nav';

export interface PageProps {
  page: PageKey;
  ctx: TabContext;
  snap: PageSnapshot;
  settings: Settings;
  go: (page: PageKey) => void;
  reload: () => void; // re-read the worker's context (after sign-in, a switch, …)
}
