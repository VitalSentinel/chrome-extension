import { describe, expect, it } from 'vitest';
import { hreflangFindings } from '../../../src/lib/checks/hreflang';
import { ids, snap } from '../fixtures';

const PAGE_URL = 'https://www.example.com/page';
const page = (hreflang: { lang: string; href: string }[]) => snap({ url: PAGE_URL, hreflang });

describe('hreflangFindings', () => {
  it('is silent without hreflang', () => {
    expect(hreflangFindings(page([]))).toEqual([]);
  });

  it('accepts a complete, valid set', () => {
    const set = [
      { lang: 'en', href: `${PAGE_URL}#x` },
      { lang: 'en-GB', href: 'https://www.example.com/uk/page' },
      { lang: 'zh-Hant-TW', href: 'https://www.example.com/tw/page' },
      { lang: 'es-419', href: 'https://www.example.com/latam/page' },
      { lang: 'X-Default', href: PAGE_URL },
    ];
    expect(hreflangFindings(page(set))).toEqual([]);
  });

  it.each(['en-UK', 'en_GB', 'en-EU', 'english', 'en-GB-x', ''])('rejects %j', (code) => {
    const f = hreflangFindings(
      page([
        { lang: code, href: PAGE_URL },
        { lang: 'x-default', href: PAGE_URL },
      ]),
    );
    expect(f).toEqual([{ id: 'hreflang.invalid', level: 'bad', params: { code } }]);
  });

  it('reports one code pointing to two URLs, case-insensitively', () => {
    const f = hreflangFindings(
      page([
        { lang: 'en-gb', href: PAGE_URL },
        { lang: 'en-GB', href: 'https://www.example.com/other' },
        { lang: 'de', href: 'https://www.example.de/' },
        { lang: 'de', href: 'https://www.example.de/' },
        { lang: 'x-default', href: PAGE_URL },
      ]),
    );
    expect(f).toEqual([{ id: 'hreflang.duplicate', level: 'bad', params: { code: 'en-GB' } }]);
  });

  it('wants a self reference and an x-default', () => {
    expect(ids(hreflangFindings(page([{ lang: 'de', href: 'https://www.example.de/' }])))).toEqual([
      'hreflang.noSelf',
      'hreflang.noDefault',
    ]);
  });
});
