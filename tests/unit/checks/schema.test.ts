import { describe, expect, it } from 'vitest';
import { analyseSchema, parseJsonLd } from '../../../src/lib/checks/schema';

const j = (o: unknown) => JSON.stringify(o);

describe('parseJsonLd', () => {
  it('flattens arrays and @graph into typed entities', () => {
    const scripts = [
      j({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite', name: 'S' },
          { '@type': 'Organization', name: 'O' },
          { name: 'untyped' },
        ],
      }),
      j([{ '@type': 'BreadcrumbList', itemListElement: [] }, 'noise', null]),
    ];
    const { items, errors } = parseJsonLd(scripts);
    expect(items.map((i) => i['@type'])).toEqual(['WebSite', 'Organization', 'BreadcrumbList']);
    expect(errors).toEqual([]);
  });

  it('collects parse errors and keeps going', () => {
    const { items, errors } = parseJsonLd([
      '{"@type": "Article",}',
      j({ '@type': 'Article', headline: 'h' }),
    ]);
    expect(items).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it('reads JSON wrapped in an HTML comment or CDATA, and skips empty blocks', () => {
    const { items, errors } = parseJsonLd([
      `<!--\n${j({ '@type': 'WebSite' })}\n-->`,
      `//<![CDATA[\n${j({ '@type': 'Organization' })}\n//]]>`,
      '  \n ',
    ]);
    expect(items.map((i) => i['@type'])).toEqual(['WebSite', 'Organization']);
    expect(errors).toEqual([]);
  });
});

describe('analyseSchema', () => {
  it('rates required and recommended properties, following nested and array values', () => {
    const article = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'How to test',
      image: ['https://a.com/1.jpg', 'https://a.com/2.jpg'],
      datePublished: '2026-10-01',
      author: [{ '@type': 'Person', name: 'Ada', url: 'https://a.com/ada' }],
    };
    const { items, findings } = analyseSchema([j(article)]);
    expect(items[0]!.type).toBe('Article');
    expect(items[0]!.eligible).toBe(true);
    expect(items[0]!.props).toEqual([
      { name: 'headline', value: 'How to test', level: 'good' },
      { name: 'image', value: 'https://a.com/1.jpg (+1)', level: 'good' },
      { name: 'datePublished', value: '2026-10-01', level: 'good' },
      { name: 'dateModified', value: '', level: 'warn' },
      { name: 'author.name', value: 'Ada', level: 'good' },
      { name: 'author.url', value: 'https://a.com/ada', level: 'good' },
    ]);
    expect(findings).toEqual([
      { id: 'schema.recommendedMissing', level: 'warn', params: { n: 1 } },
    ]);
  });

  it('marks a rich-result type with a missing required property as not eligible', () => {
    const { items, findings } = analyseSchema([
      j({
        '@type': 'Product',
        offers: { '@type': 'Offer', price: 0, priceCurrency: 'EUR' },
        brand: { '@type': 'Brand' },
      }),
    ]);
    expect(items[0]!.eligible).toBe(false);
    expect(items[0]!.props.find((p) => p.name === 'name')).toEqual({
      name: 'name',
      value: '',
      level: 'bad',
    });
    expect(items[0]!.props.find((p) => p.name === 'offers')?.value).toBe('Offer');
    expect(items[0]!.props.find((p) => p.name === 'brand')?.value).toBe('Brand');
    expect(findings.map((f) => f.id)).toEqual([
      'schema.requiredMissing',
      'schema.recommendedMissing',
    ]);
  });

  it('shows numbers, booleans, @id and long objects', () => {
    const { items } = analyseSchema([
      j({
        '@type': 'Offer',
        price: 19.99,
        priceCurrency: 'USD',
        availability: { '@id': 'https://schema.org/InStock' },
      }),
      j({ '@type': 'Course', name: true, description: { foo: 'bar' }, provider: [] }),
    ]);
    expect(items[0]!.props.map((p) => p.value)).toEqual([
      '19.99',
      'USD',
      'https://schema.org/InStock',
    ]);
    expect(items[0]!.eligible).toBeNull(); // Offer has no rich result of its own
    expect(items[1]!.props.map((p) => p.value)).toEqual(['true', '{"foo":"bar"}', '']);
  });

  it('picks the first known type from a type list or URL', () => {
    const { items } = analyseSchema([
      j({ '@type': ['Thing', 'https://schema.org/Recipe'], name: 'Soup', image: 'x.jpg' }),
      j({ '@type': 'Person', name: 'Ada' }),
      j({ '@type': 42 }),
    ]);
    expect(items.map((i) => [i.type, i.eligible])).toEqual([
      ['Recipe', true],
      ['Person', null],
      ['Thing', null],
    ]);
    expect(items[1]!.props).toEqual([]);
  });

  it('reports parse errors, and no schema at all', () => {
    expect(analyseSchema(['not json']).findings).toEqual([
      { id: 'schema.parseError', level: 'bad', params: { n: 1 } },
    ]);
    expect(analyseSchema([]).findings).toEqual([{ id: 'schema.none', level: 'info' }]);
  });
});
