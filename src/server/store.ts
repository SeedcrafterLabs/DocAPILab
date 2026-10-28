import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import pg from 'pg';
import type { Integration } from '../shared/types.js';
import { providers, type Provider } from '../shared/providers.js';

export interface Store { list(owner: string): Promise<Integration[]>; get(id: string): Promise<Integration | undefined>; byPrefix(prefix: string): Promise<Integration | undefined>; save(item: Integration): Promise<void>; remove(id: string): Promise<void>; close(): Promise<void> }
export function dataDirectory() { return process.env.DOCS2API_DATA_DIR || join(homedir(), '.docs2api'); }
export async function createStore(directory = dataDirectory(), databaseUrl = process.env.DATABASE_URL): Promise<Store> {
  if (databaseUrl) {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    await pool.query('CREATE TABLE IF NOT EXISTS integrations (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data JSONB NOT NULL)');
    return {
      async list(owner) { return (await pool.query('SELECT data FROM integrations WHERE owner=$1 ORDER BY id', [owner])).rows.map(r => r.data); },
      async get(id) { return (await pool.query('SELECT data FROM integrations WHERE id=$1', [id])).rows[0]?.data; },
      async byPrefix(prefix) { return (await pool.query("SELECT data FROM integrations WHERE data->>'prefix'=$1", [prefix])).rows[0]?.data; },
      async save(item) { await pool.query('INSERT INTO integrations (id,owner,data) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET owner=$2,data=$3', [item.id, item.owner, JSON.stringify(item)]); },
      async remove(id) { await pool.query('DELETE FROM integrations WHERE id=$1', [id]); },
      async close() { await pool.end(); }
    };
  }
  if (directory !== ':memory:') mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(directory === ':memory:' ? directory : join(directory, 'sandboxes.db'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS integrations (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL)');
  return {
    async list(owner) { return db.prepare('SELECT data FROM integrations WHERE owner=? ORDER BY rowid DESC').all(owner).map((r: any) => JSON.parse(r.data)); },
    async get(id) { const row = db.prepare('SELECT data FROM integrations WHERE id=?').get(id) as any; return row ? JSON.parse(row.data) : undefined; },
    async byPrefix(prefix) { const row = db.prepare("SELECT data FROM integrations WHERE json_extract(data,'$.prefix')=?").get(prefix) as any; return row ? JSON.parse(row.data) : undefined; },
    async save(item) { db.prepare('INSERT INTO integrations (id,owner,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,data=excluded.data').run(item.id, item.owner, JSON.stringify(item)); },
    async remove(id) { db.prepare('DELETE FROM integrations WHERE id=?').run(id); },
    async close() { db.close(); }
  };
}
export interface Settings { apiKey?: string; model: string; provider?: Provider }
export class SettingsStore {
  constructor(private directory = dataDirectory()) {}
  private saved(): any {
    const path = join(this.directory, 'settings.json');
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  }
  read(selected?: Provider): Settings & { provider: Provider } {
    const saved = this.saved();
    const provider: Provider = selected || (process.env.DOCS2API_MODE === 'hosted' ? (process.env.DOCS2API_PROVIDER as Provider) : undefined) || saved.provider || (process.env.DOCS2API_PROVIDER as Provider) || 'openai';
    const entry = providers[provider]; if (!entry) throw new Error('Proveedor no soportado.');
    const value = saved.providers?.[provider] || (provider === 'openai' ? { apiKey: saved.apiKey, model: saved.model } : {});
    return { provider, apiKey: process.env[entry.keyEnv] || value.apiKey, model: process.env[entry.modelEnv] || value.model || entry.model };
  }
  publicStatus(hosted: boolean) {
    const current = this.read();
    return { provider: current.provider, model: current.model, hasKey: Boolean(current.apiKey), hosted, keyManaged: hosted || Boolean(process.env[providers[current.provider].keyEnv]), providers: Object.fromEntries((Object.keys(providers) as Provider[]).map(id => { const value = this.read(id); return [id, { name: providers[id].name, model: value.model, hasKey: Boolean(value.apiKey), keyManaged: hosted || Boolean(process.env[providers[id].keyEnv]) }]; })) };
  }
  save(value: Settings) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, 'settings.json');
    const saved = this.saved(); const provider = value.provider || 'openai';
    const existing = saved.providers || (saved.apiKey || saved.model ? { openai: { apiKey: saved.apiKey, model: saved.model } } : {});
    const updated = { provider, providers: { ...existing, [provider]: { model: value.model, apiKey: value.apiKey } } };
    writeFileSync(path, JSON.stringify(updated), { mode: 0o600 });
    chmodSync(path, 0o600);
  }
}
