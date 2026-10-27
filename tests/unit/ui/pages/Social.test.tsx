import { cleanup, fireEvent, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import Social from '../../../../src/popup/pages/Social';
import { meta } from '../../fixtures';
import { pageSnap, renderPage, settingsFixture } from '../fixtures';

afterEach(cleanup);

const section = (name: string | RegExp) =>
  screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement;
const content = (s: HTMLElement, tag: string) =>
  within(s).getByText(tag).nextElementSibling!.textContent;

describe('Social tags', () => {
  it('previews the share cards from Open Graph', () => {
    const { container } = renderPage(Social);
    const previews = section('Previews');
    expect(within(previews).getByText('Facebook / LinkedIn')).toBeTruthy();
    expect(within(previews).getByText('X · summary_large_image')).toBeTruthy();
    expect(within(previews).getByText('example.com')).toBeTruthy();
    expect(within(previews).getByText('From example.com')).toBeTruthy();
    expect(within(previews).getAllByText('Core Web Vitals explained')).toHaveLength(2);
    expect(
      within(previews).getByText('What LCP, INP and CLS measure and how to fix them.'),
    ).toBeTruthy();
    const imgs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(imgs).toEqual([
      'https://www.example.com/img/og.png',
      'https://www.example.com/img/og.png',
    ]);
    expect(screen.queryByText(/missing$/)).toBeNull();
  });

  it('lists Open Graph and X tags with fallbacks and extras', () => {
    renderPage(Social, {
      snap: pageSnap({
        meta: [...pageSnap().meta, ...meta({ 'og:locale': 'en_GB', 'twitter:creator': '@jane' })],
      }),
    });
    const og = section('Tags · 8');
    expect(content(og, 'og:url')).toBe('https://www.example.com/blog/core-web-vitals');
    expect(
      within(og).getByText('https://www.example.com/blog/core-web-vitals').className,
    ).toContain('mono');
    expect(content(og, 'og:type')).toBe('Not set');
    expect(content(og, 'og:locale')).toBe('en_GB');
    const x = og;
    expect(content(x, 'twitter:card')).toBe('summary_large_image');
    expect(content(x, 'twitter:title')).toBe('Falls back to og:title');
    expect(content(x, 'twitter:image')).toBe('Falls back to og:image');
    expect(content(x, 'twitter:site')).toBe('Not set');
    expect(content(x, 'twitter:creator')).toBe('@jane');
  });

  it('flags missing required tags and falls back to the page title', () => {
    renderPage(Social, { snap: pageSnap({ meta: [] }) });
    expect(screen.getByText('og:title missing')).toBeTruthy();
    expect(screen.getByText('twitter:card missing')).toBeTruthy();
    const og = section('Tags · 0');
    expect(content(og, 'og:title')).toBe('Missing');
    expect(within(og).getByText('og:title').parentElement!.className).toContain('bg-warn-tint');
    expect(content(og, 'og:site_name')).toBe('Not set');
    // Without twitter:card, X shows the small summary card: square thumbnail beside the text.
    expect(screen.getAllByText('No og:image')).toHaveLength(1);
    expect(screen.getAllByText('Core Web Vitals explained: a practical guide')).toHaveLength(2);
    expect(screen.getByText('X')).toBeTruthy();
    expect(screen.getAllByText('example.com')).toHaveLength(2);
  });

  it('shows "No title" when there is none at all', () => {
    renderPage(Social, { snap: pageSnap({ meta: [], title: '' }) });
    expect(screen.getAllByText('No title')).toHaveLength(2);
  });

  it('resolves a relative og:image, warns about it and survives a broken image', () => {
    const { container } = renderPage(Social, {
      snap: pageSnap({ meta: meta({ 'og:image': '/img/og.png', 'og:url': 'http://[broken' }) }),
    });
    expect(
      screen.getByText('Relative og:image URL – most networks need an absolute one'),
    ).toBeTruthy();
    const [img] = container.querySelectorAll('img');
    expect(img.getAttribute('src')).toBe('https://www.example.com/img/og.png');
    expect(screen.getByText('From example.com')).toBeTruthy();
    fireEvent.error(img);
    expect(screen.getByText('The image could not be loaded')).toBeTruthy();
  });

  it("shows no preview image in offline mode, not even from the page's own host", () => {
    const cdn = pageSnap({
      meta: meta({ 'og:image': 'https://cdn.images.net/og.png', 'og:title': 'T' }),
    });
    const { container, unmount } = renderPage(Social, {
      snap: cdn,
      settings: settingsFixture({ offline: true }),
    });
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(screen.getAllByText('Not loaded in offline mode')).toHaveLength(1);
    unmount();

    // An image on the page's own host can redirect to another one.
    const { container: own } = renderPage(Social, { settings: settingsFixture({ offline: true }) });
    expect(own.querySelectorAll('img')).toHaveLength(0);
  });
});
