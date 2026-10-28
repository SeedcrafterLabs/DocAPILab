import { it, expect } from 'vitest';
import { createStore } from '../src/server/store';
import { inegi } from '../src/server/catalog';
import type { Integration } from '../src/shared/types';
import { randomUUID } from 'node:crypto';
it.skipIf(!process.env.DOCS2API_TEST_DATABASE_URL)('persists and isolates integrations using PostgreSQL', async () => {
  const store = await createStore(':memory:', process.env.DOCS2API_TEST_DATABASE_URL);
  const id = randomUUID();
  const item: Integration = { id, owner: id, prefix: id, name: 'INEGI', sourceUrl: 'https://example.com', contract: inegi, version: '1', active: true, scenario: 'success', latencyMs: 100, createdAt: new Date().toISOString() };
  try {
    await store.save(item); expect(await store.get(id)).toEqual(item); expect(await store.byPrefix(id)).toEqual(item);
    expect(await store.list(id)).toHaveLength(1); expect(await store.list('another-' + id)).toHaveLength(0);
    item.active = false; await store.save(item); expect((await store.get(id))?.active).toBe(false);
  } finally { await store.remove(id); await store.close(); }
});
