import { it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SettingsStore } from '../src/server/store';
import { extractContract, assembleExtraction, compactDocumentation, documentationLinks, hasEndpointDocumentation } from '../src/server/extract';
const extracted = { title: 'Orders', baseUrl: 'https://api.example.com', warnings: [], operations: [{ method: 'get', path: '/orders', summary: 'List orders', evidenceQuote: 'GET /orders', needsReview: false, parameters: [], requestSchemaJson: '', requestExampleJson: '', responseStatus: 200, responseSchemaJson: '{"type":"object","properties":{"id":{"type":"integer"}}}', responseExampleJson: '{"id":42}', authKind: 'none', authName: '', authLocation: 'header' }] };
afterEach(() => vi.unstubAllGlobals());
it('discovers same-site references and distinguishes hubs from endpoint pages', () => {
  const links = documentationLinks('<a href="/docs/messaging">Messaging</a><a href="/docs/messaging/api/message-resource">Messages</a><a href="https://other.example/docs/api">Other</a><a href="/docs/pricing">Pricing</a>', 'https://www.twilio.com/docs');
  expect(links[0].url).toBe('https://www.twilio.com/docs/messaging/api/message-resource'); expect(links).toHaveLength(2);
  expect(hasEndpointDocumentation('Browse our Messaging APIs and Voice APIs.')).toBe(false);
  expect(hasEndpointDocumentation('POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json')).toBe(true);
});
it('keeps endpoint examples when compacting repeated documentation', () => {
  const text = 'Overview and parameters. '.repeat(1000) + '\nGET https://api.example.com/orders\nResponse: {"id":42}';
  const compact = compactDocumentation(text);
  expect(compact.length).toBeLessThan(21_000); expect(compact).toContain('https://api.example.com/orders'); expect(compact).toContain('Overview');
});
it('prioritizes HTTP definitions over navigation links in long references', () => {
  const text = 'Introduction. '.repeat(1000) + Array.from({ length: 20 }, (_, i) => `See https://docs.example.com/docs/api/topic${i} for information.\n`).join('') + 'x'.repeat(10000) + '\nPOST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json\nBody: To and From';
  expect(compactDocumentation(text)).toContain('POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json');
});
it('keeps grounded operations while reporting unsupported ones', () => {
  const result = structuredClone(extracted);
  result.operations.push({ ...result.operations[0], path: '/invented', summary: 'Invented', evidenceQuote: 'GET /invented' });
  const contract = assembleExtraction(result as any, 'GET\n/orders returns id', 'https://docs.example.com');
  expect(contract.paths['/orders'].get).toBeDefined(); expect(contract.paths['/invented']).toBeUndefined();
  expect(contract['x-warnings']?.[0]).toContain('omitida');
});
it('recovers a literal URL citation when the model paraphrases the quote', () => {
  const result = structuredClone(extracted); result.operations[0].evidenceQuote = 'paraphrased citation';
  const contract = assembleExtraction(result as any, 'Use GET https://api.example.com/orders to list orders.', 'https://docs.example.com');
  expect(contract.paths['/orders'].get['x-evidence'].quote).toBe('https://api.example.com/orders');
});
it('keeps provider credentials independent without reusing legacy OpenAI credentials', () => {
  const directory = mkdtempSync(join(tmpdir(), 'docs2api-provider-'));
  try {
    writeFileSync(join(directory, 'settings.json'), JSON.stringify({ apiKey: 'sk-old-openai', model: 'gpt-4o-mini' }));
    const store = new SettingsStore(directory);
    expect(store.read('google').apiKey).toBeUndefined();
    expect(store.read('deepseek').apiKey).toBeUndefined();
    store.save({ provider: 'deepseek', model: 'deepseek-flash', apiKey: 'sk-deepseek', firecrawlApiKey: 'fc-personal' });
    expect(store.read().provider).toBe('deepseek'); expect(store.read('google').apiKey).toBeUndefined();
    store.save({ provider: 'anthropic', model: 'claude-haiku-4-5', apiKey: 'sk-ant' });
    expect(store.read('deepseek').apiKey).toBe('sk-deepseek'); expect(store.read().firecrawlApiKey).toBe('fc-personal');
    const status = JSON.stringify(store.publicStatus(false));
    expect(status).not.toContain('sk-'); expect(status).not.toContain('fc-personal'); expect(store.publicStatus(false).hasFirecrawlKey).toBe(true); expect(Object.keys(store.publicStatus(false).providers)).toHaveLength(3);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
it('uses DeepSeek JSON mode and validates its output', async () => {
  const mocked = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(extracted) }, finish_reason: 'stop' }] }));
  vi.stubGlobal('fetch', mocked);
  const contract = await extractContract('GET /orders returns id', 'https://docs.example.com', 'sk-test-deepseek', 'deepseek-flash', 'deepseek');
  expect(contract.paths['/orders'].get).toBeDefined();
  const [url, init] = mocked.mock.calls[0]; expect(String(url)).toContain('https://api.deepseek.com/chat/completions');
  expect(JSON.parse(init.body).response_format).toEqual({ type: 'json_object' });
  expect(JSON.parse(init.body).thinking).toEqual({ type: 'disabled' });
});
it('accepts nullable pagination fields returned by documentation extraction', async () => {
  const result = structuredClone(extracted);
  result.operations[0].responseSchemaJson = '{"type":"object","properties":{"next_page_uri":{"type":["string","null"]}}}';
  result.operations[0].responseExampleJson = '{"next_page_uri":null}';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] })));
  const contract = await extractContract('GET /orders returns id', 'https://docs.example.com', 'sk-test', 'deepseek-flash', 'deepseek');
  expect(contract.openapi).toBe('3.1.0'); expect(contract.paths['/orders'].get).toBeDefined();
});
it('uses Anthropic forced tool output without executing a tool', async () => {
  const mocked = vi.fn().mockResolvedValue(Response.json({ content: [{ type: 'tool_use', name: 'extract_api_contract', input: extracted }] })); vi.stubGlobal('fetch', mocked);
  const contract = await extractContract('GET /orders returns id', 'https://docs.example.com', 'sk-test-anthropic', 'claude-haiku-4-5', 'anthropic');
  expect(contract.paths['/orders'].get).toBeDefined();
  const [url, init] = mocked.mock.calls[0]; expect(url).toBe('https://api.anthropic.com/v1/messages');
  expect(JSON.parse(init.body).tool_choice).toEqual({ type: 'tool', name: 'extract_api_contract' });
});
it('reports exhausted DeepSeek balance without exposing credentials', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { message: 'Insufficient balance', type: 'insufficient_balance' } }, { status: 402 })));
  await expect(extractContract('GET /orders returns id', 'https://docs.example.com', 'sk-private', 'deepseek-flash', 'deepseek')).rejects.toMatchObject({ status: 402 });
});

it('uses Gemini structured output with credentials only in headers', async () => {
 const mocked = vi.fn().mockResolvedValue(Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(extracted) }] } }] })); vi.stubGlobal('fetch', mocked);
 const contract = await extractContract('GET /orders returns id', 'https://docs.example.com', 'private-google', 'gemini-3.8-flash', 'google');
 expect(contract.paths['/orders'].get).toBeDefined();
 const [url, init] = mocked.mock.calls[0]; expect(url).not.toContain('private-google'); expect(init.headers['x-goog-api-key']).toBe('private-google');
 expect(JSON.parse(init.body).generationConfig.responseMimeType).toBe('application/json');
});
