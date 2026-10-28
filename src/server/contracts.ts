import SwaggerParser from '@apidevtools/swagger-parser';
import { Ajv } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createHash } from 'node:crypto';
import { methods, type Contract, type Integration, type Operation, type Parameter, type Schema } from '../shared/types.js';
export const ajv = new Ajv({ strict: false, allErrors: true, coerceTypes: true, validateFormats: false });
addFormats(ajv);
const responseAjv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
const modernAjv = new Ajv2020({ strict: false, allErrors: true, coerceTypes: true, validateFormats: false });
const modernResponseAjv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
export function compileSchema(schema: Schema, modern = false, coerce = true) {
  const isModern = schema.$schema?.includes('2020-12') || (modern && !schema.$schema?.includes('draft-07'));
  return (isModern ? (coerce ? modernAjv : modernResponseAjv) : (coerce ? ajv : responseAjv)).compile(schema);
}
const secretPattern = /token|api[_-]?key|secret|authorization|access[_-]?key/i;
export function operations(contract: Contract) {
  return Object.entries(contract.paths).flatMap(([path, entry]) => methods.filter(m => entry[m]).map(method => ({ path, method, operation: { ...entry[method], parameters: [...(entry.parameters || []), ...(entry[method].parameters || [])] } as Operation })));
}
export function isSecret(parameter: Parameter) { return parameter['x-secret'] || secretPattern.test(parameter.name); }
export function localPath(path: string, operation: Operation) {
  let result = path;
  for (const p of operation.parameters || []) if (p.in === 'path' && isSecret(p)) result = result.split('/').filter(segment => segment !== '{' + p.name + '}').join('/');
  return result || '/';
}
export function routePattern(path: string) {
  const names: string[] = [];
  const pattern = path.split(/(\{[^{}]+\})/).map(part => {
    if (/^\{[^{}]+\}$/.test(part)) { names.push(part.slice(1, -1)); return '([^/]+)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { names, regex: new RegExp('^' + pattern + '/?$') };
}
export function sample(schema: Schema = {}, depth = 0, budget = { nodes: 250 }): any {
  if (--budget.nodes < 0) throw new Error('El schema requiere un ejemplo JSON explícito por su complejidad.');
  if (depth > 10) return null;
  if (schema.example !== undefined) return structuredClone(schema.example);
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (schema.enum) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  if (schema.oneOf || schema.anyOf) return sample((schema.oneOf || schema.anyOf)[0], depth + 1, budget);
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s: Schema) => sample(s, depth + 1, budget)));
  switch (Array.isArray(schema.type) ? schema.type.find((x: string) => x !== 'null') : schema.type) {
    case 'object': return Object.fromEntries(Object.entries(schema.properties || {}).map(([k, v]) => [k, sample(v as Schema, depth + 1, budget)]));
    case 'array': return Array.from({ length: Math.min(schema.minItems ?? 1, 10) }, () => sample(schema.items, depth + 1, budget));
    case 'integer': case 'number': return schema.minimum ?? 1;
    case 'boolean': return true;
    case 'null': return null;
    default: return schema.format === 'date-time' ? '2026-01-01T12:00:00Z' : schema.format === 'date' ? '2026-01-01' : schema.format === 'email' ? 'persona@example.test' : 'ejemplo';
  }
}
export function responseExample(response: any) {
  const media = response?.content?.['application/json'] || Object.entries(response?.content || {}).find(([key]) => key.endsWith('+json'))?.[1] as any;
  if (!media) return undefined;
  return media.example ?? (Object.values(media.examples || {})[0] as any)?.value ?? sample(media.schema);
}
export function exampleRequest(prefix: string, path: string, operation: Operation) {
  let url = '/' + prefix + localPath(path, operation);
  const query = new URLSearchParams();
  for (const p of operation.parameters || []) {
    if (isSecret(p)) { if (p.in === 'path') url = url.replace('{' + p.name + '}', 'sandbox'); continue; }
    const value = p.example ?? sample(p.schema);
    if (p.in === 'path') url = url.replace('{' + p.name + '}', encodeURIComponent(String(value)));
    if (p.in === 'query' && (p.required || p.example !== undefined)) query.set(p.name, String(value));
  }
  return url + (query.size ? '?' + query : '');
}
export async function validateContract(input: any): Promise<Contract> {
  if (!input || typeof input !== 'object' || !/^3\./.test(input.openapi || '')) throw new Error('Se requiere OpenAPI 3.0 o 3.1.');
  if (!input.servers?.[0]?.url?.startsWith('https://')) throw new Error('El contrato necesita una URL HTTPS real del proveedor.');
  const serialized = JSON.stringify(input);
  if (serialized.length > 500_000) throw new Error('El contrato excede el límite de 500 KB.');
  // Never let schema references fetch external resources or local files.
  for (const m of serialized.matchAll(/"\$ref"\s*:\s*"([^"]+)"/g)) if (!m[1].startsWith('#/')) throw new Error('Solo se admiten referencias internas en OpenAPI.');
  const contract = await SwaggerParser.dereference(structuredClone(input), { resolve: { external: false }, dereference: { circular: false } }) as unknown as Contract;
  await SwaggerParser.validate(structuredClone(contract) as any, { resolve: { external: false } });
  const ops = operations(contract);
  if (!ops.length) throw new Error('No encontramos endpoints REST verificables en esta página. Puede ser un índice de productos o requerir una referencia de API más específica.');
  if (ops.length > 80) throw new Error('El contrato supera las 80 operaciones admitidas. Importa una sección más pequeña.');
  for (const { path, operation } of ops) {
    if (!path.startsWith('/') || path.includes('..') || /[?#]/.test(path)) throw new Error('Ruta inválida en el contrato.');
    for (const p of operation.parameters || []) if (secretPattern.test(p.name)) p['x-secret'] = true;
    for (const response of Object.values(operation.responses)) {
      const media = response?.content?.['application/json'];
      if (media?.schema) { const validate = compileSchema(media.schema, contract.openapi.startsWith('3.1'), false); const value = responseExample(response); if (!validate(value)) throw new Error('El ejemplo JSON no coincide con su schema: ' + path); }
    }
  }
  // Apply secret detection to both path-item and operation parameters.
  for (const entry of Object.values(contract.paths)) for (const group of [entry, ...methods.map(m => entry[m]).filter(Boolean)]) for (const p of group.parameters || []) if (secretPattern.test(p.name)) p['x-secret'] = true;
  return contract;
}
export function version(contract: Contract) { return createHash('sha256').update(JSON.stringify(contract)).digest('hex').slice(0, 12); }
export function publicIntegration(item: Integration) { const { owner, ...safe } = item; return { ...safe, operations: operations(item.contract).map(o => ({ ...o, localPath: localPath(o.path, o.operation), exampleUrl: exampleRequest(item.prefix, o.path, o.operation) })) }; }
