import { createTwoFilesPatch } from 'diff';
import { operations, localPath, isSecret, routePattern } from './contracts.js';
import type { Integration } from '../shared/types.js';
export function proposeMigration(item: Integration, filename: string, code: string) {
  if (!/\.(?:[cm]?[jt]sx?)$/i.test(filename) || /[\r\n\0]/.test(filename)) throw new Error('Selecciona un archivo JavaScript o TypeScript.');
  if (code.length > 150_000) throw new Error('El archivo supera 150 KB.');
  const envName = item.name.toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/^([0-9])/, '_$1');
  const base = item.contract.servers[0].url.replace(/\/$/, '');
  let output = code; const instructions: string[] = []; const env: Record<string, string> = { [`${envName}_BASE_URL`]: base };
  // Recognize complete quoted URLs only. Leave dynamic constructs for explicit review.
  output = output.replace(/(['"`])(https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/[^'"`\s]*)\1/g, (full, quote, url) => {
    let parsed: URL; try { parsed = new URL(url); } catch { return full; }
    if (!parsed.pathname.startsWith('/' + item.prefix + '/')) return full;
    let route = parsed.pathname.slice(item.prefix.length + 1);
    let matched = false;
    for (const { path, operation } of operations(item.contract)) {
      const { names, regex } = routePattern(localPath(path, operation));
      const m = regex.exec(route); if (!m) continue;
      matched = true; let real = path;
      names.forEach((name, i) => { real = real.replace('{' + name + '}', m[i + 1]); });
      for (const p of operation.parameters || []) if (isSecret(p)) {
        const key = `${envName}_${p.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`; env[key] = '';
        if (p.in === 'path') real = real.replace('{' + p.name + '}', '${encodeURIComponent(process.env.' + key + '!)}');
        else instructions.push(`Añade ${p.name} (${p.in}) usando process.env.${key}; revisa la llamada antes de aplicar.`);
      }
      for (const security of operation.security || item.contract.security || []) for (const name of Object.keys(security)) {
        const scheme = item.contract.components?.securitySchemes?.[name]; const key = `${envName}_API_KEY`; env[key] = '';
        instructions.push(scheme?.type === 'http' ? `Añade el header Authorization: Bearer usando process.env.${key}.` : `Añade ${scheme?.name || name} en ${scheme?.in || 'header'} desde process.env.${key}.`);
      }
      route = real; break;
    }
    if (!matched) { instructions.push('Ruta no reconocida: revisa manualmente su sustitución.'); return full; }
    return '`' + '${process.env.' + envName + '_BASE_URL}' + route + parsed.search + '`';
  });
  // Avoid TypeScript assertions in JS files.
  if (!/\.tsx?$/.test(filename)) output = output.replace(/(process\.env\.[A-Z_0-9]+)!/g, '$1');
  const changed = output !== code;
  instructions.unshift('Ejecuta esta integración en el servidor. Nunca expongas credenciales en el navegador.', 'Configura las variables del archivo .env.example; los valores secretos quedan vacíos.', 'Revisa el diff y valida el contrato con la API real antes de desplegar.');
  if (!changed) instructions.push('No se encontraron URLs locales literales compatibles. Las variables, URLs relativas y construcciones dinámicas requieren edición manual.');
  return { changed, filename, patch: createTwoFilesPatch('a/' + filename.replaceAll('\\', '/').split('/').pop(), 'b/' + filename.replaceAll('\\', '/').split('/').pop(), code, output), code: output, envExample: Object.entries(env).map(([k, v]) => k + '=' + v).join('\n'), instructions: [...new Set(instructions)] };
}
