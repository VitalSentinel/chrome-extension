import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { pruneHistory } from '../../../src/background/history';

const DAY = 86400_000;
const NOW = 100 * DAY;

beforeEach(() => fakeBrowser.reset());

describe('pruneHistory', () => {
  it('deletes snapshots older than 30 days without waiting for the next analysis', async () => {
    await fakeBrowser.storage.local.set({
      'digest-index': [
        ['digest:https://a.com/', NOW - DAY],
        ['digest:https://b.com/', NOW - 31 * DAY],
      ],
      'digest:https://a.com/': { at: NOW - DAY },
      'digest:https://b.com/': { at: NOW - 31 * DAY },
    });
    await pruneHistory(NOW);
    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      'digest-index': [['digest:https://a.com/', NOW - DAY]],
      'digest:https://a.com/': { at: NOW - DAY },
    });
  });

  it('leaves storage alone when nothing has expired', async () => {
    await fakeBrowser.storage.local.set({ 'digest-index': [['digest:https://a.com/', NOW]] });
    await pruneHistory(NOW);
    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      'digest-index': [['digest:https://a.com/', NOW]],
    });
  });
});
