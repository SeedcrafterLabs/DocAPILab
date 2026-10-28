# DocApiLab by SeedCrafterLabs - MVP local

Objetivo: ejecutar con npx, configurar una clave personal de OpenAI, DeepSeek, Google Gemini o Anthropic y Firecrawl, pegar documentacion y consumir un sandbox local. Catalogo vacio. SQLite automatico; no requiere base central ni cuentas propias.

## Dev 1 - Interfaz y experiencia

Rama sugerida: dev/interfaz

- [ ] Revisar marca DocApiLab by SeedCrafterLabs en inicio, ajustes, titulo y mensajes.
- [ ] Mostrar configuracion independiente del proveedor de IA y Firecrawl, incluyendo guardar, reemplazar y eliminar claves.
- [ ] Mantener catalogo vacio con mensaje claro y accion Agrega tus docs.
- [ ] Mostrar progreso de indexacion por pagina y errores recuperables en Mis sandboxes.
- [ ] Validar flujo completo en escritorio y movil.

Aceptacion: un usuario nuevo entiende las dos claves necesarias y puede crear y probar un sandbox desde la interfaz sin editar archivos.

## Dev 2 - Consumidor Firecrawl y proveedores IA

Rama sugerida: dev/documentacion-ia

- [ ] Verificar Firecrawl con una clave real y una URL de referencia de API.
- [ ] Verificar generacion con al menos un proveedor real; revisar Google Gemini y Anthropic con las claves disponibles.
- [ ] Conservar limites de paginas, texto, concurrencia y llamadas; no ejecutar codigo generado.
- [ ] Rechazar documentos sin endpoints verificables y mostrar fallos de saldo, clave o limite sin revelar secretos.
- [ ] Entregar contrato validado con GET y POST, parametros y ejemplos coherentes.

Aceptacion: pegar una URL publica crea endpoints consultables y el progreso identifica las paginas analizadas. Las consultas al sandbox no vuelven a llamar servicios externos.

## Dev 3 - CLI, almacenamiento e integracion

Rama sugerida: dev/motor-integracion

- [ ] Probar el tarball con npm exec en una carpeta limpia de Windows.
- [ ] Verificar apertura del navegador, puerto 4000 y alternativa si esta ocupado.
- [ ] Verificar persistencia de sandboxes y escenarios con SQLite al reiniciar.
- [ ] Ejecutar pruebas y build, revisar contenido del paquete sin claves ni datos locales.
- [ ] Publicar @seedcrafterlabs/docapilab cuando exista acceso a npm y validar npx desde instalacion limpia.

Aceptacion: npx inicia una instalacion limpia, abre la interfaz y permite completar el flujo sin clonar el repositorio ni instalar bases de datos.

## Coordinacion

- [ ] Un responsable por archivo compartido: src/shared/providers.ts, tipos, package.json y package-lock.json.
- [ ] Acordar cambios de API administrativa antes de modificar cliente y servidor.
- [ ] PR pequena por entrega; integrar una a la vez y ejecutar pruebas y build en main.
- [ ] No compartir settings.json, .env ni bases locales; cada dev usa sus claves.

## Demo final

- [ ] Inicio limpio, configuracion de IA y Firecrawl, catalogo vacio.
- [ ] URL real, progreso visible y sandbox GET/POST consumido desde otra app.
- [ ] Escenario de error, detener/iniciar y reapertura despues de reiniciar.
- [ ] README con comando real publicado o alternativa local claramente identificada.

Fuera de esta entrega: cuentas, catalogo curado, base compartida, despliegue central y persistencia de recursos simulados.
