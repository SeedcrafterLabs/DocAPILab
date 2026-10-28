import { it, expect, vi } from 'vitest';
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

// Serverless: the request that starts a job and the requests that poll it usually run on different instances, so all state must live in the database.
it.skipIf(!process.env.DOCS2API_TEST_DATABASE_URL)('shares sandboxes, jobs and limits across app instances', async () => {
  const { default: request } = await import('supertest');
  const { createApp } = await import('../src/server/app');
  const { SettingsStore } = await import('../src/server/store');
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const url = process.env.DOCS2API_TEST_DATABASE_URL; const settings = new SettingsStore(mkdtempSync(join(tmpdir(), 'docs2api-pg-')));
  const contract = { ...inegi, info: { ...inegi.info, title: 'Pg Orders' } };
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const fetchDocs = async (sourceUrl: string) => { await gate; return { text: 'Orders API reference', sourceUrl, direct: contract }; };
  const stores = [await createStore(':memory:', url), await createStore(':memory:', url)];
  const [a, b] = await Promise.all(stores.map(store => createApp({ store, settings, hosted: true, sessionSecret: 'test-secret', fetchDocs })));
  let owner = '';
  await stores[0].unlock('generation'); // a previously aborted run may have left it held until its TTL
  try {
    const first = await request(a.app).post('/api/integrations/catalog').send({ id: 'inegi' }).expect(201);
    const cookie = first.headers['set-cookie'][0].split(';')[0]; owner = (await stores[0].get(first.body.id))!.owner;
    expect((await request(b.app).get('/api/integrations').set('Cookie', cookie)).body).toHaveLength(1);
    const job = (await request(a.app).post('/api/jobs').set('Cookie', cookie).send({ url: 'https://docs.example.com' }).expect(202)).body;
    expect((await request(b.app).get('/api/jobs/' + job.id).set('Cookie', cookie).expect(200)).body.state).toMatch(/^(queued|fetching)$/); // progress written by instance A is visible to B
    await request(b.app).post('/api/jobs').set('Cookie', cookie).send({ url: 'https://docs.example.com' }).expect(429); // generation lock is global
    release();
    await vi.waitFor(async () => { expect((await request(b.app).get('/api/jobs/' + job.id).set('Cookie', cookie)).body.state).toBe('ready'); });
    expect((await request(a.app).get('/api/integrations').set('Cookie', cookie)).body).toHaveLength(2);
  } finally {
    release(); await vi.waitFor(async () => { expect(await stores[0].lock('generation', 1000)).toBe(true); }); await stores[0].unlock('generation'); // wait for the background job to finish
    for (const item of await stores[0].list(owner)) await stores[0].remove(item.id);
    await Promise.all(stores.map(store => store.close()));
  }
});
