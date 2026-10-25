import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Banner,
  Button,
  Card,
  Chip,
  ErrorNote,
  Findings,
  KeyValues,
  LinkButton,
  Loading,
  Mark,
  Note,
  Page,
  Pill,
  Section,
  Select,
  Stats,
  Switch,
  Table,
  cx,
  type Column,
} from '../../../src/ui/kit';

afterEach(cleanup);

describe('layout pieces', () => {
  it('Page shows the title as the heading, the aside and the body', () => {
    render(
      <Page title="Links" aside={<button type="button">Aside</button>}>
        <p>Body</p>
      </Page>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Links' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aside' })).toBeTruthy();
    expect(screen.getByText('Body')).toBeTruthy();
  });

  it('Section shows its aside only when given', () => {
    const { rerender } = render(
      <Section title="Sitemaps" aside="2 read">
        x
      </Section>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Sitemaps' })).toBeTruthy();
    expect(screen.getByText('2 read')).toBeTruthy();
    rerender(<Section title="Sitemaps">x</Section>);
    expect(screen.queryByText('2 read')).toBeNull();
  });

  it('Card, Chip, Pill, Note and ErrorNote render their children', () => {
    render(
      <>
        <Card tone="warn">card</Card>
        <Chip mono>chip</Chip>
        <Chip>plain chip</Chip>
        <Pill>info pill</Pill>
        <Pill level="bad">bad pill</Pill>
        <Note>note</Note>
        <ErrorNote>broken</ErrorNote>
      </>,
    );
    for (const t of ['card', 'chip', 'plain chip', 'info pill', 'bad pill', 'note', 'broken'])
      expect(screen.getByText(t)).toBeTruthy();
  });

  it('Mark draws a symbol per level, hidden from screen readers', () => {
    const { container } = render(
      <>
        <Mark level="good" />
        <Mark level="warn" />
        <Mark level="bad" />
        <Mark level="info" />
      </>,
    );
    const marks = [...container.querySelectorAll('[aria-hidden="true"]')].map((m) => m.textContent);
    expect(marks).toEqual(['✓', '!', '×', 'i']);
  });

  it('Loading is a status with a default and a custom label', () => {
    const { rerender } = render(<Loading />);
    expect(screen.getByRole('status').textContent).toBe('Analysing…');
    rerender(<Loading label="Reading robots.txt…" />);
    expect(screen.getByRole('status').textContent).toBe('Reading robots.txt…');
  });

  it('Loading draws placeholder rows hidden from screen readers, or none', () => {
    const { container, rerender } = render(<Loading rows={5} />);
    expect(container.querySelectorAll('[aria-hidden="true"] .skeleton')).toHaveLength(10);
    rerender(<Loading rows={0} />);
    expect(container.querySelector('.skeleton')).toBeNull();
  });

  it('cx joins only truthy class names', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b');
  });
});

describe('Findings', () => {
  it('renders nothing for no findings without an empty text', () => {
    const { container } = render(<Findings items={[]} />);
    expect(container.textContent).toBe('');
  });

  it('renders the empty text for no findings', () => {
    render(<Findings items={[]} empty="All good." />);
    expect(screen.getByText('All good.')).toBeTruthy();
  });

  it('renders one message per finding, in order', () => {
    render(
      <Findings
        items={[
          { id: 'title.missing', level: 'bad' },
          { id: 'title.short', level: 'warn', params: { n: 12 } },
          { id: 'index.ok', level: 'good' },
          { id: 'content.thin', level: 'info', params: { n: 1 } },
          { id: 'unknown.id', level: 'info' },
        ]}
      />,
    );
    expect(screen.getByText('No title tag')).toBeTruthy();
    expect(screen.getByText('Title is short (12 characters, aim for 30–60)')).toBeTruthy();
    expect(screen.getByText('Indexable')).toBeTruthy();
    expect(screen.getByText('Thin content: 1 word')).toBeTruthy();
    expect(screen.getByText('unknown.id')).toBeTruthy();
  });
});

describe('KeyValues', () => {
  it('renders label / value rows at every level', () => {
    render(
      <KeyValues
        rows={[
          ['Title', 'Hello'],
          ['Description', 'Missing', 'warn'],
          ['Status', '404', 'bad'],
          ['Canonical', 'Self', 'good'],
        ]}
      />,
    );
    expect(screen.getByText('Title').nextElementSibling?.textContent).toBe('Hello');
    expect(screen.getByText('Description').nextElementSibling?.textContent).toBe('Missing');
    expect(screen.getByText('404').className).toContain('text-poor-text');
    expect(screen.getByText('Self').className).not.toContain('text-good-text');
  });
});

describe('Table', () => {
  type Row = { name: string; n: number };
  const columns: Column<Row>[] = [
    { label: 'Name', render: (r) => r.name },
    { label: 'Count', width: '60px', render: (r) => String(r.n) },
  ];

  it('shows the default empty text', () => {
    render(<Table columns={columns} rows={[]} />);
    expect(screen.getByText('Nothing found.')).toBeTruthy();
    expect(screen.queryByText('Name')).toBeNull();
  });

  it('shows a custom empty text', () => {
    render(<Table columns={columns} rows={[]} empty="No links on this page." />);
    expect(screen.getByText('No links on this page.')).toBeTruthy();
  });

  it('renders headers and a cell per column and row', () => {
    render(
      <Table
        columns={columns}
        rows={[
          { name: 'alpha', n: 1 },
          { name: 'beta', n: 2 },
        ]}
      />,
    );
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Count')).toBeTruthy();
    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('tints rows by rowLevel', () => {
    render(
      <Table
        columns={columns}
        rows={[
          { name: 'ok', n: 1 },
          { name: 'broken', n: 0 },
        ]}
        rowLevel={(r) => (r.n ? undefined : 'bad')}
      />,
    );
    expect(screen.getByText('broken').parentElement!.className).toContain('bg-poor-tint');
    expect(screen.getByText('ok').parentElement!.className).not.toContain('bg-poor-tint');
  });

  it('shows the first rows and the rest on request, without an inner scroll area', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ name: `row ${i}`, n: i }));
    const { container } = render(<Table columns={columns} rows={rows} limit={3} />);
    expect(container.querySelector('.overflow-y-auto')).toBeNull();
    expect(screen.queryByText('row 3')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 5' }));
    expect(screen.getByText('row 4')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });
});

describe('Stats', () => {
  it('renders each figure with its label, level and sub line', () => {
    render(
      <Stats
        items={[
          { label: 'Images', value: '12', sub: '1.2 MB known' },
          { label: 'Missing alt', value: '3', level: 'warn' },
        ]}
      />,
    );
    expect(screen.getByText('Images').nextElementSibling?.textContent).toBe('12');
    expect(screen.getByText('1.2 MB known')).toBeTruthy();
    expect(screen.getByText('3').className).toContain('text-warn-text');
  });
});

describe('Button and LinkButton', () => {
  it.each(['primary', 'secondary', 'ghost'] as const)(
    'a %s button is a clickable button',
    (variant) => {
      const onClick = vi.fn();
      render(
        <Button variant={variant} size={variant === 'primary' ? 'md' : 'sm'} onClick={onClick}>
          Go
        </Button>,
      );
      const b = screen.getByRole('button', { name: 'Go' });
      expect(b.getAttribute('type')).toBe('button');
      fireEvent.click(b);
      expect(onClick).toHaveBeenCalledOnce();
    },
  );

  it('a disabled button does not fire', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it.each(['primary', 'secondary'] as const)(
    'a %s LinkButton opens in a new tab without a referrer',
    (variant) => {
      render(
        <LinkButton href="https://example.com/" variant={variant}>
          Open
        </LinkButton>,
      );
      const a = screen.getByRole('link', { name: 'Open' });
      expect(a.getAttribute('href')).toBe('https://example.com/');
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noreferrer');
    },
  );
});

describe('Switch', () => {
  it('reports the toggled value', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Switch checked={false} onChange={onChange} label="Offline mode" />,
    );
    const sw = screen.getByRole('switch', { name: 'Offline mode' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(<Switch checked onChange={onChange} label="Offline mode" />);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('does nothing while disabled', () => {
    const onChange = vi.fn();
    render(<Switch checked onChange={onChange} label="JS" disabled />);
    fireEvent.click(screen.getByRole('switch', { name: 'JS' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Select', () => {
  it('lists the options and reports the chosen value', () => {
    const onChange = vi.fn();
    render(
      <Select
        label="Report language"
        value="a"
        options={[
          ['a', 'English'],
          ['b', 'German'],
        ]}
        onChange={onChange}
        class="w-20"
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Report language' }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['English', 'German']);
    expect(select.value).toBe('a');
    fireEvent.change(select, { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('Banner', () => {
  it.each(['good', 'warn', 'bad', 'info'] as const)(
    'a %s banner shows its title and body',
    (level) => {
      render(
        <Banner level={level} title={`${level} title`}>
          {level} body
        </Banner>,
      );
      expect(screen.getByText(`${level} title`)).toBeTruthy();
      expect(screen.getByText(`${level} body`)).toBeTruthy();
    },
  );

  it('a banner without children shows only the title', () => {
    const { container } = render(<Banner level="good" title="All set" />);
    expect(container.textContent).toBe('All set');
  });
});
