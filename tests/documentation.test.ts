import { expect, it, vi } from 'vitest';
import { readDocumentation } from '../src/server/documentation';
const endpoint = { text: 'GET /orders returns orders', sourceUrl: 'https://example.com/docs' };
it('uses Firecrawl first when it finds endpoints', async () => {
  const readers = { primary: vi.fn().mockResolvedValue(endpoint), fallback: vi.fn() };
  expect(await readDocumentation(endpoint.sourceUrl, 'fc-test', undefined, readers)).toEqual(endpoint);
  expect(readers.fallback).not.toHaveBeenCalled();
});
it('falls back after Firecrawl errors and exposes progress', async () => {
  const notify = vi.fn();
  const readers = { primary: vi.fn().mockRejectedValue(new Error('private upstream error')), fallback: vi.fn().mockResolvedValue(endpoint) };
  expect((await readDocumentation(endpoint.sourceUrl, 'fc-test', notify, readers)).text).toBe(endpoint.text);
  expect(notify).toHaveBeenCalledOnce();
});
it('reads directly when Firecrawl has no endpoints and preserves discovered links', async () => {
  const link = { url: 'https://example.com/docs/reference', title: 'Reference', score: 30 };
  const readers = { primary: vi.fn().mockResolvedValue({ ...endpoint, text: 'API overview', links: [link] }), fallback: vi.fn().mockResolvedValue(endpoint) };
  const result = await readDocumentation(endpoint.sourceUrl, 'fc-test', undefined, readers);
  expect(result.text).toBe(endpoint.text); expect(result.links).toEqual([link]);
});
it('preserves Firecrawl content when direct access fails', async () => {
  const primary = { ...endpoint, text: 'Useful overview without endpoint declarations' };
  const readers = { primary: vi.fn().mockResolvedValue(primary), fallback: vi.fn().mockRejectedValue(new Error('blocked')) };
  expect(await readDocumentation(endpoint.sourceUrl, 'fc-test', undefined, readers)).toEqual(primary);
});
it('reports unreadable pages without leaking upstream errors', async () => {
  const readers = { primary: vi.fn().mockRejectedValue(new Error('secret')), fallback: vi.fn().mockRejectedValue(new Error('secret')) };
  await expect(readDocumentation(endpoint.sourceUrl, 'fc-test', undefined, readers)).rejects.toThrow('Firecrawl y la lectura directa');
});
