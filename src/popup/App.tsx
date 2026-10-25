import type { FunctionComponent } from 'preact';
import { browser } from 'wxt/browser';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TabContext } from '../lib/messages';
import type { Settings } from '../lib/settings';
import type { PageSnapshot } from '../lib/types';
import { isWebUrl } from '../lib/url';
import { Button, EmptyState, ErrorNote, Loading, Page } from '../ui/kit';
import { mergeVitals } from '../lib/bufferedVitals';
import { pageCounts } from './badges';
import { TERMS_VERSION } from '../lib/config';
import { Onboarding } from './Agreement';
import {
  context,
  currentTabId,
  reloadTab,
  settings as loadSettings,
  snapshot,
  track,
} from './data';
import { lastPageKey, loaderFor, restorePage, type LastPage, type PageKey } from './nav';
import { Sidebar } from './Sidebar';
import type { PageProps } from './types';

const modules = new Map<string, FunctionComponent<PageProps>>();

function usePageComponent(page: PageKey) {
  const loader = loaderFor(page);
  const [comp, setComp] = useState<FunctionComponent<PageProps> | null>(
    () => modules.get(loader.toString()) ?? null,
  );
  useEffect(() => {
    const key = loader.toString();
    if (modules.has(key)) return setComp(() => modules.get(key)!);
    setComp(null);
    let live = true;
    loader().then(
      (m) => {
        modules.set(key, m.default);
        if (live) setComp(() => m.default);
      },
      () => {
        track('error.report');
        if (!live) return;
        setComp(() => () => (
          <Page title="This report could not be loaded">
            <ErrorNote>Close and reopen the popup to try again.</ErrorNote>
          </Page>
        ));
      },
    );
    return () => {
      live = false;
    };
  }, [loader]);
  return comp;
}

const GLOBE = [
  'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  'M2 12h20',
  'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
];
const ALERT = ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 8v4', 'M12 16h.01'];
const GENERIC = 'This page cannot be analysed.';

/** The analysis failed: reloading the tab is what usually helps, so it leads. */
function Failed({
  error,
  retry,
  reloadPage,
}: {
  error: string;
  retry: () => void;
  reloadPage: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <EmptyState
      tone="bad"
      icon={ALERT}
      title="This page could not be analysed"
      actions={
        <>
          <Button
            variant="primary"
            size="md"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await reloadPage().catch(() => undefined);
              setBusy(false);
            }}
          >
            {busy ? 'Reloading…' : 'Reload page'}
          </Button>
          <Button size="md" disabled={busy} onClick={retry}>
            Try again
          </Button>
        </>
      }
    >
      <p>
        The page did not answer. Reload it and the report starts again – a page that is still
        loading, or was open before the extension, usually needs that.
      </p>
      {error !== GENERIC && <p class="mono break-words text-xs text-ink-3">{error}</p>}
    </EmptyState>
  );
}

export function App() {
  const [ctx, setCtx] = useState<TabContext | null>(null);
  const [snap, setSnap] = useState<PageSnapshot | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<PageKey>('overview');

  // `first` also reopens the page last open for this tab and URL, in the same render. Only the
  // newest reload sets the context: storage changes can start several close together.
  const reloads = useRef(0);
  const reload = async (first = false) => {
    const seq = ++reloads.current;
    try {
      const tabId = await currentTabId();
      const key = lastPageKey(tabId);
      const [c, s, saved] = await Promise.all([
        context(tabId),
        loadSettings(),
        first ? browser.storage.session.get(key) : null,
      ]);
      if (saved) setPage(restorePage(saved[key] as LastPage | undefined, c.url, c.auth.signedIn));
      if (seq !== reloads.current) return c;
      setCtx(c);
      setSettings(s);
      return c;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  };

  const analyse = (c: TabContext | null) => {
    if (!c || !isWebUrl(c.url)) return;
    snapshot(c.tabId).then(setSnap, (e: Error) => {
      track('error.analysis');
      setError(e.message);
    });
  };

  useEffect(() => {
    void reload(true).then((c) => {
      if (c) track('popup.open');
      analyse(c);
    });
  }, []);

  // The worker answers the context from its cache and loads the account in the background;
  // when that lands in storage, take the new context (the page is not analysed again).
  useEffect(() => {
    const onChange = (changes: Record<string, unknown>) => {
      if (Object.keys(changes).some((k) => k.startsWith('app:'))) void reload();
    };
    browser.storage.local.onChanged.addListener(onChange);
    return () => browser.storage.local.onChanged.removeListener(onChange);
  }, []);

  // Core Web Vitals keep arriving while the popup is open (INP, late CLS); follow them live.
  useEffect(() => {
    if (!ctx) return;
    const key = `vitals:${ctx.tabId}`;
    const onChange = (changes: Record<string, { newValue?: unknown }>) => {
      const v = changes[key]?.newValue as TabContext['vitals'] | undefined;
      if (v && v.url === ctx.url) setCtx((c) => (c ? { ...c, vitals: v } : c));
    };
    browser.storage.session.onChanged.addListener(onChange);
    return () => browser.storage.session.onChanged.removeListener(onChange);
    // Re-subscribe only when the tab or URL changes, not on every context update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.tabId, ctx?.url]);

  // The collector's live vitals, completed from the page's buffered entries when it missed some.
  const view = useMemo(
    () => (ctx ? { ...ctx, vitals: mergeVitals(ctx.vitals, snap?.bufferedVitals) } : null),
    [ctx, snap],
  );
  const counts = useMemo(() => (snap && view ? pageCounts(snap, view) : {}), [snap, view]);
  const Comp = usePageComponent(page);
  const ready = !!ctx;
  useEffect(() => {
    if (ready) track(`page.${page}`);
  }, [page, ready]);
  useEffect(() => {
    if (!ctx) return;
    const last: LastPage = { url: ctx.url, page };
    void browser.storage.session.set({ [lastPageKey(ctx.tabId)]: last });
    // Keyed on the tab and URL, so a live vitals update does not write it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, ctx?.tabId, ctx?.url]);

  if (!ctx || !settings) {
    return (
      <div class="flex h-[600px] items-center justify-center">
        {error ? <ErrorNote>{error}</ErrorNote> : <Loading label="Loading…" rows={0} />}
      </div>
    );
  }

  if (settings.termsAccepted !== TERMS_VERSION) {
    return (
      <div class="flex h-[600px] w-[800px] items-center justify-center overflow-hidden">
        <div class="w-[700px]">
          <Onboarding settings={settings} onAgree={setSettings} />
        </div>
      </div>
    );
  }

  const web = isWebUrl(ctx.url);
  return (
    <div class="flex h-[600px] w-[800px]">
      <Sidebar page={page} go={setPage} counts={counts} ctx={view!} reload={reload} />
      {/* Focusable so the report scrolls from the keyboard even without links in it. */}
      <main tabIndex={0} aria-label="Report" class="scroll-thin min-w-0 flex-grow overflow-y-auto">
        {!web ? (
          <EmptyState icon={GLOBE} title="Open a website to see its report">
            <p>
              Go to any http or https page and click the VitalSentinel icon. Browser pages, the
              Chrome Web Store and local files cannot be analysed.
            </p>
          </EmptyState>
        ) : error && !snap ? (
          <Failed
            error={error}
            retry={() => {
              setError(null);
              analyse(view);
            }}
            reloadPage={async () => {
              await reloadTab(view!.tabId);
              setError(null);
              analyse(await reload());
            }}
          />
        ) : !snap || !Comp ? (
          <div class="px-7 pt-6">
            <Loading rows={6} />
          </div>
        ) : (
          // eslint-disable-next-line react/static-components -- page modules are loaded once and cached
          <Comp
            page={page}
            ctx={view!}
            snap={snap}
            settings={settings}
            go={setPage}
            reload={() => void reload().then(analyse)}
          />
        )}
      </main>
    </div>
  );
}
