import { defineConfig } from 'wxt';

// Public half of the development signing key. It pins the unpacked build to the extension
// ID ppnfgofoagpedmdbggnmlfomgnhjljal, which the app registers as an OAuth redirect URI.
// Store builds (STORE_BUILD=1) leave it out: the stores assign their own IDs.
const DEV_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAk2e1MK0Dlk5bt8+MntXhm+n5yMPdeN6RaZaa6Yh2aI2N0Fk8xjUcXUh8zzM5e8+z242yJDOYPOzJHikA/BCG+AIiXJWUa9EUEwecs76roZwnYET93SwHxFd4gojoNwRotST2/yxjfRLxL/QBbHpvEvBlJuxO+Y6P8VxC8qQFaehABx5cFoOQkJYsYRHFNGEkdcdRX5KsbYiTPpuzbMFgms5JdkcdPwXycLAjrsj6YeNjh73C+oHRFlwUzianHz6H2vTk6BEFzfLM6chKU9tNPiOWEj3iHuQgKsa6kiJnEmSR5QW8xxUyinxMwOJjue25nY9i+Y9BPF2AHTdcoLtuNQIDAQAB';

export default defineConfig({
  srcDir: 'src',
  publicDir: 'public',
  imports: false,
  manifestVersion: 3,
  manifest: () => ({
    name: '__MSG_extName__',
    short_name: '__MSG_extShortName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    minimum_chrome_version: '120',
    ...(process.env.STORE_BUILD === '1' ? {} : { key: DEV_KEY }),
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: {
      default_title: 'VitalSentinel',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png' },
    },
    permissions: [
      'contentSettings',
      'contextMenus',
      'cookies',
      'identity',
      'scripting',
      'storage',
      'webNavigation',
      'webRequest',
    ],
    host_permissions: ['<all_urls>'],
    commands: {
      'toggle-js': {
        suggested_key: { default: 'Alt+Shift+Q' },
        description: '__MSG_cmdToggleJs__',
      },
    },
  }),
  vite: () => ({
    oxc: { jsx: { runtime: 'automatic' as const, importSource: 'preact' } },
    build: { target: 'chrome120', modulePreload: false, reportCompressedSize: false },
  }),
});
