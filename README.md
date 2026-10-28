# DocApiLab by SeedCrafterLabs

Convierte documentacion publica de APIs REST en sandboxes locales para desarrollar antes de recibir credenciales del proveedor.

## Inicio local

Requiere Node.js 24 o posterior. Desde el repositorio:

```powershell
npm ci
npm run build
npm start
```

Abre automaticamente http://127.0.0.1:4000. Si el puerto esta ocupado, muestra otro disponible. Ctrl+C detiene el servidor.

En Ajustes, elige **DeepSeek, Google Gemini o Anthropic**, guarda tu API key personal y la clave de **Firecrawl**. Solo necesitas uno de los tres proveedores de IA, mas Firecrawl. El modelo es configurable.

Pega una URL de documentacion. Firecrawl obtiene Markdown y enlaces; la IA propone el contrato; DocApiLab valida y publica los endpoints simulados. El progreso aparece en Mis sandboxes. El catalogo esta vacio por ahora.

Tambien puedes importar OpenAPI JSON/YAML sin claves. Las llamadas a los sandboxes no consumen IA ni Firecrawl.

## Distribucion con npx

Nombre preparado: **@seedcrafterlabs/docapilab**, comando **docapilab**. Pendiente de publicar en npm; el siguiente comando funcionara cuando se publique:

```sh
npx @seedcrafterlabs/docapilab
```

Para probar el paquete antes de publicar:

```powershell
npm pack
npm exec --package=./seedcrafterlabs-docapilab-0.1.0.tgz -- docapilab --no-open
```

## Datos y claves

SQLite local se crea automaticamente. No necesitas PostgreSQL ni una cuenta de DocApiLab. Se conserva la carpeta historica `~/.docs2api` para no perder los sandboxes existentes. Puede cambiarse con `DOCS2API_DATA_DIR`.

Las claves se guardan en `settings.json` fuera del repositorio, en el perfil del usuario. No estan cifradas; no compartas ese archivo. La API de ajustes solo devuelve indicadores de configuracion. Cada proveedor conserva su propia clave. La documentacion se envia a Firecrawl y al proveedor de IA seleccionado; los archivos de migracion se procesan localmente.

Las variables de entorno de .env.example son opcionales para desarrollo. No subas .env, claves, bases de datos ni node_modules. DATABASE_URL y compose.yaml siguen disponibles para despliegues opcionales, fuera del flujo local del MVP.

## Limites del MVP

- REST con respuestas JSON. Hasta 8 paginas y 3 analisis por recorrido; hasta 3 operaciones principales por analisis. Importar OpenAPI admite hasta 80 operaciones.
- Respuestas simuladas segun contrato; escenarios de exito, error y latencia. Las escrituras no persisten recursos de negocio.
- El progreso de indexacion vive en memoria; los sandboxes y escenarios si persisten entre reinicios.
- La migracion genera un parche revisable. No garantiza compatibilidad real hasta probar con credenciales del proveedor.

## Desarrollo

```sh
npm test
npm run build
```

Tareas del equipo: [TODO_MVP.md](TODO_MVP.md). Licencia MIT.
