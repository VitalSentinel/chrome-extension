import { cleanup, fireEvent, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Schema from '../../../../src/popup/pages/Schema';
import { ARTICLE_LD, PAGE_URL, pageSnap, renderPage } from '../fixtures';

afterEach(cleanup);

const writeText = vi.fn();
beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

const card = (type: string) =>
  screen.getByText(type, { selector: 'span' }).closest('.rounded-card') as HTMLElement;
const ld = (o: object) => JSON.stringify({ '@context': 'https://schema.org', ...o });

describe('Structured data', () => {
  it('shows an eligible Article with every property found', () => {
    renderPage(Schema);
    expect(screen.getByRole('heading', { level: 1, name: 'Structured data' })).toBeTruthy();
    expect(screen.getByText('1 item · JSON-LD')).toBeTruthy();
    const article = card('Article');
    expect(within(article).getByText('Eligible')).toBeTruthy();
    expect(within(article).getByText('headline')).toBeTruthy();
    expect(within(article).getByText('Core Web Vitals explained')).toBeTruthy();
    expect(within(article).getByText('Jane Doe')).toBeTruthy();
  });

  it('marks missing required and recommended properties', () => {
    renderPage(Schema, {
      snap: pageSnap({
        jsonLd: [
          ld({ '@type': 'Product', image: 'x.png' }),
          ld({
            '@type': 'Recipe',
            name: 'Soup',
            image: 'soup.jpg',
            author: 'Ann',
            datePublished: '2026',
            recipeIngredient: ['salt'],
            recipeInstructions: 'Boil',
            totalTime: 'PT1H',
          }),
        ],
      }),
    });
    expect(screen.getByText('2 items · JSON-LD')).toBeTruthy();
    const product = card('Product');
    expect(within(product).getByText('Not eligible')).toBeTruthy();
    expect(within(product).getByText('Required, missing')).toBeTruthy();
    expect(within(product).getAllByText('Recommended, missing')).toHaveLength(5);
    expect(within(card('Recipe')).getByText('Eligible · 1 warning')).toBeTruthy();
    expect(screen.getByText('1 item missing a required property')).toBeTruthy();
    expect(screen.getByText('6 recommended properties missing')).toBeTruthy();
  });

  it('counts warnings in the plural and lists types without rich results', () => {
    renderPage(Schema, {
      snap: pageSnap({
        jsonLd: [
          ld({
            '@graph': [
              { '@type': 'BreadcrumbList', itemListElement: [] },
              { '@type': 'Organization', name: 'Acme', url: 'https://acme.com' },
              { '@type': 'Person', name: 'Jane', url: 'https://x' },
              { '@type': 'Thing' },
            ],
          }),
          ld({ '@type': 'Event', name: 'Launch', startDate: '2026', location: 'Prague' }),
        ],
      }),
    });
    expect(within(card('Event')).getByText('Eligible · 5 warnings')).toBeTruthy();
    expect(within(card('Organization')).getByText('No rich result type')).toBeTruthy();
    const person = card('Person');
    expect(within(person).getByText('Jane')).toBeTruthy();
    expect(within(person).getByText('https://x').className).toContain('mono');
    expect(within(card('Thing')).getByText('No properties.')).toBeTruthy();
    expect(within(card('BreadcrumbList')).getByText('Eligible')).toBeTruthy();
  });

  it('shows a breadcrumb trail and empty values', () => {
    renderPage(Schema, {
      snap: pageSnap({
        jsonLd: [
          ld({
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 2, item: { name: 'Blog' } },
              { '@type': 'ListItem', position: 1, name: 'Home' },
              'junk',
            ],
          }),
          ld({ '@type': 'Article', headline: '' }),
        ],
      }),
    });
    expect(within(card('BreadcrumbList')).getByText('Home › Blog')).toBeTruthy();
    expect(within(card('Article')).getByText('Empty')).toBeTruthy();
  });

  it('lists JSON-LD that cannot be parsed', () => {
    renderPage(Schema, { snap: pageSnap({ jsonLd: ['{ "@type": "Article", '] }) });
    expect(screen.getByText('JSON-LD that could not be parsed')).toBeTruthy();
    expect(screen.getByText('1 JSON-LD block could not be parsed')).toBeTruthy();
    expect(screen.getByText('0 items · JSON-LD')).toBeTruthy();
  });

  it('says when there is none and disables copying', () => {
    renderPage(Schema, {
      snap: pageSnap({ jsonLd: [], microdataTypes: ['Product', 'Offer', 'Product'] }),
    });
    expect(screen.getByText('No structured data')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Copy JSON-LD' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole('heading', { name: 'Microdata · 2' })).toBeTruthy();
    expect(screen.getByText('Offer')).toBeTruthy();
  });

  it('links to the Rich Results Test and the Schema.org validator for this URL', () => {
    renderPage(Schema);
    const url = encodeURIComponent(PAGE_URL);
    expect(screen.getByRole('link', { name: 'Rich Results Test ↗' }).getAttribute('href')).toBe(
      `https://search.google.com/test/rich-results?url=${url}`,
    );
    expect(screen.getByRole('link', { name: 'Schema.org validator ↗' }).getAttribute('href')).toBe(
      `https://validator.schema.org/#url=${url}`,
    );
  });
});

describe('copy JSON-LD', () => {
  it('copies the blocks pretty-printed and confirms', async () => {
    writeText.mockResolvedValue(undefined);
    renderPage(Schema, { snap: pageSnap({ jsonLd: [ARTICLE_LD, '  not json  '] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Copy JSON-LD' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(
      `${JSON.stringify(JSON.parse(ARTICLE_LD), null, 2)}\n\nnot json`,
    );
  });

  it('reports a failed copy', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    renderPage(Schema);
    fireEvent.click(screen.getByRole('button', { name: 'Copy JSON-LD' }));
    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeTruthy();
  });
});
