export type Schema = Record<string, any>;
export interface Parameter { name: string; in: 'path' | 'query' | 'header' | 'cookie'; required?: boolean; schema?: Schema; example?: any; description?: string; 'x-secret'?: boolean }
export interface Operation { operationId?: string; summary?: string; description?: string; parameters?: Parameter[]; requestBody?: any; responses: Record<string, any>; security?: any[]; 'x-evidence'?: { sourceUrl: string; quote: string }; 'x-needs-review'?: boolean }
export interface Contract { openapi: string; info: { title: string; version: string; description?: string }; servers: { url: string }[]; paths: Record<string, Record<string, any>>; components?: any; security?: any[]; 'x-warnings'?: string[] }
export type Scenario = 'success' | 'error' | 'latency';
export interface Integration { id: string; owner: string; name: string; prefix: string; sourceUrl: string; contract: Contract; version: string; active: boolean; scenario: Scenario; latencyMs: number; createdAt: string }
export interface IndexedPage { url: string; title: string; state: 'reading' | 'analyzing' | 'ready' | 'skipped'; message?: string; operations?: number; integrationId?: string }
export interface Job { id: string; state: 'queued' | 'fetching' | 'extracting' | 'validating' | 'ready' | 'failed'; message: string; integrationId?: string; integrationIds?: string[]; sourceUrl?: string; pages?: IndexedPage[]; error?: string }
export const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;
