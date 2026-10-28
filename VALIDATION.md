# Validación del MVP

Verificado en Windows con Node 24:

- Compilación TypeScript, React/Vite y CLI completada.
- 19 pruebas automáticas sin claves aprobadas; el test opcional de PostgreSQL se verificó por separado en una instancia temporal PostgreSQL 18.
- Chrome: catálogo, creación de INEGI, llamada HTTP, escenario de error, pausa/inicio, ajustes con tres proveedores, navegación a migración y ancho móvil sin desbordamiento.
- El paquete npm local arrancó mediante `npm exec --package=./docs2api-lab-0.1.0.tgz -- docs2api --no-open`; eligió el puerto 4001 cuando el 4000 estaba ocupado.
- Generación real desde `https://www.inegi.org.mx/servicios/api_indicadores.html` usando DeepSeek: sandbox con INDICATOR, CL_INDICATOR y CL_UNIT. Las tres llamadas locales de ejemplo devolvieron HTTP 200, JSON y `X-Docs2api-Simulated: true`. Cada operación incluye evidencia de la documentación.

La prueba real detectó y permitió corregir citas parafraseadas, exceso de salida y documentación repetida. Las generaciones nuevas extraen hasta tres operaciones principales, con contexto reducido y verificación posterior contra la fuente completa. Las operaciones sin evidencia se omiten y aparecen en advertencias.

OpenAI se probó contra el servicio real, pero la cuenta respondió con error de cuota. Anthropic está validado con respuestas simuladas; falta una prueba con una cuenta real. No se han publicado el repositorio, el paquete npm ni una instancia en nube. Docker está preparado, pero su daemon no estaba iniciado en la máquina de desarrollo.
