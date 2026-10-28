import type { Contract } from '../shared/types.js';
const json = (schema: object, example: unknown) => ({ content: { 'application/json': { schema, example } } });
const post = { type: 'object', required: ['id', 'title', 'body', 'userId'], properties: { id: { type: 'integer' }, title: { type: 'string' }, body: { type: 'string' }, userId: { type: 'integer' } } };
const postExample = { id: 1, userId: 1, title: 'Publicación de ejemplo', body: 'Contenido simulado para desarrollo.' };
export const jsonPlaceholder: Contract = {
  openapi: '3.0.3', info: { title: 'JSONPlaceholder', version: '1.0.0', description: 'API REST falsa para pruebas y prototipos. Datos simulados.' },
  servers: [{ url: 'https://jsonplaceholder.typicode.com' }],
  paths: {
    '/posts': {
      get: { operationId: 'listPosts', summary: 'Listar publicaciones', parameters: [{ name: 'userId', in: 'query', schema: { type: 'integer' }, example: 1 }], responses: { '200': { description: 'Publicaciones', ...json({ type: 'array', items: post }, [postExample]) } } },
      post: { operationId: 'createPost', summary: 'Crear una publicación', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title', 'body', 'userId'], properties: { title: { type: 'string' }, body: { type: 'string' }, userId: { type: 'integer' } } } } } }, responses: { '201': { description: 'Publicación creada', ...json(post, { ...postExample, id: 101 }) } } }
    },
    '/posts/{id}': { get: { operationId: 'getPost', summary: 'Obtener una publicación', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 }, example: 1 }], responses: { '200': { description: 'Publicación', ...json(post, postExample) }, '404': { description: 'No encontrada', ...json({ type: 'object' }, {}) } } } }
  }
};
export const frankfurter: Contract = {
  openapi: '3.0.3', info: { title: 'Frankfurter', version: '1.0.0', description: 'Tipos de cambio publicados por el Banco Central Europeo. Datos simulados; no son tasas oficiales.' },
  servers: [{ url: 'https://api.frankfurter.dev' }],
  paths: {
    '/v1/latest': { get: { operationId: 'latestRates', summary: 'Tipos de cambio más recientes', parameters: [
      { name: 'base', in: 'query', schema: { type: 'string', pattern: '^[A-Z]{3}$' }, example: 'EUR' },
      { name: 'symbols', in: 'query', schema: { type: 'string' }, example: 'USD,MXN' }
    ], responses: { '200': { description: 'Tasas de cambio', ...json({ type: 'object', required: ['base', 'date', 'rates'], properties: { base: { type: 'string' }, date: { type: 'string' }, rates: { type: 'object', additionalProperties: { type: 'number' } } } }, { base: 'EUR', date: '2026-01-02', rates: { USD: 1.08, MXN: 19.5 } }) } } } },
    '/v1/currencies': { get: { operationId: 'listCurrencies', summary: 'Monedas disponibles', responses: { '200': { description: 'Monedas por código', ...json({ type: 'object', additionalProperties: { type: 'string' } }, { EUR: 'Euro', USD: 'United States Dollar', MXN: 'Mexican Peso' }) } } } }
  }
};
export const pokeApi: Contract = {
  openapi: '3.0.3', info: { title: 'PokéAPI', version: '2.0.0', description: 'Datos de Pokémon. Respuesta simplificada y simulada.' },
  servers: [{ url: 'https://pokeapi.co' }],
  paths: {
    '/api/v2/pokemon/{name}': { get: { operationId: 'getPokemon', summary: 'Obtener un Pokémon', parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' }, example: 'pikachu' }], responses: { '200': { description: 'Pokémon', ...json({ type: 'object', required: ['id', 'name'], properties: { id: { type: 'integer' }, name: { type: 'string' }, height: { type: 'integer' }, weight: { type: 'integer' }, types: { type: 'array', items: { type: 'object', properties: { slot: { type: 'integer' }, type: { type: 'object', properties: { name: { type: 'string' } } } } } } } }, { id: 25, name: 'pikachu', height: 4, weight: 60, types: [{ slot: 1, type: { name: 'electric' } }] }) }, '404': { description: 'No encontrado', ...json({ type: 'object' }, {}) } } } },
    '/api/v2/pokemon': { get: { operationId: 'listPokemon', summary: 'Listar Pokémon', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 }, example: 20 }, { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 }, example: 0 }], responses: { '200': { description: 'Página de resultados', ...json({ type: 'object', required: ['count', 'results'], properties: { count: { type: 'integer' }, next: { type: 'string', nullable: true }, results: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string' } } } } } }, { count: 1302, next: null, results: [{ name: 'bulbasaur', url: 'https://pokeapi.co/api/v2/pokemon/1/' }] }) } } } }
  }
};
