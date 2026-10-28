import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app';
import { createStore, SettingsStore, type Store } from '../src/server/store';
import { inegi } from '../src/server/catalog';
import { validateContract, publicIntegration, sample } from '../src/server/contracts';
import { assembleExtraction, isPublicAddress, checkPublicUrl } from '../src/server/extract';
import { proposeMigration } from '../src/server/migration';
import type { Contract, Integration } from '../src/shared/types';

const orderResponse = { description: 'Order', content: { 'application/json': {
  schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } }, example: { id: 42 }
} } };
const testApi: Contract = {
  openapi: '3.0.3', info: { title: 'Orders', version: '1' }, servers: [{ url: 'https://api.example.com/v1' }],
  paths: {
    '/orders': { post: {
      summary: 'Create order',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } }, example: { name: 'Test' } } } },
      responses: { '201': orderResponse }
    } },
    '/orders/{id}': { get: {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' }, example: 42 }],
      responses: { '200': structuredClone(orderResponse) }
    } }
  }
};
describe('HTTP sandbox lifecycle', () => {
  let store: Store; let app: Awaited<ReturnType<typeof createApp>>['app']; let dir: string;
  beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'docs2api-test-')); store = await createStore(':memory:', ''); ({ app } = await createApp({ store, settings: new SettingsStore(dir), hosted: false })); });
  afterEach(async () => { await store.close(); rmSync(dir, { recursive: true, force: true }); });
  it('runs INEGI without credentials, validates parameters and retains scenario state', async () => {
    await request(app).get('/api/catalog').expect(200, []);
    const created = await request(app).post('/api/integrations/catalog').send({ id: 'inegi' }).expect(201);
    const item = created.body; expect(item.owner).toBeUndefined();
    const url = item.operations[0].exampleUrl; expect(url).not.toMatch(/token/i);
    const response = await request(app).get(url).expect(200);
    expect(response.headers['x-docs2api-simulated']).toBe('true'); expect(response.body.Series[0].OBSERVATIONS).toHaveLength(1);
    await request(app).get(url.replace('/es/', '/fr/')).expect(400);
    await request(app).get(url.replace('1002000001', '999')).expect(200).expect(r => expect(r.body.Series[0].INDICADOR).toBe('999'));
    await request(app).patch('/api/integrations/' + item.id).send({ scenario: 'error' }).expect(200);
    await request(app).get(url).expect(500);
    expect((await request(app).get('/api/integrations')).body[0].scenario).toBe('error');
    await request(app).patch('/api/integrations/' + item.id).send({ active: false }).expect(200);
    await request(app).get(url).expect(503);
    await request(app).delete('/api/integrations/' + item.id).expect(204);
    expect((await request(app).get('/api/integrations')).body).toHaveLength(0);
  });
  it('imports GET/POST APIs, validates request bodies and isolates prefixes', async () => {
    const a = (await request(app).post('/api/integrations/import').send({ contract: testApi }).expect(201)).body;
    const b = (await request(app).post('/api/integrations/import').send({ contract: testApi }).expect(201)).body;
    expect(a.prefix).not.toBe(b.prefix);
    await request(app).post('/' + a.prefix + '/orders').send({ name: 'Demo' }).expect(201, { id: 42 });
    await request(app).post('/' + a.prefix + '/orders').send({ wrong: 1 }).expect(400);
    await request(app).get('/' + a.prefix + '/orders/42').expect(200);
    await request(app).get('/' + a.prefix + '/orders/invalid').expect(400);
    await request(app).patch('/api/integrations/' + a.id).send({ active: false });
    await request(app).get('/' + b.prefix + '/orders/42').expect(200);
    await request(app).get('/' + b.prefix + '/unknown').expect(404);
  });
  it('rejects external refs, no endpoints, invalid examples and cross-origin administration', async () => {
    await request(app).post('/api/integrations/import').send({ contract: { ...testApi, paths: {} } }).expect(400);
    const unsafe = structuredClone(testApi); unsafe.paths['/orders'].post.responses['201'].content['application/json'].schema = { $ref: 'http://127.0.0.1/secret' };
    await request(app).post('/api/integrations/import').send({ contract: unsafe }).expect(400);
    const bad = structuredClone(testApi); bad.paths['/orders'].post.responses['201'].content['application/json'].example = { id: 'wrong' };
    await request(app).post('/api/integrations/import').send({ contract: bad }).expect(400);
    await request(app).get('/api/settings').set('Origin', 'https://evil.example').expect(403);
  });
  it('accepts OpenAPI 3.1 JSON Schema 2020-12', async () => {
    const modern = structuredClone(testApi); modern.openapi = '3.1.0';
    modern.paths['/orders'].post.responses['201'].content['application/json'].schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { id: { type: ['integer', 'null'] } }, required: ['id'], unevaluatedProperties: false };
    const item = (await request(app).post('/api/integrations/import').send({ contract: modern }).expect(201)).body;
    await request(app).post('/' + item.prefix + '/orders').send({ name: 'Test' }).expect(201, { id: 42 });
  });
  it('matches path parameters embedded before a file extension', async () => {
    const contract = structuredClone(testApi); contract.paths['/orders/{id}.json'] = contract.paths['/orders/{id}']; delete contract.paths['/orders/{id}'];
    const item = (await request(app).post('/api/integrations/import').send({ contract }).expect(201)).body;
    await request(app).get('/' + item.prefix + '/orders/42.json').expect(200, { id: 42 });
    await request(app).get('/' + item.prefix + '/orders/invalid.json').expect(400);
  });
  it('does not collapse an embedded secret placeholder onto a list route', async () => {
    const contract = structuredClone(testApi); contract.paths['/orders/{id}.json'] = contract.paths['/orders/{id}']; delete contract.paths['/orders/{id}'];
    contract.paths['/orders/{id}.json'].get.parameters[0]['x-secret'] = true;
    const item = (await request(app).post('/api/integrations/import').send({ contract }).expect(201)).body;
    const get = item.operations.find((op: any) => op.method === 'get'); expect(get.exampleUrl).toContain('/orders/sandbox.json');
    await request(app).get(get.exampleUrl).expect(200, { id: 42 });
  });
  it('never returns the saved OpenAI key', async () => {
    await request(app).put('/api/settings').send({ apiKey: 'sk-test-super-secret', model: 'gpt-4o-mini' }).expect(200);
    const r = await request(app).get('/api/settings').expect(200);
    expect(r.body.hasKey).toBe(true); expect(JSON.stringify(r.body)).not.toContain('sk-test');
    await request(app).put('/api/settings').send({ apiKey: '', model: 'gpt-4o-mini' });
    expect((await request(app).get('/api/settings')).body.hasKey).toBe(false);
  });
  it('job generation validates extracted contracts and recovers from failures', async () => {
    const extract = vi.fn().mockResolvedValue(testApi);
    const fetchDocs = vi.fn().mockResolvedValue({ text: 'GET /orders and POST /orders', sourceUrl: 'https://docs.example.com' });
    const settings = new SettingsStore(dir); settings.save({ apiKey: 'sk-test', model: 'gpt-4o-mini' });
    const custom = await createApp({ store, settings, hosted: false, extract, fetchDocs });
    const job = (await request(custom.app).post('/api/jobs').send({ url: 'https://docs.example.com' }).expect(202)).body;
    await vi.waitFor(async () => { expect((await request(custom.app).get('/api/jobs/' + job.id)).body.state).toBe('ready'); });
    expect(extract).toHaveBeenCalledOnce();
    extract.mockRejectedValueOnce(new Error('No endpoints found'));
    const bad = (await request(custom.app).post('/api/jobs').send({ url: 'https://docs.example.com' }).expect(202)).body;
    await vi.waitFor(async () => { expect((await request(custom.app).get('/api/jobs/' + bad.id)).body.state).toBe('failed'); });
    expect(await store.list('local')).toHaveLength(1);
  });
  it('isolates hosted sessions and disables user key management', async () => {
    const hosted = await createApp({ store, settings: new SettingsStore(dir), hosted: true, sessionSecret: 'test-secret' });
    const a = await request(hosted.app).post('/api/integrations/catalog').send({ id: 'inegi' }).expect(201);
    const cookie = a.headers['set-cookie'][0].split(';')[0];
    expect(a.body.prefix).not.toBe('INEGI');
    expect((await request(hosted.app).get('/api/integrations').set('Cookie', cookie)).body).toHaveLength(1);
    expect((await request(hosted.app).get('/api/integrations')).body).toHaveLength(0);
    await request(hosted.app).delete('/api/integrations/' + a.body.id).expect(404);
    await request(hosted.app).put('/api/settings').send({ model: 'x', apiKey: 'x' }).expect(403);
  });
  it('indexes documentation hubs in the background and exposes per-page progress', async () => {
    const settings = new SettingsStore(dir); settings.save({ apiKey: 'sk-test', model: 'gpt-4o-mini' });
    const fetchDocs = vi.fn().mockImplementation(async (url: string) => url.endsWith('/docs') ? { text: 'Welcome to the documentation portal. Choose a product reference.', sourceUrl: url, links: [{ url: 'https://docs.example.com/docs/orders/api/reference', title: 'Orders API', score: 30 }] } : { text: 'GET /orders returns order data', sourceUrl: url, links: [] });
    const extract = vi.fn().mockResolvedValue(testApi);
    const custom = await createApp({ store, settings, hosted: false, fetchDocs, extract });
    const initial = (await request(custom.app).post('/api/jobs').send({ url: 'https://docs.example.com/docs' }).expect(202)).body;
    await request(custom.app).get('/api/health').expect(200);
    await vi.waitFor(async () => { expect((await request(custom.app).get('/api/jobs/' + initial.id)).body.state).toBe('ready'); });
    const jobs = (await request(custom.app).get('/api/jobs').expect(200)).body;
    expect(jobs[0].pages.map((page: any) => page.state)).toEqual(['skipped', 'ready']);
    expect(jobs[0].pages[1].operations).toBe(2); expect(jobs[0].integrationIds).toHaveLength(1);
    expect(extract).toHaveBeenCalledOnce(); expect(extract.mock.calls[0][1]).toContain('/orders/api/reference');
  });
});
describe('durability and migration', () => {
  it('restores SQLite sandboxes after restarting the store', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'docs2api-db-'));
    const store = await createStore(directory, '');
    const item: Integration = { id: 'one', owner: 'local', prefix: 'INEGI', name: 'INEGI', sourceUrl: 'https://example.com', contract: inegi, version: '1', active: false, scenario: 'error', latencyMs: 123, createdAt: new Date().toISOString() };
    await store.save(item); await store.close();
    const reopened = await createStore(directory, ''); expect(await reopened.get('one')).toEqual(item); await reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });
  it('proposes a patch for INEGI with base URL and token variables, never writes files', async () => {
    const contract = await validateContract(inegi); const item = { name: 'INEGI', prefix: 'INEGI', contract } as Integration;
    const op = publicIntegration(item).operations[0];
    const code = `const response = await fetch("http://localhost:4000${op.exampleUrl}");`;
    const result = proposeMigration(item, 'client.ts', code);
    expect(result.changed).toBe(true); expect(result.code).toContain('process.env.INEGI_BASE_URL'); expect(result.code).toContain('process.env.INEGI_TOKEN'); expect(result.envExample).toContain('INEGI_TOKEN=');
    expect(result.code).not.toContain('localhost');
    expect(proposeMigration(item, 'client.js', code).code).not.toContain('TOKEN!');
    expect(proposeMigration(item, 'client.ts', 'fetch(dynamicUrl)').changed).toBe(false);
  });
});
describe('documentation boundaries', () => {
  it('bounds the work of generating samples from deeply nested schemas', () => {
    let schema: any = { type: 'string' };
    for (let i = 0; i < 8; i++) schema = { type: 'array', minItems: 10, items: schema };
    expect(() => sample(schema)).toThrow('complejidad');
  });
  it('blocks private and loopback addresses', async () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1', '::ffff:127.0.0.1', '100.64.0.1']) expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    await expect(checkPublicUrl('http://example.com')).rejects.toThrow();
    await expect(checkPublicUrl('https://127.0.0.1')).rejects.toThrow();
  });
  it('rejects invented evidence', () => {
    const contract = assembleExtraction({ title: 'Test', baseUrl: 'https://api.example.com', warnings: [], operations: [{ path: '/invented-path', evidenceQuote: 'GET /invented-path', summary: 'Invented' } as any] }, 'GET /orders', 'https://docs.example.com');
    expect(contract.paths).toEqual({}); expect(contract['x-warnings']?.[0]).toContain('cita verificable');
  });
});
