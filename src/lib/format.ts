const nf = new Intl.NumberFormat('en');

export const num = (n: number) => nf.format(n);

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`;
}

export function compact(n: number): string {
  if (n < 10_000) return num(n);
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** A visit length, as the app shows it: `2 min 52 s`. */
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export function pct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function date(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function ago(iso: string | number, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** Display text starts with a capital: `granted` → `Granted`. */
export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
