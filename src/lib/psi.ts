// PageSpeed Insights runs on Google's servers; the extension only links to it. Opening this URL
// starts the test for the page.

export function pagespeedWebUrl(url: string): string {
  return `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}`;
}
