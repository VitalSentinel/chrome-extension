import { cleanup, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRobots } from '../../../../src/lib/checks/robots';
import Crawlers, { ruleLines } from '../../../../src/popup/pages/Crawlers';
import { ORIGIN, ROBOTS_TXT, renderPage, robotsResult, setupData } from '../fixtures';

vi.mock('../../../../src/popup/data', async (orig) =>
  (await import('../mocks')).dataModule(await orig()),
);

let data: ReturnType<typeof setupData>;
beforeEach(() => {
  data = setupData();
});
afterEach(cleanup);

const section = (name: string | RegExp) =>
  screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement;
const verdict = (s: HTMLElement, bot: string) =>
  within(s).getByText(bot).parentElement!.nextElementSibling!.textContent;
const rule = (s: HTMLElement, bot: string) =>
  within(s).getByText(bot).parentElement!.nextElementSibling!.nextElementSibling!.textContent;

describe('Crawlers', () => {
  it('shows the verdict and deciding rule per crawler', async () => {
    renderPage(Crawlers);
    expect(screen.getByText('Reading robots.txt…')).toBeTruthy();
    const search = await screen
      .findByText('0 of 6 blocked for this URL')
      .then(() => section('Search engines'));
    expect(verdict(search, 'Googlebot')).toBe('Allowed');
    expect(rule(search, 'Googlebot')).toBe('No matching rule');

    const ai = section('AI crawlers');
    expect(within(ai).getByText('1 of 12 blocked for this URL')).toBeTruthy();
    expect(verdict(ai, 'GPTBot')).toBe('Blocked');
    expect(rule(ai, 'GPTBot')).toBe('L5 Disallow: /');
    expect(verdict(ai, 'ClaudeBot')).toBe('Allowed');
    expect(data.robots).toHaveBeenCalledWith(ORIGIN);
  });

  it('prints robots.txt with line numbers and the declared sitemaps', async () => {
    renderPage(Crawlers);
    await screen.findByText(`7 lines · ${ROBOTS_TXT.length} B`);
    const file = section('robots.txt');
    expect(within(file).getByText('Disallow: /admin/')).toBeTruthy();
    expect(within(file).getByText('7')).toBeTruthy();
    expect(within(file).getByText('← blocks GPTBot')).toBeTruthy();
    expect(within(file).getByText('5').parentElement!.className).toContain('bg-poor-tint');
    const sitemaps = section('Declared sitemaps · 1');
    expect(within(sitemaps).getByRole('link', { name: `${ORIGIN}/sitemap.xml` })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open robots.txt ↗' }).getAttribute('href')).toBe(
      `${ORIGIN}/robots.txt`,
    );
  });

  it('marks the rule that allows a crawler and abbreviates a long crawler list', async () => {
    data.robots.mockResolvedValue(robotsResult('User-agent: *\nAllow: /\n'));
    renderPage(Crawlers);
    const file = await screen.findByText('2 lines · 23 B').then(() => section('robots.txt'));
    expect(within(file).getByText(/^← allows Googlebot, Googlebot-Image \+\d+$/)).toBeTruthy();
    expect(within(file).getByText('2').parentElement!.className).toContain('bg-good-tint');
    expect(rule(section('Search engines'), 'Bingbot')).toBe('L2 Allow: /');
  });

  it('pairs every rule with its line, skipping comments and rules before any group', () => {
    const text =
      'Disallow: /x\n# User-agent: *\nUser-agent: a\nUser-agent: b\n\nDisallow:\nAllow: /p # note\nCrawl-delay: 1\nDisallow: /q';
    const parsed = parseRobots(text);
    const lines = ruleLines(text, parsed);
    expect(parsed.groups[0].rules.map((r) => lines.get(r))).toEqual([7, 9]);
  });

  it('warns when robots.txt could not be fetched', async () => {
    data.robots.mockResolvedValue(null);
    renderPage(Crawlers);
    expect(await screen.findByText('robots.txt could not be fetched')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Search engines' })).toBeNull();
  });

  it('treats a server error as block-everything', async () => {
    data.robots.mockResolvedValue(robotsResult('', 503));
    renderPage(Crawlers);
    expect(await screen.findByText('robots.txt answers HTTP 503')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'robots.txt' })).toBeNull();
  });

  it('allows everything without a robots.txt', async () => {
    data.robots.mockResolvedValue(robotsResult('', 404));
    renderPage(Crawlers);
    expect(await screen.findByText('No robots.txt (HTTP 404)')).toBeTruthy();
    expect(
      screen.getByText(
        'robots.txt declares no sitemap. A Sitemap line helps every crawler find your URLs.',
      ),
    ).toBeTruthy();
  });

  it('notes an empty robots.txt', async () => {
    data.robots.mockResolvedValue(robotsResult(''));
    renderPage(Crawlers);
    expect(await screen.findByText('robots.txt is empty – everything is allowed.')).toBeTruthy();
    expect(screen.getByText('0 lines · 0 B')).toBeTruthy();
  });

  it('shows a non-web sitemap URL as text, not a link', async () => {
    data.robots.mockResolvedValue(
      robotsResult('User-agent: *\nAllow: /\nSitemap: javascript:alert(1)\n'),
    );
    renderPage(Crawlers);
    const sitemaps = await screen
      .findByText('Declared sitemaps · 1')
      .then(() => section('Declared sitemaps · 1'));
    expect(within(sitemaps).getByText('javascript:alert(1)').tagName).toBe('SPAN');
    expect(within(sitemaps).queryByRole('link')).toBeNull();
  });
});
