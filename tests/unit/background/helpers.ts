import { vi } from 'vitest';

// Shared stubs for the service worker tests: JSON responses and a routed fetch mock.

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

export type FetchCall = { url: string; init: RequestInit };

/** Stubs global fetch with a handler; returns the mock so tests can read `.mock.calls`. */
export function stubFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) =>
    handler(String(input), init),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

export const calls = (mock: ReturnType<typeof stubFetch>): FetchCall[] =>
  mock.mock.calls.map(([url, init]) => ({ url: String(url), init: (init ?? {}) as RequestInit }));

/** Lets queued promise callbacks (storage writes behind `void`) settle. */
export const flush = () => new Promise((r) => setTimeout(r, 0));
