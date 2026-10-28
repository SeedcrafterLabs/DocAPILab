import { methods, type Contract } from '../shared/types.js';
import { frankfurter, jsonPlaceholder, pokeApi } from './builtin-specs.js';
export const inegiDocs = `API de indicadores INEGI. Método GET. Ejemplo documentado: https://www.inegi.org.mx/app/api/indicadores/desarrolladores/jsonxml/INDICATOR/1002000001/es/00/true/BISE/2.0/[Aquí va tu Token]?type=json. Idioma: es o en. Área: 00 nacional; depende del indicador. Recientes: true para último dato, false para serie histórica. Fuente BISE. Versión 2.0. Token obligatorio en API real. Respuesta JSON: Header y Series con OBSERVATIONS. Fuente: https://www.inegi.org.mx/servicios/api_indicadores.html`;
export const inegi: Contract = {
  openapi: '3.0.3', info: { title: 'INEGI', version: '1.0.0', description: 'Indicadores de México. Datos simulados para desarrollo; no son estadísticas oficiales.' },
  servers: [{ url: 'https://www.inegi.org.mx' }],
  'x-warnings': ['Se incluye el método Indicadores en formato JSON. Catálogos y otros formatos no están implementados.', 'La documentación usa distintas longitudes para el área geográfica. Validar el área de cada indicador con el proveedor.', 'El token se omite en la ruta local; la migración lo agrega como variable de entorno.'],
  paths: { '/app/api/indicadores/desarrolladores/jsonxml/INDICATOR/{IdIndicador}/{Idioma}/{Area}/{Recientes}/{Fuente}/{Version}/{Token}': { get: {
    operationId: 'consultarIndicador', summary: 'Consultar un indicador',
    'x-evidence': { sourceUrl: 'https://www.inegi.org.mx/servicios/api_indicadores.html', quote: 'https://www.inegi.org.mx/app/api/indicadores/desarrolladores/jsonxml/INDICATOR/1002000001/es/00/true/BISE/2.0/' },
    parameters: [
      { name: 'IdIndicador', in: 'path', required: true, schema: { type: 'string' }, example: '1002000001' },
      { name: 'Idioma', in: 'path', required: true, schema: { type: 'string', enum: ['es', 'en'] }, example: 'es' },
      { name: 'Area', in: 'path', required: true, schema: { type: 'string' }, example: '00' },
      { name: 'Recientes', in: 'path', required: true, schema: { type: 'boolean' }, example: true },
      { name: 'Fuente', in: 'path', required: true, schema: { type: 'string' }, example: 'BISE' },
      { name: 'Version', in: 'path', required: true, schema: { type: 'string', enum: ['2.0'] }, example: '2.0' },
      { name: 'Token', in: 'path', required: true, schema: { type: 'string' }, 'x-secret': true },
      { name: 'type', in: 'query', schema: { type: 'string', enum: ['json'] }, example: 'json' }
    ],
    responses: { '200': { description: 'Indicador simulado', content: { 'application/json': {
      schema: { type: 'object', required: ['Header', 'Series'], properties: { Header: { type: 'object', properties: { Name: { type: 'string' }, Email: { type: 'string' } } }, Series: { type: 'array', items: { type: 'object', properties: { INDICADOR: { type: 'string' }, OBSERVATIONS: { type: 'array', items: { type: 'object', properties: { TIME_PERIOD: { type: 'string' }, OBS_VALUE: { type: 'string' } } } } } } } } },
      example: { Header: { Name: 'Datos simulados BISE', Email: 'sandbox@example.test' }, Series: [{ INDICADOR: '1002000001', FREQ: '7', TOPIC: '123', UNIT: '151', UNIT_MULT: '', NOTE: '1398', SOURCE: '2,3', LASTUPDATE: '24/09/2026', STATUS: null, OBSERVATIONS: [{ TIME_PERIOD: '2025', OBS_VALUE: '130911314.00000000000000000000', OBS_EXCEPTION: null, OBS_STATUS: '3', OBS_SOURCE: '', OBS_NOTE: '11670', COBER_GEO: '0' }] }] }
    } } } }
  } } }
};
export interface CatalogEntry { id: string; name: string; category: string; description: string; sourceUrl: string; operations: number; tags: string[]; contract: Contract }
const operationCount = (contract: Contract) => Object.values(contract.paths).reduce((n, entry) => n + methods.filter(m => entry[m]).length, 0);
const entry = (id: string, category: string, description: string, sourceUrl: string, tags: string[], contract: Contract): CatalogEntry => ({ id, name: contract.info.title, category, description, sourceUrl, tags, operations: operationCount(contract), contract });
// Built-in specs available on first start. Add new entries here.
export const catalog: CatalogEntry[] = [
  entry('inegi', 'Datos públicos', 'Indicadores, población y estadísticas de México. Empieza sin tokens ni registros.', 'https://www.inegi.org.mx/servicios/api_indicadores.html', ['REST', 'JSON', 'Sin API key'], inegi),
  entry('frankfurter', 'Finanzas', 'Tipos de cambio y monedas del Banco Central Europeo.', 'https://frankfurter.dev', ['REST', 'JSON', 'Sin API key'], frankfurter),
  entry('jsonplaceholder', 'Prototipos', 'API REST falsa con publicaciones: ideal para probar GET y POST.', 'https://jsonplaceholder.typicode.com', ['REST', 'JSON', 'GET/POST'], jsonPlaceholder),
  entry('pokeapi', 'Entretenimiento', 'Catálogo de Pokémon con paginación y detalle por nombre.', 'https://pokeapi.co/docs/v2', ['REST', 'JSON', 'Sin API key'], pokeApi)
];
