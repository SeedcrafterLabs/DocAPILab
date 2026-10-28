# Validacion de DocApiLab

Fecha: 2026-10-28.

- npm test: 30 pruebas aprobadas. Una prueba opcional PostgreSQL omitida por no configurar TEST_DATABASE_URL.
- npm run build: tipos TypeScript, frontend Vite y CLI tsup correctos.
- npm pack --ignore-scripts: paquete @seedcrafterlabs/docapilab, solo LICENSE, README, package.json y dist. Sin claves ni bases locales.
- Pruebas de adaptadores con respuestas simuladas: OpenAI, DeepSeek, Google Gemini, Anthropic y Firecrawl; claves separadas y nunca devueltas por ajustes.
- Firecrawl: requiere clave, procesa Markdown y enlaces, limita tamano y evita propagar cuerpos de error del proveedor.
- La generacion real con Firecrawl y los nuevos proveedores requiere configurar claves personales; no se declara validada contra esas cuentas.
- Publicacion npm y ejecucion npx desde registro publico pendientes.
