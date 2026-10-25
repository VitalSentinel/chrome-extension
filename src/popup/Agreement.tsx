import { useState } from 'preact/hooks';
import { PRIVACY_URL, TERMS_URL, TERMS_VERSION } from '../lib/config';
import { send } from '../lib/messages';
import type { Settings } from '../lib/settings';
import { Button, Switch, cx, toggleRow } from '../ui/kit';
import logo from '../assets/logo.svg';
import logoDark from '../assets/logo-dark.svg';
import { saveSettings, track } from './data';

// The Terms screen the popup shows until they are accepted, sized to fit the popup without
// scrolling. Domain Rating starts on; the anonymous daily usage and error counts, which one switch
// covers, are consent and start off.

const link = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noreferrer" class="underline">
    {text}
  </a>
);

function Choice({
  title,
  hint,
  checked,
  onChange,
  accent,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  accent?: boolean; // the anonymous counts, highlighted
}) {
  return (
    <div
      class={cx(
        'flex cursor-pointer items-center justify-between gap-6 rounded-card border px-4 py-3',
        accent ? 'border-accent bg-accent-tint' : 'border-border bg-surface',
      )}
      onClick={toggleRow}
    >
      <div class="flex min-w-0 flex-col gap-0.5">
        <span class="text-[14px] font-semibold">{title}</span>
        <span class="text-ink-2">{hint}</span>
      </div>
      <Switch large checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

export function Agreement({
  settings,
  onAgree,
}: {
  settings: Settings;
  onAgree: (s: Settings) => void;
}) {
  const first = !settings.termsAccepted;
  // Accepting newer Terms starts from the choices the user already made.
  const [dr, setDr] = useState(first || settings.drConsent);
  const [stats, setStats] = useState(settings.usageStats || settings.errorReports);
  const [busy, setBusy] = useState(false);

  const agree = async () => {
    setBusy(true);
    try {
      const next = await saveSettings({
        termsAccepted: TERMS_VERSION,
        drConsent: dr,
        errorReports: stats,
        usageStats: stats,
      });
      if (dr) await send('badge:refresh', {});
      if (first) track('install');
      onAgree(next);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div class="flex flex-col">
      <div class="flex flex-col gap-2.5">
        <Choice
          title="Domain Rating on the icon"
          hint="Sends each site's domain, never the full address, to VitalSentinel, which asks Ahrefs."
          checked={dr}
          onChange={setDr}
        />
        <Choice
          accent
          title="Share anonymous usage and error counts"
          hint="Once a day, so we can fix bugs and improve features. Never the pages you visit."
          checked={stats}
          onChange={setStats}
        />
      </div>
      <p class="mt-5">
        By clicking Agree and continue you accept the {link(TERMS_URL, 'Terms and Conditions')} and
        confirm you have read the {link(PRIVACY_URL, 'Privacy Policy')}. You can change any choice
        later in Settings.
      </p>
      <Button variant="primary" size="lg" class="mt-4 self-start" disabled={busy} onClick={agree}>
        Agree and continue
      </Button>
    </div>
  );
}

/** The whole first screen: what the extension does, then the Terms and the choices. */
export function Onboarding({
  settings,
  onAgree,
}: {
  settings: Settings;
  onAgree: (s: Settings) => void;
}) {
  return (
    <div class="flex flex-col text-[13.5px]">
      <img src={logo} alt="VitalSentinel" class="h-8 w-auto self-start dark:hidden" />
      <img src={logoDark} alt="VitalSentinel" class="hidden h-8 w-auto self-start dark:block" />
      <span class="mt-8 text-[11.5px] font-semibold uppercase tracking-wider text-accent-text">
        Welcome to VitalSentinel SEO Extension
      </span>
      <h1 class="mt-1.5 font-display text-[24px] font-bold leading-tight">
        See what holds any page back, in one click
      </h1>
      <p class="mt-2 text-[14.5px] text-ink-2">
        SEO, Core Web Vitals and technical checks for any page, measured in your browser. Free.
      </p>
      <div class="mt-6">
        <Agreement settings={settings} onAgree={onAgree} />
      </div>
    </div>
  );
}
