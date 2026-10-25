import { describe, expect, it } from 'vitest';
import {
  GROUPS,
  LOADERS,
  groupOf,
  lastPageKey,
  loaderFor,
  restorePage,
  type PageKey,
} from '../../../src/popup/nav';

const allPages: PageKey[] = [...GROUPS.flatMap((g) => g.pages.map((p) => p.key)), 'vs-all'];

describe('groupOf', () => {
  it.each([
    ['overview', 'overview'],
    ['content', 'onpage'],
    ['images', 'onpage'],
    ['indexability', 'crawl'],
    ['links', 'crawl'],
    ['performance', 'performance'],
    ['headers', 'technical'],
    ['ai', 'technical'],
    ['vs-all', 'vitalsentinel'],
  ] as [PageKey, string][])('%s belongs to %s', (page, group) => {
    expect(groupOf(page)).toBe(group);
  });
});

describe('pages', () => {
  it('lists every page once', () => {
    expect(new Set(allPages).size).toBe(allPages.length);
  });

  it('sends the VitalSentinel page to its module', () => {
    expect(loaderFor('vs-all')).toBe(LOADERS.vitalsentinel);
    expect(loaderFor('schema')).toBe(LOADERS.schema);
  });

  it('has a loader for every page that resolves to a component', async () => {
    for (const key of allPages) {
      const load = loaderFor(key);
      expect(load, key).toBeTypeOf('function');
      expect((await load()).default, key).toBeTypeOf('function');
    }
  });
});

describe('restorePage', () => {
  const URL = 'https://www.example.com/pricing';

  it('keys the saved page by tab', () => {
    expect(lastPageKey(7)).toBe('lastPage:7');
  });

  it('reopens the saved page for the same URL', () => {
    expect(restorePage({ url: URL, page: 'schema' }, URL, false)).toBe('schema');
    expect(restorePage({ url: URL, page: 'vs-all' }, URL, true)).toBe('vs-all');
  });

  it.each([
    ['nothing saved', undefined, true],
    ['another URL', { url: 'https://www.example.com/', page: 'schema' }, true],
    ['an unknown page', { url: URL, page: 'retired' }, true],
    ['a retired VitalSentinel view', { url: URL, page: 'vs-uptime' }, true],
    ['a VitalSentinel page after signing out', { url: URL, page: 'vs-all' }, false],
  ])('starts on the Overview for %s', (_, last, signedIn) => {
    expect(restorePage(last, URL, signedIn)).toBe('overview');
  });
});
