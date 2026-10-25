import { describe, expect, it } from 'vitest';
import { API_PREFIX, APP_URL, DR_TTL_MS, OAUTH_SCOPES } from '../../src/lib/config';
import { DEFAULT_SETTINGS, withDefaults } from '../../src/lib/settings';

describe('withDefaults', () => {
  it('fills missing keys and keeps stored ones', () => {
    expect(withDefaults(undefined)).toEqual(DEFAULT_SETTINGS);
    const s = withDefaults({ offline: true, rememberChanges: false });
    expect(s.offline).toBe(true);
    expect(s.rememberChanges).toBe(false);
    expect(s.showDrBadge).toBe(DEFAULT_SETTINGS.showDrBadge);
  });
});

describe('config', () => {
  it('exposes sane endpoints and scopes', () => {
    expect(APP_URL).toMatch(/^https?:\/\//);
    expect(API_PREFIX).toBe('/api/public/v1');
    expect(OAUTH_SCOPES).toEqual([
      'read:workspaces',
      'read:domains',
      'read:gsc',
      'read:indexing',
      'read:crux',
      'read:analytics',
      'read:pages',
      'write:pages',
    ]);
    expect(DR_TTL_MS).toBe(7 * 24 * 3600 * 1000);
  });
});
