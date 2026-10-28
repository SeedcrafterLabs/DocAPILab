import express, { type Request } from 'express';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { catalog, demoCatalog, inegi } from './catalog.js';
import { createStore, SettingsStore, type Store } from './store.js';
import { compileSchema, operations, localPath, routePattern, publicIntegration, responseExample, validateContract, version, isSecret } from './contracts.js';
import { fetchDocumentation, extractContract, hasEndpointDocumentation } from './extract.js';
import { fetchFirecrawlDocumentation } from './firecrawl.js';
import { proposeMigration } from './migration.js';
import type { Contract, Integration, Job } from '../shared/types.js';

interface Options { store?: Store; settings?: SettingsStore; hosted?: boolean; sessionSecret?: string; extract?: typeof extractContract; fetchDocs?: typeof fetchDocumentation }
export async function createApp(options: Options = {}) {
  const ownedJobs = new Map<string, { owner: string; job: Job }>();
  const app = express(); const store = options.store || await createStore(); const settings = options.settings || new SettingsStore();
  const hosted = options.hosted ?? process.env.DOCS2API_MODE === 'hosted';
  const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET || (hosted ? '' : randomUUID());
  if (!sessionSecret) throw new Error('SESSION_SECRET es obligatorio en modo hosted.');
  let busy = false, totalCalls = 0;
  const quotas = new Map<string, number>();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    if (!hosted && !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host || '')) return res.status(403).json({ error: 'Host local inválido.' });
    if (req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store');
      if (req.headers.origin) {
        let sameOrigin = false;
        try { const origin = new URL(req.headers.origin); sameOrigin = origin.host === req.headers.host && (origin.protocol === 'https:' || (!hosted && origin.protocol === 'http:') || (hosted && process.env.COOKIE_SECURE === 'false' && origin.protocol === 'http:')); } catch { /* reject invalid origins */ }
        if (!sameOrigin && !(process.env.NODE_ENV !== 'production' && !hosted && /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(req.headers.origin))) return res.status(403).json({ error: 'Origen no autorizado.' });
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Origen no autorizado.' });
    }
    next();
  });
  app.use(express.json({ limit: '600kb' }));
  app.use('/api', (req, res, next) => {
    if (!hosted) { res.locals.owner = 'local'; return next(); }
    const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('d2a='))?.slice(4);
    const sign = (s: string) => createHmac('sha256', sessionSecret).update(s).digest('hex');
    const [id, timestamp, signature] = (cookie || '').split('.'); const payload = id + '.' + timestamp; const expected = sign(payload);
    if (id && timestamp && signature?.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) && Date.now() - Number(timestamp) < 86400_000) res.locals.owner = id;
    else {
      const owner = randomUUID(); const value = owner + '.' + Date.now();
      res.cookie('d2a', value + '.' + sign(value), { httpOnly: true, secure: process.env.COOKIE_SECURE !== 'false', sameSite: 'strict', maxAge: 86400_000 }); res.locals.owner = owner;
    }
    next();
  });
  const getOwned = async (id: string, owner: string) => { const item = await store.get(id); if (!item || item.owner !== owner) throw Object.assign(new Error('Sandbox no encontrado.'), { status: 404 }); return item; };
  async function createIntegration(contract: Contract, owner: string, sourceUrl: string) {
    if ((await store.list(owner)).length >= 20) throw new Error('Máximo 20 sandboxes por sesión. Elimina alguno para continuar.');
    const id = randomUUID();
    const name = contract.info.title.slice(0, 80);
    const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30) || 'API';
    const prefix = hosted || await store.byPrefix(slug) ? slug + '_' + id.replaceAll('-', '') : slug;
    const item: Integration = { id, owner, name, prefix, sourceUrl, contract, version: version(contract), active: true, scenario: 'success', latencyMs: 1000, createdAt: new Date().toISOString() };
    await store.save(item); return item;
  }
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', version: '0.1.0' }));
  app.get('/api/catalog', (_req, res) => res.json(catalog.map(({ contract, ...entry }) => entry)));
  app.get('/api/settings', (_req, res) => res.json(settings.publicStatus(hosted)));
  app.put('/api/settings', (req, res) => {
    if (hosted) return res.status(403).json({ error: 'La configuración de la demo la administra el servidor.' });
    const body = z.object({ provider: z.enum(['openai', 'google', 'deepseek', 'anthropic']).optional(), apiKey: z.string().max(500).optional(), firecrawlApiKey: z.string().max(500).optional(), model: z.string().regex(/^[a-zA-Z0-9._:-]+$/).max(100) }).parse(req.body);
    const current = settings.read(body.provider); settings.save({ provider: current.provider, model: body.model, firecrawlApiKey: body.firecrawlApiKey, apiKey: body.apiKey === '' ? undefined : body.apiKey || current.apiKey }); res.json({ saved: true });
  });
  app.get('/api/integrations', async (_req, res) => res.json((await store.list(res.locals.owner)).map(publicIntegration)));
  app.post('/api/integrations/catalog', async (req, res) => {
    if (req.body.id !== 'inegi') return res.status(404).json({ error: 'API no encontrada en el catálogo.' });
    const contract = await validateContract(structuredClone(inegi));
    res.status(201).json(publicIntegration(await createIntegration(contract, res.locals.owner, demoCatalog[0].sourceUrl)));
  });
  app.post('/api/integrations/import', async (req, res) => {
    const body = z.object({ contract: z.any() }).parse(req.body);
    const contract = await validateContract(body.contract);
    res.status(201).json(publicIntegration(await createIntegration(contract, res.locals.owner, 'OpenAPI importado')));
  });
  app.post('/api/jobs', async (req, res) => {
    const { url } = z.object({ url: z.url().max(2000) }).parse(req.body);
    const current = settings.read();
    if (!options.fetchDocs && (!current.apiKey || !current.firecrawlApiKey)) return res.status(400).json({ error: 'Configura una clave de OpenAI, DeepSeek, Google Gemini o Anthropic y tu clave de Firecrawl en Ajustes.' });
    if (busy) return res.status(429).json({ error: 'Hay una generación en curso. Intenta de nuevo en unos segundos.' });
    const owner = res.locals.owner as string;
    // In hosted mode, use the actual TCP peer as well as the signed session; never trust forwarded headers.
    const quotaKey = hosted ? req.socket.remoteAddress || owner : owner;
    if ((quotas.get(quotaKey) || 0) >= Number(process.env.AI_MAX_CALLS_PER_SESSION || (hosted ? 3 : 100))) return res.status(429).json({ error: 'Límite de generación alcanzado para esta sesión/red.' });
    if (totalCalls >= Number(process.env.AI_MAX_CALLS_TOTAL || (hosted ? 30 : 1000))) return res.status(429).json({ error: 'Presupuesto de llamadas de esta instancia agotado.' });
    const job: Job = { id: randomUUID(), state: 'queued', message: 'Preparando documentación…', sourceUrl: url, pages: [], integrationIds: [] };
    ownedJobs.set(job.id, { owner, job });
    if (ownedJobs.size > 200) ownedJobs.delete(ownedJobs.keys().next().value!);
    busy = true;
    res.status(202).json(job);
    void (async () => {
      try {
        const queue = [{ url, title: 'Documentación inicial', score: 0, depth: 0 }];
        const visited = new Set<string>(); let modelCalls = 0;
        while (queue.length && visited.size < 8 && job.integrationIds!.length < 3) {
          queue.sort((a, b) => b.score - a.score);
          const next = queue.shift()!; if (visited.has(next.url)) continue; visited.add(next.url);
          const page: NonNullable<Job['pages']>[number] = { url: next.url, title: next.title, state: 'reading' };
          job.pages!.push(page); job.state = 'fetching'; job.message = `Leyendo página ${visited.size}/8: ${next.title}`;
          try {
            const doc = options.fetchDocs ? await options.fetchDocs(next.url) : await fetchFirecrawlDocumentation(next.url, current.firecrawlApiKey);
            if (next.depth < 2) for (const link of (doc.links || []).slice(0, 12)) if (!visited.has(link.url) && !queue.some(entry => entry.url === link.url)) queue.push({ ...link, depth: next.depth + 1 });
            if (!doc.direct && !hasEndpointDocumentation(doc.text) && doc.links?.length) { page.state = 'skipped'; page.message = 'Índice de documentación: buscando referencias de API en sus enlaces.'; continue; }
            let contract: Contract;
            if (doc.direct) contract = await validateContract(doc.direct);
            else {
              if (!current.apiKey) throw new Error('Agrega la API key del proveedor seleccionado en Ajustes.');
              if (modelCalls >= 3) { page.state = 'skipped'; page.message = 'Límite de 3 análisis de IA por indexación.'; continue; }
              if (totalCalls >= Number(process.env.AI_MAX_CALLS_TOTAL || (hosted ? 30 : 1000)) || (quotas.get(quotaKey) || 0) >= Number(process.env.AI_MAX_CALLS_PER_SESSION || (hosted ? 3 : 100))) { page.state = 'skipped'; page.message = 'Límite de consumo alcanzado.'; break; }
              totalCalls++; modelCalls++; quotas.set(quotaKey, (quotas.get(quotaKey) || 0) + 1);
              page.state = 'analyzing'; job.state = 'extracting'; job.message = `Analizando ${next.title} con ${current.provider}…`;
              contract = await (options.extract || extractContract)(doc.text, doc.sourceUrl, current.apiKey, current.model, current.provider);
            }
            job.state = 'validating'; job.message = 'Validando contrato y ejemplos JSON…';
            contract = await validateContract(contract);
            const item = await createIntegration(contract, owner, doc.sourceUrl);
            page.state = 'ready'; page.title = item.name; page.integrationId = item.id; page.operations = operations(contract).length;
            job.integrationId ||= item.id; job.integrationIds!.push(item.id);
          } catch (error) { page.state = 'skipped'; page.message = safeError(error); }
          // A concrete endpoint page is a complete request; only hubs expand into a crawl.
          if (next.depth === 0 && page.state === 'ready') break;
          if (modelCalls >= 3) break;
        }
        if (!job.integrationIds!.length) throw new Error('No encontramos endpoints verificables. El sitio puede ser un índice, requerir JavaScript o una referencia de API más específica. ' + (job.pages?.at(-1)?.message || ''));
        job.state = 'ready'; job.message = `${job.integrationIds!.length} sandbox(s) listos. ${visited.size} páginas revisadas.`;
      } catch (error) { job.state = 'failed'; job.error = safeError(error); job.message = job.error; }
      finally { busy = false; }
    })();
  });
  app.get('/api/jobs', (_req, res) => res.json([...ownedJobs.values()].filter(entry => entry.owner === res.locals.owner).map(entry => entry.job).reverse().slice(0, 20)));
  app.get('/api/jobs/:id', (req, res) => { const entry = ownedJobs.get(req.params.id); if (!entry || entry.owner !== res.locals.owner) return res.status(404).json({ error: 'Generación no encontrada.' }); res.json(entry.job); });
  app.get('/api/integrations/:id/contract', async (req, res) => { const item = await getOwned(req.params.id, res.locals.owner); res.attachment(item.prefix + '.openapi.json').json(item.contract); });
  app.patch('/api/integrations/:id', async (req, res) => {
    const item = await getOwned(req.params.id, res.locals.owner);
    const patch = z.object({ active: z.boolean().optional(), scenario: z.enum(['success', 'error', 'latency']).optional(), latencyMs: z.number().int().min(0).max(5000).optional() }).strict().parse(req.body);
    Object.assign(item, patch); await store.save(item); res.json(publicIntegration(item));
  });
  app.delete('/api/integrations/:id', async (req, res) => { await getOwned(req.params.id, res.locals.owner); await store.remove(req.params.id); res.status(204).end(); });
  app.post('/api/integrations/:id/migration', async (req, res) => {
    const item = await getOwned(req.params.id, res.locals.owner);
    const body = z.object({ filename: z.string().max(200), code: z.string().max(150_000) }).parse(req.body);
    res.json(proposeMigration(item, body.filename, body.code));
  });
  app.use(async (req, res, next) => {
    const [prefix, ...segments] = req.path.slice(1).split('/');
    if (!prefix || prefix === 'api') return next();
    const item = await store.byPrefix(prefix); if (!item) return next();
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key'); res.setHeader('X-Docs2api-Simulated', 'true'); res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!item.active) return res.status(503).json({ error: 'Sandbox pausado.', simulated: true });
    const path = '/' + segments.join('/');
    for (const entry of operations(item.contract)) {
      if (entry.method !== req.method.toLowerCase()) continue;
      const { names, regex } = routePattern(localPath(entry.path, entry.operation));
      const match = regex.exec(path); if (!match) continue;
      const params: Record<string, string> = {}; names.forEach((n, i) => { params[n] = decodeURIComponent(match[i + 1]); });
      const issues: string[] = [];
      for (const parameter of entry.operation.parameters || []) {
        if (isSecret(parameter)) continue;
        const value = parameter.in === 'path' ? params[parameter.name] : parameter.in === 'query' ? req.query[parameter.name] : parameter.in === 'header' ? req.get(parameter.name) : req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(parameter.name + '='))?.slice(parameter.name.length + 1);
        if (value === undefined) { if (parameter.required) issues.push('Falta ' + parameter.name); continue; }
        const validate = compileSchema({ type: 'object', properties: { value: parameter.schema || {} } }, item.contract.openapi.startsWith('3.1'));
        if (!validate({ value })) issues.push('Valor inválido: ' + parameter.name);
      }
      const media = entry.operation.requestBody?.content?.['application/json'];
      if (entry.operation.requestBody?.required && req.body === undefined) issues.push('Falta el cuerpo JSON.');
      if (media?.schema && req.body !== undefined && !compileSchema(media.schema, item.contract.openapi.startsWith('3.1'), false)(req.body)) issues.push('El cuerpo no coincide con el schema documentado.');
      if (issues.length) return res.status(400).json({ error: 'Solicitud inválida.', details: issues, simulated: true });
      if (item.scenario === 'latency') await new Promise(resolve => setTimeout(resolve, item.latencyMs));
      const statuses = Object.keys(entry.operation.responses);
      const status = item.scenario === 'error' ? Number(statuses.find(s => /^[45]\d\d$/.test(s)) || 500) : Number(statuses.find(s => /^2\d\d$/.test(s)) || 200);
      let data = responseExample(entry.operation.responses[String(status)]);
      if (item.scenario === 'error' && data === undefined) data = { error: 'Error simulado por docs2api.', simulated: true };
      if (status === 204 || req.method === 'HEAD') return res.status(status).end();
      if (item.name === 'INEGI' && data) { data = structuredClone(data); if (data.Series?.[0]) data.Series[0].INDICADOR = params.IdIndicador || data.Series[0].INDICADOR; }
      return res.status(status).json(data ?? null);
    }
    return res.status(404).json({ error: 'Método o ruta no documentados en este sandbox.', simulated: true });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta administrativa no encontrada.' }));
  const webDir = join(dirname(fileURLToPath(import.meta.url)), '../web');
  if (existsSync(join(webDir, 'index.html'))) { app.use(express.static(webDir)); app.get('/{*path}', (_req, res) => res.sendFile(join(webDir, 'index.html'))); }
  app.use((error: any, _req: Request, res: express.Response, _next: express.NextFunction) => res.status(error.status || (error instanceof z.ZodError ? 400 : 400)).json({ error: safeError(error) }));
  return { app, store };
}
function safeError(error: any) {
  if (error instanceof z.ZodError) return 'Datos inválidos: ' + error.issues.map(i => i.path.join('.') + ' ' + i.message).join('; ');
  if (error?.status === 401) return 'El proveedor rechazó la clave. Revisa el proveedor y la clave en Ajustes.';
  if (error?.status === 402 || error?.status === 429) return 'El proveedor alcanzó un límite de saldo, cuota o consumo. Revisa tu cuenta.';
  return String(error?.message || 'No se pudo completar la operación.').replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTADO]').slice(0, 400);
}
