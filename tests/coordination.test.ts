import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createStore } from '../src/server/store';
import type { Job } from '../src/shared/types';

// The same behavior must hold for the in-memory (local) and PostgreSQL (hosted) implementations.
const backends = [
  { name: 'memory', url: '' },
  { name: 'postgres', url: process.env.DOCS2API_TEST_DATABASE_URL || '', skip: !process.env.DOCS2API_TEST_DATABASE_URL }
];
afterEach(() => { vi.useRealTimers(); });
for (const backend of backends) describe.skipIf(backend.skip)(`coordination (${backend.name})`, () => {
  const open = () => createStore(':memory:', backend.url);
  const job = (): Job => ({ id: randomUUID(), state: 'queued', message: 'x', pages: [], integrationIds: [] });

  it('stores jobs per owner and reflects updates', async () => {
    const store = await open(); const owner = randomUUID(); const mine = job();
    try {
      await store.saveJob(owner, mine); mine.state = 'ready'; mine.message = 'done'; await store.saveJob(owner, mine);
      expect(await store.getJob(mine.id, owner)).toMatchObject({ id: mine.id, state: 'ready', message: 'done' });
      expect(await store.getJob(mine.id, randomUUID())).toBeUndefined();
      expect((await store.listJobs(owner)).map(j => j.id)).toEqual([mine.id]);
      expect(await store.listJobs(randomUUID())).toEqual([]);
    } finally { await store.close(); }
  });

  it('enforces quota limits atomically', async () => {
    const store = await open(); const key = 'test:' + randomUUID();
    try {
      expect(await store.quota(key)).toBe(0);
      const results = await Promise.all(Array.from({ length: 8 }, () => store.consume(key, 3, 60_000)));
      expect(results.filter(Boolean)).toHaveLength(3);
      expect(await store.quota(key)).toBe(3);
      expect(await store.consume(key, 3, 60_000)).toBe(false);
    } finally { await store.close(); }
  });

  it('restarts a quota once its window has passed', async () => {
    const store = await open(); const key = 'test:' + randomUUID();
    try {
      expect(await store.consume(key, 1, 150)).toBe(true); expect(await store.consume(key, 1, 150)).toBe(false);
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(await store.quota(key)).toBe(0); expect(await store.consume(key, 1, 150)).toBe(true);
    } finally { await store.close(); }
  });

  it('grants a lock to one holder until released or expired', async () => {
    const store = await open(); const name = 'test-' + randomUUID();
    try {
      const results = await Promise.all(Array.from({ length: 5 }, () => store.lock(name, 60_000)));
      expect(results.filter(Boolean)).toHaveLength(1);
      await store.unlock(name); expect(await store.lock(name, 150)).toBe(true);
      expect(await store.lock(name, 150)).toBe(false);
      await new Promise(resolve => setTimeout(resolve, 250)); expect(await store.lock(name, 60_000)).toBe(true);
    } finally { await store.unlock(name); await store.close(); }
  });
});
