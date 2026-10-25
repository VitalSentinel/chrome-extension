import type { Config } from 'tailwindcss';

// Tokens copied from the app (frontend/src/app/globals.css, tailwind.config.js) so the
// extension reads as part of VitalSentinel. Values live in src/ui/tokens.css.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        ground: token('bg'),
        surface: { DEFAULT: token('surface'), inset: token('surface-inset') },
        hover: token('hover'),
        border: token('border'),
        hairline: token('hairline'),
        track: token('track'),
        control: token('control'),
        ink: { DEFAULT: token('ink'), 2: token('ink-2'), 3: token('ink-3') },
        accent: {
          DEFAULT: token('accent'),
          hover: token('accent-hover'),
          press: token('accent-press'),
          tint: token('accent-tint'),
          text: token('accent-text'),
          on: token('on-accent'),
        },
        focus: token('focus'),
        good: { DEFAULT: token('good'), text: token('good-text'), tint: token('good-tint') },
        warn: { DEFAULT: token('warn'), text: token('warn-text'), tint: token('warn-tint') },
        poor: {
          DEFAULT: token('poor'),
          text: token('poor-text'),
          tint: token('poor-tint'),
          solid: token('poor-solid'),
        },
        pop: { DEFAULT: token('pop'), on: token('on-pop') },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: [
          '"Space Grotesk"',
          '"Inter Variable"',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
        mono: ['"Space Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { pill: '999px', card: '14px', tile: '10px', inner: '12px' },
      fontSize: { '2xs': ['11px', '1.35'], xs: ['12px', '1.4'], sm: ['13px', '1.45'] },
    },
  },
  plugins: [],
} satisfies Config;
