import { mkdirSync, chmodSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import pg from 'pg';
import type { Integration, Job } from '../shared/types.js';
import { providers, type Provider } from '../shared/providers.js';

/** Cross-request coordination (jobs, quotas, generation lock). Postgres-backed in hosted deployments, where requests land on different instances. */
export interface Coordination {
  saveJob(owner: string, job: Job): Promise<void>; getJob(id: string, owner: string): Promise<Job | undefined>; listJobs(owner: string): Promise<Job[]>;
  /** Current usage of a quota counter. */
  quota(key: string): Promise<number>;
  /** Atomically takes one unit if the counter is below `limit`; the counter resets `ttlMs` after its first use. */
  consume(key: string, limit: number, ttlMs: number): Promise<boolean>;
  /** Takes an exclusive lock that expires on its own after `ttlMs`, so a dead instance cannot hold it forever. */
  lock(name: string, ttlMs: number): Promise<boolean>; unlock(name: string): Promise<void>;
}
export interface Store extends Coordination { list(owner: string): Promise<Integration[]>; get(id: string): Promise<Integration | undefined>; byPrefix(prefix: string): Promise<Integration | undefined>; save(item: Integration): Promise<void>; remove(id: string): Promise<void>; close(): Promise<void> }
function memoryCoordination(): Coordination {
  const jobs = new Map<string, { owner: string; job: Job }>(); const quotas = new Map<string, { count: number; expires: number }>(); const locks = new Map<string, number>();
  const live = (key: string) => { const entry = quotas.get(key); return entry && entry.expires > Date.now() ? entry : undefined; };
  return {
    async saveJob(owner, job) { jobs.set(job.id, { owner, job }); if (jobs.size > 200) jobs.delete(jobs.keys().next().value!); },
    async getJob(id, owner) { const entry = jobs.get(id); return entry?.owner === owner ? entry.job : undefined; },
    async listJobs(owner) { return [...jobs.values()].filter(entry => entry.owner === owner).map(entry => entry.job).reverse().slice(0, 20); },
    async quota(key) { return live(key)?.count || 0; },
    async consume(key, limit, ttlMs) { const entry = live(key); if (entry && entry.count >= limit) return false; quotas.set(key, { count: (entry?.count || 0) + 1, expires: entry?.expires ?? Date.now() + ttlMs }); return true; },
    async lock(name, ttlMs) { if ((locks.get(name) || 0) > Date.now()) return false; locks.set(name, Date.now() + ttlMs); return true; },
    async unlock(name) { locks.delete(name); }
  };
}
export function dataDirectory() { return process.env.DOCS2API_DATA_DIR || join(homedir(), '.docs2api'); }
export interface StoreOptions { /** Called with the PostgreSQL pool once created, e.g. to register it with a serverless platform's connection manager. */ onPool?: (pool: pg.Pool) => void }
export async function createStore(directory = dataDirectory(), databaseUrl = process.env.DATABASE_URL, options: StoreOptions = {}): Promise<Store> {
  if (databaseUrl) {
    // Serverless instances are short-lived and numerous; keep few connections per instance and let idle ones go (use Neon's pooled endpoint).
    const pool = new pg.Pool({ connectionString: databaseUrl, max: Number(process.env.DATABASE_POOL_MAX || 5), idleTimeoutMillis: 5000 });
    options.onPool?.(pool);
    await pool.query(`CREATE TABLE IF NOT EXISTS integrations (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS jobs_owner_created ON jobs (owner, created_at DESC);
      CREATE TABLE IF NOT EXISTS quotas (key TEXT PRIMARY KEY, count INT NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS locks (name TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL)`);
    return {
      async list(owner) { return (await pool.query('SELECT data FROM integrations WHERE owner=$1 ORDER BY id', [owner])).rows.map(r => r.data); },
      async get(id) { return (await pool.query('SELECT data FROM integrations WHERE id=$1', [id])).rows[0]?.data; },
      async byPrefix(prefix) { return (await pool.query("SELECT data FROM integrations WHERE data->>'prefix'=$1", [prefix])).rows[0]?.data; },
      async save(item) { await pool.query('INSERT INTO integrations (id,owner,data) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET owner=$2,data=$3', [item.id, item.owner, JSON.stringify(item)]); },
      async remove(id) { await pool.query('DELETE FROM integrations WHERE id=$1', [id]); },
      async saveJob(owner, job) { await pool.query('INSERT INTO jobs (id,owner,data) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET data=$3', [job.id, owner, JSON.stringify(job)]); },
      async getJob(id, owner) { return (await pool.query('SELECT data FROM jobs WHERE id=$1 AND owner=$2', [id, owner])).rows[0]?.data; },
      async listJobs(owner) { return (await pool.query('SELECT data FROM jobs WHERE owner=$1 ORDER BY created_at DESC, id LIMIT 20', [owner])).rows.map(r => r.data); },
      async quota(key) { return (await pool.query('SELECT count FROM quotas WHERE key=$1 AND expires_at > now()', [key])).rows[0]?.count || 0; },
      async consume(key, limit, ttlMs) {
        // Insert, or bump the counter only while it is below the limit (or has expired and restarts at 1). No row back means the limit was hit.
        const result = await pool.query(`INSERT INTO quotas (key,count,expires_at) VALUES ($1,1, now() + ($3::int * interval '1 millisecond'))
          ON CONFLICT (key) DO UPDATE SET count = CASE WHEN quotas.expires_at <= now() THEN 1 ELSE quotas.count + 1 END, expires_at = CASE WHEN quotas.expires_at <= now() THEN excluded.expires_at ELSE quotas.expires_at END
          WHERE quotas.expires_at <= now() OR quotas.count < $2 RETURNING count`, [key, limit, ttlMs]);
        return result.rowCount === 1;
      },
      async lock(name, ttlMs) {
        // Piggyback housekeeping on the rare lock acquisition: sessions last 24h, so nothing older than two days is reachable.
        await pool.query("DELETE FROM jobs WHERE created_at < now() - interval '2 days'; DELETE FROM quotas WHERE expires_at < now()").catch(() => {});
        const result = await pool.query(`INSERT INTO locks (name,expires_at) VALUES ($1, now() + ($2::int * interval '1 millisecond'))
          ON CONFLICT (name) DO UPDATE SET expires_at = excluded.expires_at WHERE locks.expires_at <= now() RETURNING name`, [name, ttlMs]);
        return result.rowCount === 1;
      },
      async unlock(name) { await pool.query('DELETE FROM locks WHERE name=$1', [name]); },
      async close() { await pool.end(); }
    };
  }
  const { DatabaseSync } = await import('node:sqlite'); // Loaded lazily: hosted deployments use Postgres only.
  if (directory !== ':memory:') mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(directory === ':memory:' ? directory : join(directory, 'sandboxes.db'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS integrations (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL)');
  return {
    ...memoryCoordination(),
    async list(owner) { return db.prepare('SELECT data FROM integrations WHERE owner=? ORDER BY rowid DESC').all(owner).map((r: any) => JSON.parse(r.data)); },
    async get(id) { const row = db.prepare('SELECT data FROM integrations WHERE id=?').get(id) as any; return row ? JSON.parse(row.data) : undefined; },
    async byPrefix(prefix) { const row = db.prepare("SELECT data FROM integrations WHERE json_extract(data,'$.prefix')=?").get(prefix) as any; return row ? JSON.parse(row.data) : undefined; },
    async save(item) { db.prepare('INSERT INTO integrations (id,owner,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,data=excluded.data').run(item.id, item.owner, JSON.stringify(item)); },
    async remove(id) { db.prepare('DELETE FROM integrations WHERE id=?').run(id); },
    async close() { db.close(); }
  };
}
export interface Settings { apiKey?: string; model: string; provider?: Provider; firecrawlApiKey?: string }
export class SettingsStore {
  constructor(private directory = dataDirectory()) {}
  private saved(): any {
    const path = join(this.directory, 'settings.json');
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  }
  read(selected?: Provider): Settings & { provider: Provider } {
    const saved = this.saved();
    const requested = selected || (process.env.DOCS2API_MODE === 'hosted' ? (process.env.DOCS2API_PROVIDER as Provider) : undefined) || saved.provider || (process.env.DOCS2API_PROVIDER as Provider) || 'deepseek';
    const provider: Provider = requested in providers ? requested : 'deepseek';
    const entry = providers[provider]; if (!entry) throw new Error('Proveedor no soportado.');
    const value = saved.providers?.[provider] || {};
    return { provider, firecrawlApiKey: process.env.FIRECRAWL_API_KEY || saved.firecrawlApiKey, apiKey: process.env[entry.keyEnv] || value.apiKey, model: process.env[entry.modelEnv] || value.model || entry.model };
  }
  publicStatus(hosted: boolean) {
    const current = this.read();
    return { hasFirecrawlKey: Boolean(current.firecrawlApiKey), firecrawlKeyManaged: hosted || Boolean(process.env.FIRECRAWL_API_KEY), provider: current.provider, model: current.model, hasKey: Boolean(current.apiKey), hosted, keyManaged: hosted || Boolean(process.env[providers[current.provider].keyEnv]), providers: Object.fromEntries((Object.keys(providers) as Provider[]).map(id => { const value = this.read(id); return [id, { name: providers[id].name, model: value.model, hasKey: Boolean(value.apiKey), keyManaged: hosted || Boolean(process.env[providers[id].keyEnv]) }]; })) };
  }
  save(value: Settings) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, 'settings.json');
    const saved = this.saved(); const provider = value.provider || 'deepseek';
    const existing = saved.providers || (saved.apiKey || saved.model ? { openai: { apiKey: saved.apiKey, model: saved.model } } : {});
    const updated = { provider, firecrawlApiKey: value.firecrawlApiKey === undefined ? saved.firecrawlApiKey : value.firecrawlApiKey, providers: { ...existing, [provider]: { model: value.model, apiKey: value.apiKey } } };
    writeFileSync(path, JSON.stringify(updated), { mode: 0o600 });
    chmodSync(path, 0o600);
  }
}
