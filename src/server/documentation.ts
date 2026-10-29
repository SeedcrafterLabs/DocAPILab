import { fetchDocumentation, hasEndpointDocumentation } from './extract.js';
import { fetchFirecrawlDocumentation } from './firecrawl.js';

export async function readDocumentation(
  url: string, apiKey?: string, onFallback?: () => void,
  readers = { primary: fetchFirecrawlDocumentation, fallback: fetchDocumentation }
): ReturnType<typeof fetchDocumentation> {
  let primary: Awaited<ReturnType<typeof fetchDocumentation>> | undefined;
  try {
    primary = await readers.primary(url, apiKey);
    if (primary.direct || hasEndpointDocumentation(primary.text)) return primary;
  } catch { /* Try the bounded public-page reader before abandoning this page. */ }
  onFallback?.();
  try {
    const direct = await readers.fallback(url);
    const links = [...(direct.links || []), ...(primary?.links || [])];
    const merged = { ...direct, links: links.filter((link, index) => links.findIndex(other => other.url === link.url) === index).slice(0, 30) };
    if (direct.direct || hasEndpointDocumentation(direct.text) || !primary) return merged;
    // Preserve both representations for the model when neither has explicit HTTP definitions.
    return { ...merged, text: (primary.text + '\n\n' + direct.text).slice(0, 200_000) };
  } catch {
    if (primary) return primary;
    throw new Error('Firecrawl y la lectura directa no pudieron obtener esta página. Prueba otra sección pública o importa OpenAPI.');
  }
}
