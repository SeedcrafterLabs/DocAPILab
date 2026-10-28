# docs2api

**De documentación a localhost.** Crea un sandbox de una API antes de conseguir credenciales del proveedor. Agrega documentación pública o un contrato OpenAPI, desarrolla tu integración y revisa un parche para migrar al proveedor real. La pantalla de inicio también da acceso al catálogo de APIs, que incluye specs integradas (INEGI, Frankfurter, JSONPlaceholder y PokéAPI) listas para crear un sandbox con un clic.

## Probar hoy

Requiere **Node.js 24+**. Windows, Linux y macOS; no requiere Python, Docker ni instalar una base de datos para uso local.

```sh
npm install
npm run build
npm start
```

Abre `http://localhost:4000` automáticamente. Si el puerto está ocupado, imprime el siguiente disponible. Elige **Agrega tu documentación** para pegar una URL o importar OpenAPI, o **Revisa nuestro catálogo de APIs** para explorar el catálogo. Las entradas se definen en `src/server/catalog.ts` (specs OpenAPI en `src/server/builtin-specs.ts`); son contratos simulados, no llaman al proveedor. Importar OpenAPI no requiere clave de IA.

```sh
curl "http://localhost:4000/INEGI/app/api/indicadores/desarrolladores/jsonxml/INDICATOR/1002000001/es/00/true/BISE/2.0?type=json"
```

El token no forma parte de la ruta simulada. La respuesta incluye `X-Docs2api-Simulated: true`. Datos de ejemplo, no estadísticas oficiales.

## Distribución con npx

El nombre de paquete provisional es `docs2api-lab`, el comando es `docs2api`. La consulta al registro de npm devolvió 404 durante la implementación; confirma disponibilidad al publicar.

```sh
npm pack
# Usa el archivo .tgz generado sin publicarlo:
npm exec --package=./docs2api-lab-0.1.0.tgz -- docs2api
# Una vez publicado por el mantenedor:
npx docs2api-lab
```

`docs2api --no-open` evita abrir el navegador. Los archivos servidos están incluidos en el paquete.

## Crear desde documentación

En **Ajustes**, configura una API key personal del proveedor y un modelo compatible con Responses y Structured Outputs (por defecto `gpt-4o-mini`). Una suscripción de ChatGPT no incluye saldo de API. La clave se guarda en `~/.docs2api/settings.json`, fuera del repositorio. En Windows, utiliza los permisos de tu perfil de usuario; no se cifra con un almacén del sistema en este MVP. También admite `OPENAI_API_KEY` y `OPENAI_MODEL` como variables de entorno.

**Agregar API** acepta una URL pública HTTPS de documentación HTML/texto o un contrato OpenAPI 3.0/3.1 en JSON/YAML. Las importaciones OpenAPI no consumen IA. Las páginas HTML requieren clave; la extracción está limitada a una página, 60.000 caracteres, 3 operaciones principales generadas y una llamada al modelo. Cada operación generada debe citar un fragmento exacto del texto. No ejecuta código generado por el modelo ni visita referencias externas de schemas. No renderiza JavaScript ni accede a páginas detrás de login.

El motor interpreta contratos, valida parámetros y cuerpos JSON y usa ejemplos compatibles. Los sandboxes generados responden sin llamar a ningún proveedor de IA. Soporta REST JSON; XML, JSONP, webhooks y lógica de negocio del proveedor no están incluidos. POST/PUT/PATCH/DELETE son simulaciones sin persistencia de recursos entre peticiones. Escenarios: éxito, error (respuesta documentada o error genérico 500) y latencia hasta 5 segundos.

## Migrar al proveedor real

Selecciona el sandbox en **Migrar a real** y abre un archivo JS/TS. La herramienta analiza localmente las URLs absolutas literales `localhost` o `127.0.0.1` del sandbox y propone un diff con URL base y tokens de ruta desde variables de entorno. Descarga el parche, `.env.example` e instrucciones. No modifica archivos ni realiza llamadas al proveedor. Los headers/query de autenticación, URLs dinámicas y código de frontend requieren revisión manual; las credenciales reales se usan en el servidor. La migración no promete compatibilidad con comportamientos no documentados.

## Persistencia y desarrollo

SQLite integrado en Node 24 guarda contratos, escenarios y estado en `~/.docs2api/sandboxes.db`. Configura `DOCS2API_DATA_DIR` para cambiarlo. Con `DATABASE_URL` utiliza PostgreSQL y crea su tabla automáticamente; no requiere migraciones previas. Los contratos se guardan como instantáneas con hash de versión.

```sh
npm run dev:server
# En otra terminal:
npm run dev
npm test
npm run build
```

La interfaz de desarrollo usa Vite en el puerto 5173. Para probar prefijos de APIs distintas de INEGI, usa el servidor compilado con `npm start` (misma URL para interfaz y sandbox).

## Demo alojada con PostgreSQL

Elige un VPS o servicio de contenedores con Node 24/Docker. Un hosting estático no ejecuta este servidor. No es necesario alojar un modelo ni usar GPU.

1. Copia `.env.example` como `.env`; configura el proveedor y su API key correspondiente, una `SESSION_SECRET` aleatoria larga y `POSTGRES_PASSWORD` (al menos 24 caracteres alfanuméricos para la URL de conexión).
2. Ejecuta `docker compose up -d --build`.
3. Configura un reverse proxy HTTPS hacia `127.0.0.1:4000`. Los puertos de PostgreSQL no se publican. Las cookies de sesión requieren HTTPS; para comprobar HTTP en tu propia máquina, configura `COOKIE_SECURE=false` en el servicio app.
4. Comprueba `/api/health` y ejecuta el recorrido INEGI antes de agregar la clave del servidor.

En modo `DOCS2API_MODE=hosted`, las sesiones están firmadas, los prefijos tienen IDs impredecibles y cada visitante solo administra sus integraciones. Los endpoints simulados son consumibles sin cookies por quien conozca la URL; no cargues información privada en la demo. No existe registro/login en el MVP. Las sesiones expiran a las 24 horas.

Límites predeterminados: una generación simultánea, 3 generaciones por red/sesión y 30 totales por proceso, con un máximo de 8.000 tokens de salida por llamada. Cada intento reserva cupo aunque falle; los contadores se reinician al reiniciar el proceso. Detrás de un proxy, el límite por red puede compartirse entre visitantes. El número de llamadas y los tamaños acotan consumo, pero **no son un límite monetario**: establece también el límite del proyecto en OpenAI y apaga la demo al terminar. Configurables mediante `AI_MAX_CALLS_PER_SESSION`, `AI_MAX_CALLS_TOTAL` y `AI_MAX_OUTPUT_TOKENS`.

La clave del servidor nunca se sirve al navegador. `/api/settings` solo devuelve si está configurada. La demo no permite modificarla. No se registran cuerpos de peticiones ni credenciales. La descarga de documentación bloquea hosts privados y redirecciones privadas, y fija la dirección pública validada al abrir la conexión. Para producción añade límites de tráfico en el proxy HTTPS. Este MVP no incluye cuentas, billing, aislamiento por contenedores ni monitorización externa.

## API administrativa

| Método | Ruta | Función |
| --- | --- | --- |
| GET | `/api/catalog` | Catálogo disponible |
| GET/PUT | `/api/settings` | Estado / ajustes locales |
| GET | `/api/integrations` | Sandboxes de la sesión |
| POST | `/api/integrations/catalog` | Crear con `{ "id": "inegi" }` |
| POST | `/api/integrations/import` | Importar `{ "contract": {...} }` |
| POST | `/api/jobs` | Generar con `{ "url": "https://..." }` |
| GET | `/api/jobs` | Indexaciones y progreso por pagina de la sesion |
| GET | `/api/jobs/:id` | Progreso / error recuperable |
| PATCH/DELETE | `/api/integrations/:id` | Estado, escenario, latencia / eliminar |
| GET | `/api/integrations/:id/contract` | Descargar OpenAPI |
| POST | `/api/integrations/:id/migration` | Proponer diff con `{ "filename": "client.ts", "code": "..." }` |

## Demo de 3 minutos

1. Abre el catálogo, crea INEGI y pulsa **Enviar**. Muestra `Header`, `Series` y `OBSERVATIONS`.
2. Copia el ejemplo a una app o usa curl; muestra que funciona sin tokens.
3. Cambia a error, prueba; pausa y reinicia el sandbox.
4. Importa un OpenAPI o genera desde documentación con una clave válida.
5. Abre el archivo de integración en Migrar a real y descarga el parche con el token como variable de entorno.

## Contribuir

Consulta [CONTRIBUTING.md](CONTRIBUTING.md). Código MIT. Los nombres y documentación de proveedores pertenecen a sus respectivos autores; este proyecto no está afiliado a INEGI ni garantiza sus estadísticas. Se incluye un resumen escrito para el catálogo, no una copia completa del sitio.

Las indexaciones contin?an mientras el proceso Node permanece abierto. Recargar el navegador no las detiene; detener o reiniciar Node cancela el trabajo pendiente. Los sandboxes ya creados permanecen guardados. Los indices sin endpoints se recorren sin llamar al modelo; las paginas sin evidencia se muestran como revisadas y no se publican como APIs.
