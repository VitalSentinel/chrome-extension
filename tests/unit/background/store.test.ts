import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  cached,
  cachedNow,
  failedKey,
  forgetLoads,
  getLocal,
  getSession,
  getSettings,
  RETRY_MS,
  setLocal,
  setSession,
} from '../../../src/background/store';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../../../src/lib/settings';

beforeEach(() => fakeBrowser.reset());

describe('local and session storage', () => {
  it('round-trips values in each area separately', async () => {
    await setLocal('k', { a: 1 });
    await setSession('k', 'session value');
    expect(await getLocal('k')).toEqual({ a: 1 });
    expect(await getSession('k')).toBe('session value');
  });

  it('returns undefined for a missing key', async () => {
    expect(await getLocal('missing')).toBeUndefined();
    expect(await getSession('missing')).toBeUndefined();
  });
});

describe('getSettings', () => {
  it('returns the defaults when nothing is stored', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('merges stored keys over the defaults', async () => {
    await fakeBrowser.storage.local.set({
      [SETTINGS_KEY]: { offline: true, googleApiKey: 'AIza-test' },
    });
    expect(await getSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      offline: true,
      googleApiKey: 'AIza-test',
    });
  });
});

describe('cached', () => {
  const TTL = 60_000;

  it('loads and stores the value with its write time on a miss', async () => {
    const load = vi.fn(async () => ['a', 'b']);
    expect(await cached('app:x', TTL, load, 1_000)).toEqual(['a', 'b']);
    expect(load).toHaveBeenCalledOnce();
    expect(await getLocal('app:x')).toEqual({ at: 1_000, value: ['a', 'b'] });
  });

  it.each([
    { age: 0, reloads: false },
    { age: TTL - 1, reloads: false },
    { age: TTL, reloads: true },
    { age: TTL * 3, reloads: true },
  ])('a hit $age ms old is returned at once; refreshes: $reloads', async ({ age, reloads }) => {
    await setLocal('app:x', { at: 10_000, value: 'old' });
    const load = vi.fn(async () => 'new');
    expect(await cached('app:x', TTL, load, 10_000 + age)).toBe('old');
    expect(load).toHaveBeenCalledTimes(reloads ? 1 : 0);
    await vi.waitFor(async () =>
      expect(((await getLocal('app:x')) as { value: string }).value).toBe(reloads ? 'new' : 'old'),
    );
  });

  it('runs one refresh at a time per key', async () => {
    let finish!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => (finish = r)));
    const first = cached('app:x', TTL, load, 1_000);
    const second = cached('app:x', TTL, load, 1_000);
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    finish('v');
    expect(await Promise.all([first, second])).toEqual(['v', 'v']);
  });

  it('keeps an expired value when its refresh fails', async () => {
    await setLocal('app:x', { at: 0, value: 'old' });
    expect(await cached('app:x', TTL, async () => Promise.reject(new Error('down')), TTL * 2)).toBe(
      'old',
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(await getLocal('app:x')).toEqual({ at: 0, value: 'old' });
  });

  it('does not store anything when the loader throws', async () => {
    await expect(
      cached('app:x', TTL, async () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(await getLocal('app:x')).toBeUndefined();
  });
});

describe('cachedNow', () => {
  const TTL = 60_000;

  it('answers a miss with undefined and stores the background load', async () => {
    const load = vi.fn(async () => 'v');
    expect(await cachedNow('app:y', TTL, load)).toBeUndefined();
    await vi.waitFor(async () => expect(await cachedNow('app:y', TTL, load)).toBe('v'));
    expect(load).toHaveBeenCalledOnce();
  });

  it('lets a caller after forgetLoads start its own load', async () => {
    const first = vi.fn(() => new Promise<string>(() => {}));
    void cached('app:z', TTL, first);
    await vi.waitFor(() => expect(first).toHaveBeenCalled());
    forgetLoads();
    expect(await cached('app:z', TTL, async () => 'new')).toBe('new');
  });

  it('keeps the newer load in flight when the old one finishes after forgetLoads', async () => {
    let finishOld!: (v: string) => void;
    // The old account's load: it no longer writes back, as after a sign-out.
    void cached(
      'app:w',
      TTL,
      () => new Promise<string>((r) => (finishOld = r)),
      Date.now(),
      () => false,
    );
    await vi.waitFor(() => expect(finishOld).toBeDefined());
    forgetLoads();
    let finishNew!: (v: string) => void;
    const newer = cached('app:w', TTL, () => new Promise<string>((r) => (finishNew = r)));
    finishOld('old');
    await new Promise((r) => setTimeout(r, 0));
    const third = vi.fn(async () => 'third');
    const joined = cached('app:w', TTL, third);
    finishNew('new');
    expect(await newer).toBe('new');
    expect(await joined).toBe('new');
    expect(third).not.toHaveBeenCalled();
  });

  it('marks a failed background load, waits before retrying, and clears the mark on success', async () => {
    let t = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => t);
    const load = vi.fn(async (): Promise<string> => {
      throw new Error('down');
    });
    await cachedNow('app:f', TTL, load);
    await vi.waitFor(async () => expect(await getLocal(failedKey('app:f'))).toBe(t));
    await cachedNow('app:f', TTL, load);
    expect(load).toHaveBeenCalledOnce();

    t += RETRY_MS;
    load.mockResolvedValue('ok');
    await cachedNow('app:f', TTL, load);
    await vi.waitFor(async () => expect(await cachedNow('app:f', TTL, load)).toBe('ok'));
    expect(await getLocal(failedKey('app:f'))).toBeUndefined();
    vi.restoreAllMocks();
  });

  it('writes no mark for a failure that outlived its context', async () => {
    const load = vi.fn(async (): Promise<string> => {
      throw new Error('down');
    });
    await cachedNow('app:g', TTL, load, () => false);
    await vi.waitFor(() => expect(load).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(await getLocal(failedKey('app:g'))).toBeUndefined();
  });
});
