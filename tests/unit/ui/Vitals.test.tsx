import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { cardsFrom, MetricTiles, rowGrid, VitalCards } from '../../../src/popup/Vitals';
import { tabVitals } from './fixtures';

afterEach(cleanup);

const APP = [
  { metric: 'LCP' as const, device: 1800, crux: 4500 },
  { metric: 'INP' as const, device: undefined, crux: 320 },
  { metric: 'CLS' as const, device: 0.02, crux: null },
];

describe('cardsFrom', () => {
  it('takes this load per metric', () => {
    expect(cardsFrom(tabVitals())).toEqual([
      { metric: 'LCP', device: 1800 },
      { metric: 'INP', device: undefined },
      { metric: 'CLS', device: 0.02 },
    ]);
    expect(cardsFrom(null, ['TTFB'])).toEqual([{ metric: 'TTFB', device: undefined }]);
  });
});

describe('rowGrid', () => {
  it('spans each card over the shared rows as a subgrid', () => {
    expect(rowGrid(3, 4)).toEqual({
      parent: {
        gridTemplateColumns: 'repeat(3, minmax(0,1fr))',
        gridTemplateRows: 'repeat(4, auto)',
      },
      card: { gridRow: 'span 4', gridTemplateRows: 'subgrid' },
    });
  });
});

describe('VitalCards', () => {
  it('leads with the on-device value and its rating, the CrUX p75 beneath', () => {
    render(<VitalCards cards={APP} />);
    expect(screen.getByText('1.8 s')).toBeTruthy();
    expect(screen.getAllByText('Good')).toHaveLength(2); // LCP 1.8 s and CLS 0.02
    expect(screen.getByText('0.02')).toBeTruthy();
    expect(screen.getByText('4.5 s').className).toContain('text-poor-text');
    expect(screen.getByText('Poor').className).toContain('text-poor-text'); // CrUX LCP 4.5 s
    expect(screen.getByText('Needs improvement')).toBeTruthy(); // INP 320 ms, as text
    expect(screen.getAllByText('CrUX data')).toHaveLength(3);
    expect(screen.getByText('Interact with the page first')).toBeTruthy();
    expect(screen.getByText('No data').className).toContain('text-ink-3'); // CLS has no CrUX week
  });

  it('keeps the same rows in every card so lines align', () => {
    const { container } = render(<VitalCards cards={APP} />);
    const grid = container.firstElementChild as HTMLElement;
    // label, value, note (INP), field line
    expect(grid.style.gridTemplateRows).toBe('repeat(4, auto)');
    for (const card of grid.children) {
      expect(card.children).toHaveLength(4);
      expect((card as HTMLElement).style.gridRow).toBe('span 4');
    }
  });

  it('leaves out rows no card fills', () => {
    const { container } = render(<VitalCards cards={cardsFrom(tabVitals(), ['LCP'])} />);
    const card = container.firstElementChild!.firstElementChild!;
    expect(card.children).toHaveLength(2);
    expect(screen.queryByText('CrUX data')).toBeNull();
  });

  it('holds the CrUX rows while the app answers, with no chart placeholder', () => {
    const { container } = render(
      <VitalCards cards={cardsFrom(tabVitals()).map((c) => ({ ...c, cruxLoading: true }))} />,
    );
    expect(screen.getAllByRole('status', { name: 'Loading CrUX data' })).toHaveLength(3);
    expect(container.querySelectorAll('.skeleton.h-\\[50px\\]')).toHaveLength(0);
  });

  it('shows the CrUX value under this load, without a chart', () => {
    render(
      <VitalCards
        cards={[
          { metric: 'LCP', device: 2000, crux: 3000 },
          { metric: 'INP', device: 150 },
          { metric: 'CLS', device: 0.05 },
        ]}
      />,
    );
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('CrUX data').nextElementSibling!.textContent).toBe('3.0 s');
    expect(screen.getByText('Needs improvement')).toBeTruthy(); // the CrUX rating beside it
  });

  it('rates a poor value', () => {
    render(<VitalCards cards={[{ metric: 'INP', device: 650 }]} />);
    expect(screen.getByText('650 ms')).toBeTruthy();
    expect(screen.getByText('Poor')).toBeTruthy();
  });
});

describe('MetricTiles', () => {
  it('shows this load per metric with its rating and notes for missing values', () => {
    const { container } = render(
      <MetricTiles cards={cardsFrom(tabVitals(), ['LCP', 'INP', 'FCP'])} />,
    );
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('repeat(3, minmax(0,1fr))');
    expect(screen.getByText('1.8 s').className).toContain('text-good-text');
    expect(screen.getByText('Good')).toBeTruthy();
    expect(screen.getByText('Interact with the page first')).toBeTruthy();
    expect(screen.getByText('Not measured yet')).toBeTruthy();
    for (const tile of grid.children) expect(tile.children).toHaveLength(3);
  });

  it('has two rows when every value is there', () => {
    const { container } = render(<MetricTiles cards={cardsFrom(tabVitals(), ['LCP'])} />);
    expect(container.firstElementChild!.firstElementChild!.children).toHaveLength(2);
  });
});
