import { cleanup, fireEvent, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Accessibility, { shortSelector } from '../../../../src/popup/pages/Accessibility';
import { AXE_RESULT, renderPage, setupData } from '../fixtures';

vi.mock('../../../../src/popup/data', async (orig) =>
  (await import('../mocks')).dataModule(await orig()),
);

let data: ReturnType<typeof setupData>;
beforeEach(() => {
  data = setupData();
});
afterEach(cleanup);

const runAgain = () => screen.getByRole('button', { name: 'Run again' }) as HTMLButtonElement;
const stat = (label: string) =>
  screen.getByText(label, { selector: 'span.text-xs' }).nextElementSibling!.textContent;

describe('Accessibility', () => {
  it('runs axe on open and lists violations by impact', async () => {
    renderPage(Accessibility);
    expect(screen.getByText('Running accessibility checks…')).toBeTruthy();
    expect(runAgain().disabled).toBe(true);
    expect(data.runAxe).toHaveBeenCalledWith(7, false);

    expect(await screen.findByRole('heading', { name: 'Issues · 4' })).toBeTruthy();
    expect(stat('Critical')).toBe('1');
    expect(stat('Serious')).toBe('1');
    expect(stat('Moderate')).toBe('1');
    expect(stat('Minor')).toBe('1');

    const links = screen.getAllByRole('link').map((a) => a.textContent);
    expect(links).toEqual([
      'Images must have alternate text',
      'Elements must meet minimum color contrast ratio thresholds',
      'All page content should be contained by landmarks',
      'Something minor',
    ]);
    const first = screen
      .getByRole('link', { name: 'Images must have alternate text' })
      .closest('.rounded-card') as HTMLElement;
    expect(within(first).getByText('7 elements')).toBeTruthy();
    expect(within(first).getByText('img:nth-child(5)')).toBeTruthy();
    expect(within(first).getByText('+ 2 more elements')).toBeTruthy();
    expect(screen.getAllByText('1 element')).toHaveLength(2);

    expect(screen.getByRole('heading', { name: 'Passed · 31 rules' })).toBeTruthy();
    expect(screen.getByText('rule-12')).toBeTruthy();
    expect(screen.queryByText('rule-13')).toBeNull();
    expect(screen.getByText('+ 19 rules')).toBeTruthy(); // 31 passed, 12 shown
  });

  it('shortens long selectors and reads the contrast ratio', async () => {
    const target = `#main > ${'div.wrapper > '.repeat(8)}ul.list > li:nth-child(3) > a.more`;
    data.runAxe.mockResolvedValue({
      ...AXE_RESULT,
      violations: [
        {
          ...AXE_RESULT.violations[0],
          nodes: [
            {
              target,
              summary:
                'Fix any of the following:\n  Element has insufficient color contrast of 2.5 (foreground color: #9ca3af, background color: #ffffff, font size: 9.0pt (12px))',
            },
          ],
          count: 1,
        },
      ],
    });
    renderPage(Accessibility);
    const node = await screen.findByText(shortSelector(target));
    expect(node.textContent).toBe('#main > … > div.wrapper > ul.list > li:nth-child(3) > a.more');
    expect(node.getAttribute('title')).toContain(target);
    expect(screen.getByText('#9ca3af on #ffffff · 2.5:1')).toBeTruthy();
    expect(screen.queryByText(/more element/)).toBeNull();
  });

  it('keeps short or unsplittable selectors whole', () => {
    expect(shortSelector('footer a')).toBe('footer a');
    const long = `a[href="${'x'.repeat(80)}"]`;
    expect(shortSelector(long)).toBe(long);
    expect(shortSelector(`${'a'.repeat(40)} > b > ${'c'.repeat(40)}`)).toBe(
      `${'a'.repeat(40)} > … > ${'c'.repeat(40)}`,
    );
  });

  it('runs again without the cached result', async () => {
    renderPage(Accessibility);
    await screen.findByRole('heading', { name: 'Issues · 4' });
    fireEvent.click(runAgain());
    expect(data.runAxe).toHaveBeenLastCalledWith(7, true);
    expect(await screen.findByRole('heading', { name: 'Issues · 4' })).toBeTruthy();
  });

  it('celebrates a page without automated issues', async () => {
    data.runAxe.mockResolvedValue({ violations: [], passes: 0, passIds: [] });
    renderPage(Accessibility);
    expect(await screen.findByText('No automated accessibility issues found')).toBeTruthy();
    expect(screen.getByText('No rules passed.')).toBeTruthy();
  });

  it('reports a failed run', async () => {
    data.runAxe.mockRejectedValue(new Error('Cannot access a chrome:// URL'));
    renderPage(Accessibility);
    expect(
      await screen.findByText(
        'The accessibility checks could not run on this page: Cannot access a chrome:// URL',
      ),
    ).toBeTruthy();
    expect(runAgain().disabled).toBe(false);
  });

  it('reports a run that returned nothing', async () => {
    data.runAxe.mockResolvedValue(undefined as never);
    renderPage(Accessibility);
    expect(
      await screen.findByText('The accessibility checks could not run on this page.'),
    ).toBeTruthy();
  });
});
