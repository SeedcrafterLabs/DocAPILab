import { afterEach, expect, it, vi } from 'vitest';
import { fetchFirecrawlDocumentation } from '../src/server/firecrawl';
afterEach(() => vi.unstubAllGlobals());
it('requires a personal Firecrawl key before making requests', async () => {
  const mocked = vi.fn(); vi.stubGlobal('fetch', mocked);
  await expect(fetchFirecrawlDocumentation('https://example.com')).rejects.toThrow('Firecrawl');
  expect(mocked).not.toHaveBeenCalled();
});
it('reads markdown and same-site references through Firecrawl', async () => {
  const mocked = vi.fn().mockResolvedValue(Response.json({ success: true, data: { markdown: 'GET /orders returns a JSON array of orders with identifier and status.', links: ['https://8.8.8.8/docs/api/orders', 'https://other.example/docs/api'] } }));
  vi.stubGlobal('fetch', mocked);
  const doc = await fetchFirecrawlDocumentation('https://8.8.8.8/docs', 'fc-private');
  expect(doc.text).toContain('GET /orders'); expect(doc.links?.map(link => link.url)).toContain('https://8.8.8.8/docs/api/orders');
  const [url, init] = mocked.mock.calls[0]; expect(url).toBe('https://api.firecrawl.dev/v2/scrape'); expect(init.headers.Authorization).toBe('Bearer fc-private');
  expect(JSON.stringify(doc)).not.toContain('fc-private');
});
it('does not expose provider error bodies or credentials', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'fc-private' }, { status: 402 })));
  await expect(fetchFirecrawlDocumentation('https://8.8.8.8/docs', 'fc-private')).rejects.toThrow('HTTP 402');
});
