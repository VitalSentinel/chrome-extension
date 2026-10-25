import { cleanup, fireEvent, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import Images from '../../../../src/popup/pages/Images';
import { image } from '../../fixtures';
import { pageSnap, renderPage, settingsFixture } from '../fixtures';

afterEach(cleanup);

const hero = image({
  src: 'https://www.example.com/img/hero.jpg',
  alt: null,
  widthAttr: false,
  naturalWidth: 2400,
  naturalHeight: 1600,
  renderedWidth: 400,
  renderedHeight: 300,
  loading: 'lazy',
  aboveFold: true,
  bytes: 300_000,
});
const decorative = image({
  src: 'data:image/png;base64,iVBORw0KGgo=',
  alt: '',
  loading: '',
  renderedWidth: 20,
  renderedHeight: 20,
  naturalWidth: 20,
  naturalHeight: 20,
});
const hidden = image({
  src: 'https://www.example.com/img/hidden.svg',
  renderedWidth: 0,
  renderedHeight: 0,
  naturalWidth: 0,
  naturalHeight: 0,
  bytes: 2048,
});
const spacer = image({ src: 'data:image/gif;base64,R0lGOD' });

// The figures row comes first; filter pills further down reuse the same labels.
const stat = (label: string) =>
  screen.getAllByText(label, { selector: 'span' })[0].nextElementSibling!.textContent;
const filters = () => screen.getByRole('group', { name: 'Filter images' });

describe('Images', () => {
  it('lists a clean image with its sizes and format', () => {
    renderPage(Images);
    expect(stat('Images')).toBe('1');
    expect(stat('Missing alt')).toBe('0');
    expect(screen.queryByText(/could be saved/)).toBeNull();
    expect(
      within(filters())
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['All 1']);
    expect(screen.getByText('LCP chart')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'https://www.example.com/img/chart.webp' }),
    ).toBeTruthy();
    expect(screen.getByText('800 × 600 · shown 400 × 300 · WEBP')).toBeTruthy();
    expect(screen.getByText('Lazy')).toBeTruthy();
  });

  it('estimates savings, counts issues and filters by them', () => {
    renderPage(Images, { snap: pageSnap({ images: [hero, decorative, hidden, spacer] }) });
    expect(screen.getByText(/^About \d+ KB \(\d+%\) could be saved$/)).toBeTruthy();
    expect(
      screen.getByText(
        'By resizing 1 image to twice their shown size and serving 1 image in older formats as WebP or AVIF (about 30% smaller). Only images whose file size the page could read count.',
      ),
    ).toBeTruthy();
    expect(stat('Images')).toBe('3');
    expect(screen.getByText('295 KB known')).toBeTruthy();
    expect(stat('Missing alt')).toBe('1');
    expect(stat('Oversized')).toBe('1');
    expect(stat('Legacy format')).toBe('1');
    expect(screen.getByText('1 image without an alt attribute')).toBeTruthy();

    expect(screen.getByText('Missing alt attribute')).toBeTruthy();
    expect(screen.getByText('Missing alt attribute').closest('.grid')!.className).toContain(
      'bg-poor-tint',
    );
    expect(screen.getByText(/^Empty alt text/).closest('.grid')!.className).toContain(
      'bg-warn-tint',
    );
    expect(screen.getByText('data:image/png;base64,iVBORw0KGgo=')).toBeTruthy();
    expect(screen.getByText('not shown · SVG')).toBeTruthy();
    expect(screen.getByText(/^−\d+ KB$/)).toBeTruthy();
    expect(screen.getByText('293 KB').className).toContain('text-warn-text');
    expect(
      screen.getByText('Lazy above the fold', { selector: '.rounded-pill span, .rounded-pill' }),
    ).toBeTruthy();

    const all = within(filters()).getByRole('button', { name: 'All 3' });
    expect(all.getAttribute('aria-pressed')).toBe('true');
    const lazy = within(filters()).getByRole('button', { name: 'Lazy above the fold 1' });
    fireEvent.click(lazy);
    expect(lazy.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText(/^Empty alt text/)).toBeNull();
    expect(screen.getByText('Missing alt attribute')).toBeTruthy();

    fireEvent.click(within(filters()).getByRole('button', { name: 'Not lazy 1' }));
    expect(screen.getByText(/^Empty alt text/)).toBeTruthy();
    expect(screen.queryByText('Missing alt attribute')).toBeNull();

    fireEvent.click(all);
    expect(screen.getByText('Missing alt attribute')).toBeTruthy();
  });

  it('hides a thumbnail that fails to load', () => {
    const { container } = renderPage(Images);
    const thumb = container.querySelector('img') as HTMLImageElement;
    fireEvent.error(thumb);
    expect(thumb.style.visibility).toBe('hidden');
  });

  it('says when the page has no images', () => {
    renderPage(Images, { snap: pageSnap({ images: [] }) });
    expect(screen.getByText('No images on this page.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Filter images' })).toBeNull();
  });

  it('loads no thumbnails from other hosts in offline mode', () => {
    const cdn = image({ src: 'https://cdn.images.net/photo.webp', alt: 'CDN photo' });
    const { container } = renderPage(Images, {
      snap: pageSnap({ images: [cdn, ...pageSnap().images] }),
      settings: settingsFixture({ offline: true }),
    });
    expect([...container.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([
      'https://www.example.com/img/chart.webp',
    ]);
    expect(screen.getByTitle('Not loaded in offline mode')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'https://cdn.images.net/photo.webp' })).toBeTruthy();
  });
});
