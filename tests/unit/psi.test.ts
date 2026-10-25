import { describe, expect, it } from 'vitest';
import { pagespeedWebUrl } from '../../src/lib/psi';

describe('pagespeedWebUrl', () => {
  it('opens a PageSpeed Insights test for the page', () => {
    expect(pagespeedWebUrl('https://example.com/a?b=1')).toBe(
      'https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1',
    );
  });
});
