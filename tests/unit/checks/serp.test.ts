import { describe, expect, it } from 'vitest';
import { DESCRIPTION_PX, displayUrl, TITLE_PX, truncate } from '../../../src/lib/checks/serp';

const measure = (t: string) => t.length * 10;

describe('truncate', () => {
  it('keeps text that fits', () => {
    expect(truncate('short title', 600, measure)).toEqual({
      text: 'short title',
      cut: false,
      px: 110,
    });
  });

  it('cuts at a word boundary with an ellipsis that also fits', () => {
    expect(truncate('hello world foo bar', 100, measure)).toEqual({
      text: 'hello …',
      cut: true,
      px: 190,
    });
    expect(truncate('hello world foo bar', 130, measure).text).toBe('hello world …');
  });

  it('exposes the Google pixel limits', () => {
    expect([TITLE_PX, DESCRIPTION_PX]).toEqual([600, 920]);
  });

  // Regression: text without spaces (CJK titles, long URLs) wider than the limit comes back as just " …".
  it('keeps part of a title that has no spaces', () => {
    expect(truncate('日本語のとても長いタイトルです', 60, measure).text).toMatch(/^日本/);
  });
});

describe('displayUrl', () => {
  it('shows host and decoded path segments as a breadcrumb', () => {
    expect(displayUrl('https://www.example.com/blog/my%20post/?q=1')).toBe(
      'www.example.com › blog › my post',
    );
    expect(displayUrl('https://www.example.com/')).toBe('www.example.com');
  });

  // Regression: a stray "%" in a path (e.g. /50%-off) makes decodeURIComponent throw a URIError.
  it('does not throw on a malformed escape', () => {
    expect(displayUrl('https://www.example.com/sale/50%-off')).toBe(
      'www.example.com › sale › 50%-off',
    );
  });
});
