import { describe, expect, it } from 'vitest';
import { ago, bytes, compact, date, duration, ms, num, pct, capital } from '../../src/lib/format';

describe('format', () => {
  it('num groups thousands', () => {
    expect(num(1234567)).toBe('1,234,567');
  });

  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '2 KB'],
    [1024 * 1024, '1.0 MB'],
    [5.5 * 1024 * 1024, '5.5 MB'],
  ])('bytes(%d) → %s', (n, out) => {
    expect(bytes(n)).toBe(out);
  });

  it.each([
    [12.4, '12 ms'],
    [999, '999 ms'],
    [1000, '1.0 s'],
    [2500, '2.5 s'],
  ])('ms(%d) → %s', (n, out) => {
    expect(ms(n)).toBe(out);
  });

  it.each([
    [42, '42'],
    [9999, '9,999'],
    [10_000, '10k'],
    [123_456, '123k'],
    [1_000_000, '1.0M'],
    [2_500_000, '2.5M'],
  ])('compact(%d) → %s', (n, out) => {
    expect(compact(n)).toBe(out);
  });

  it('pct formats a share with optional digits', () => {
    expect(pct(0.123)).toBe('12%');
    expect(pct(0.1234, 1)).toBe('12.3%');
    expect(pct(1)).toBe('100%');
  });

  it('date formats ISO dates and passes invalid input through', () => {
    expect(date('2026-03-05T12:00:00Z')).toBe('Mar 5, 2026');
    expect(date('not a date')).toBe('not a date');
  });

  describe('ago', () => {
    const now = Date.parse('2026-10-25T12:00:00Z');
    const before = (s: number) => now - s * 1000;

    it.each([
      [0, 'just now'],
      [89, 'just now'],
      [90, '2 min ago'],
      [30 * 60, '30 min ago'],
      [3600, '1 h ago'],
      [47 * 3600, '47 h ago'],
      [2 * 86400, '2 days ago'],
      [10 * 86400, '10 days ago'],
    ])('%d s ago → %s', (s, out) => {
      expect(ago(before(s), now)).toBe(out);
    });

    it('accepts ISO strings and clamps future times', () => {
      expect(ago('2026-10-25T11:00:00Z', now)).toBe('1 h ago');
      expect(ago(now + 60_000, now)).toBe('just now');
    });
  });
});

describe('capital', () => {
  it('upper-cases the first letter only', () => {
    expect(capital('granted')).toBe('Granted');
    expect(capital('')).toBe('');
  });
});

describe('duration', () => {
  it('formats a visit length as the app does', () => {
    expect(duration(0)).toBe('0 s');
    expect(duration(42.4)).toBe('42 s');
    expect(duration(60)).toBe('1 min 0 s');
    expect(duration(172)).toBe('2 min 52 s');
    expect(duration(3725)).toBe('62 min 5 s');
  });
});
