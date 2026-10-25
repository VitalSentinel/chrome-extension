import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDomainUrl } from '../../../src/lib/config';
import { MonitorPromo, SignInPitch, StartMonitoring } from '../../../src/popup/Promo';
import { SIGNED_IN, mockSend, tabContext } from './fixtures';

vi.mock('../../../src/lib/messages', () => ({ send: vi.fn() }));

afterEach(cleanup);

const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
const items = (list: HTMLElement) =>
  within(list)
    .getAllByRole('listitem')
    .map((li) => li.textContent);
const offer = () => items(screen.getByRole('list', { name: 'Free plan' }));
const modules = () =>
  items(
    within(screen.getByRole('region', { name: 'Everything VitalSentinel monitors' })).getByRole(
      'list',
    ),
  );

describe('MonitorPromo', () => {
  it('offers the add-domain flow for the www-less host', () => {
    render(<MonitorPromo ctx={tabContext()} />);
    expect(screen.getByText('Monitor example.com – free for one domain')).toBeTruthy();
    expect(screen.getByText('Real-user Core Web Vitals, indexing and SEO changes.')).toBeTruthy();
    const link = href('Start monitoring')!;
    expect(link).toBe(addDomainUrl('example.com'));
    expect(new URL(link).pathname).toBe('/onboarding/domain');
    expect(new URL(link).searchParams.get('domain')).toBe('example.com');
    expect(new URL(link).searchParams.get('utm_source')).toBe('extension');
  });

  it('takes its own title and text', () => {
    render(
      <MonitorPromo
        ctx={tabContext({ url: 'https://shop.acme.co.uk/cart' })}
        title="Real users, real Core Web Vitals"
        text="One domain is free."
      />,
    );
    expect(screen.getByText('Real users, real Core Web Vitals')).toBeTruthy();
    expect(screen.getByText('One domain is free.')).toBeTruthy();
    expect(href('Start monitoring')).toBe(addDomainUrl('shop.acme.co.uk'));
  });
});

describe('SignInPitch', () => {
  let resolveSignIn: (v: unknown) => void;
  let send: ReturnType<typeof mockSend>;
  beforeEach(() => {
    send = mockSend({ 'auth:signIn': () => new Promise((r) => (resolveSignIn = r as never)) });
  });

  it('leads with the free plan and every module in the app sidebar order', () => {
    render(<SignInPitch ctx={tabContext()} reload={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Your site breaks quietly.We make sure you hear it.',
    );
    expect(screen.getByText(/free for one domain/)).toBeTruthy();
    expect(offer()).toEqual(['Every module included', 'No credit card', 'Live in under 5 minutes']);
    const names = modules();
    expect(names).toHaveLength(12);
    expect(names[0]).toBe('Site health monitoringA technical SEO crawl that never stops');
    expect(names.at(-1)).toBe('Synthetic monitoringScheduled Lighthouse audits');
    expect(href('Start monitoring free')).toBe(addDomainUrl('example.com'));
  });

  it('keeps every visible text in sentence case', () => {
    const { container } = render(<SignInPitch ctx={tabContext()} reload={vi.fn()} />);
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const texts: string[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n.textContent!.trim());
    expect(texts.filter(Boolean).length).toBeGreaterThan(30);
    expect(texts.filter((t) => /^[a-z]/.test(t))).toEqual([]);
  });

  it('counts a click on the free-plan offer', () => {
    render(<SignInPitch ctx={tabContext()} reload={vi.fn()} />);
    fireEvent.click(screen.getByRole('link', { name: 'Start monitoring free' }));
    expect(send).toHaveBeenCalledWith('usage:count', { event: 'promo.click' });
  });

  it('signs in through the worker, busy meanwhile, then reloads', async () => {
    const reload = vi.fn();
    render(<SignInPitch ctx={tabContext()} reload={reload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with VitalSentinel' }));
    const busy = await screen.findByRole('button', { name: 'Signing in…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(send).toHaveBeenCalledWith('auth:signIn', {});

    resolveSignIn({ ok: true, data: SIGNED_IN });
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Sign in with VitalSentinel' })).toBeTruthy();
  });

  it('shows the error and does not reload when sign-in fails', async () => {
    const reload = vi.fn();
    render(<SignInPitch ctx={tabContext()} reload={reload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with VitalSentinel' }));
    await screen.findByRole('button', { name: 'Signing in…' });
    resolveSignIn({ ok: false, status: 0, error: 'The sign-in window was closed.' });
    expect(await screen.findByText('The sign-in window was closed.')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it('shows a thrown error', async () => {
    mockSend({
      'auth:signIn': () => {
        throw new Error('No identity API');
      },
    });
    render(<SignInPitch ctx={tabContext()} reload={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with VitalSentinel' }));
    expect(await screen.findByText('No identity API')).toBeTruthy();
  });
});

describe('StartMonitoring', () => {
  it('offers to add the domain, without naming a workspace', () => {
    render(<StartMonitoring ctx={tabContext({ auth: SIGNED_IN })} reload={vi.fn()} />);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'example.com is not monitored in VitalSentinel',
      }),
    ).toBeTruthy();
    expect(screen.getByText(/Your workspace does not monitor it/)).toBeTruthy();
    expect(screen.getByText(/Add it to a workspace and the reports fill/)).toBeTruthy();
    expect(screen.queryByText(/Acme/)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Free plan' })).toBeNull();
    expect(screen.queryByText('Everything VitalSentinel monitors')).toBeNull();
    expect(href('Add example.com ↗')).toBe(addDomainUrl('example.com'));
    expect(screen.getByText(/Wrong account\?/)).toBeTruthy();
  });

  it('counts several workspaces, and signs out', async () => {
    const send = mockSend({
      'auth:signOut': () => ({ signedIn: false, workspaces: [], roles: {} }),
    });
    const reload = vi.fn();
    const auth = {
      ...SIGNED_IN,
      workspaces: [...SIGNED_IN.workspaces, { id: 'ws2', name: 'Other', plan: null }],
    };
    render(<StartMonitoring ctx={tabContext({ auth })} reload={reload} />);
    expect(screen.getByText(/None of your 2 workspaces monitors it/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith('auth:signOut', {});
  });
});
