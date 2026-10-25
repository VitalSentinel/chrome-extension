import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

// A tiny static site with known SEO properties for the end-to-end tests.
export const PORT = Number(process.env.E2E_PORT ?? 4791);
export const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
};

export function startSite(): Promise<Server> {
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/old') {
      res.writeHead(301, { Location: '/page.html' }).end();
      return;
    }
    try {
      const body = await readFile(
        join(import.meta.dirname, 'site', path === '/' ? 'page.html' : path),
      );
      res
        .writeHead(200, {
          'Content-Type': TYPES[extname(path)] ?? 'text/plain',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'max-age=60',
        })
        .end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}
