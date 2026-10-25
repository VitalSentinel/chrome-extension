import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { formatMetric } from '../../../src/lib/vitals';
import { BandChart, DistributionBar, Ring } from '../../../src/ui/charts';

afterEach(cleanup);

describe('BandChart', () => {
  const fmt = (v: number) => formatMetric('LCP', v);

  it('draws nothing with fewer than two points', () => {
    const { container } = render(
      <BandChart metric="LCP" points={[{ label: 'Jan', value: 2000 }]} format={fmt} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('labels the history with the latest value, both ends and the thresholds', () => {
    render(
      <BandChart
        metric="LCP"
        points={[
          { label: 'Jan 1', value: 3100 },
          { label: 'Feb 1', value: 2700 },
          { label: 'Mar 1', value: 2300 },
        ]}
        format={fmt}
      />,
    );
    expect(screen.getByRole('img', { name: 'LCP history, latest 2.3 s' })).toBeTruthy();
    expect(screen.getByText('Jan 1')).toBeTruthy();
    expect(screen.getByText('Mar 1')).toBeTruthy();
    expect(screen.getByText('Good ≤ 2.5 s · Poor > 4.0 s')).toBeTruthy();
  });
});

describe('Ring', () => {
  it('shows the fraction as text and accessible name', () => {
    render(<Ring value={7} max={10} />);
    const ring = screen.getByRole('img', { name: '7 of 10' });
    expect(ring.textContent).toBe('7/10');
    const arc = ring.querySelectorAll('circle')[1].getAttribute('stroke-dasharray')!;
    expect(Number(arc.split(' ')[0])).toBeCloseTo(0.7 * 2 * Math.PI * 15);
  });

  it('draws an empty arc when max is 0', () => {
    render(<Ring value={0} max={0} size={40} />);
    const ring = screen.getByRole('img', { name: '0 of 0' });
    expect(ring.getAttribute('width')).toBe('40');
    expect(
      ring.querySelectorAll('circle')[1].getAttribute('stroke-dasharray')!.startsWith('0 '),
    ).toBe(true);
  });
});

describe('DistributionBar', () => {
  const widths = (c: Element) =>
    [...c.querySelectorAll('span')].map((s) => (s as HTMLElement).style.width);

  it('splits the bar by share', () => {
    const { container } = render(<DistributionBar good={6} ni={3} poor={1} />);
    expect(widths(container)).toEqual(['60%', '30%', '10%']);
  });

  it('draws an empty bar for no data', () => {
    const { container } = render(<DistributionBar good={0} ni={0} poor={0} />);
    expect(widths(container)).toEqual(['0%', '0%', '0%']);
  });
});
