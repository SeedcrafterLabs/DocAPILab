import { checkPublicUrl, documentationLinks, type fetchDocumentation } from './extract.js';

export async function fetchFirecrawlDocumentation(raw: string, apiKey?: string): ReturnType<typeof fetchDocumentation> {
  if (!apiKey) throw new Error('Configura tu API key de Firecrawl en Ajustes para leer documentación por URL.');
  const url = await checkPublicUrl(raw);
  const response = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST', signal: AbortSignal.timeout(65_000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ url: url.href, formats: ['markdown', 'links'], onlyMainContent: true, timeout: 60000 })
  });
  if (!response.ok) throw new Error('Firecrawl devolvió HTTP ' + response.status + '. Revisa tu clave, saldo y límites.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Firecrawl devolvió una respuesta vacía.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 5_000_000) { await reader.cancel(); throw new Error('La respuesta de Firecrawl es demasiado grande. Usa una sección más específica.'); }
    chunks.push(value);
  }
  let body: any;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Firecrawl no devolvió JSON válido.'); }
  if (!body.success || typeof body.data?.markdown !== 'string') throw new Error('Firecrawl no pudo leer esta documentación.');
  const text = body.data.markdown.trim();
  if (text.length < 50) throw new Error('Firecrawl no encontró documentación suficiente. Prueba una sección de referencia de API.');
  if (text.length > 200_000) throw new Error('La documentación es demasiado extensa. Usa una sección más específica.');
  const sourceUrl = (await checkPublicUrl(body.data.metadata?.sourceURL || url.href)).href;
  const links = (Array.isArray(body.data.links) ? body.data.links : []).filter((link: unknown) => typeof link === 'string').map((link: string) => `[Referencia](${link})`).join('\n');
  return { text, sourceUrl, links: documentationLinks(text + '\n' + links, sourceUrl) };
}
