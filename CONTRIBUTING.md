# Contribuir

Para repartir el trabajo entre las tres ramas del equipo, consulta [TODO_MVP.md](TODO_MVP.md): responsables, límites de edición, prioridades y criterios de aceptación.

Usa Node 24, `npm ci`, `npm test` y `npm run build`. Los tests deben funcionar sin red y sin claves.

Para agregar una API al catálogo, aporta contrato OpenAPI, URL de documentación pública y ejemplos sin credenciales. Incluye las limitaciones conocidas y pruebas del método/ruta principal. Usa datos ficticios y señala la fuente de cada operación.

Para reportar un caso de documentación que falla, adjunta la URL y un fragmento reducido sin secretos. Los cambios al motor deben probar validación de parámetros, escenarios y aislamiento de prefijos.

No incluyas `.env`, credenciales ni estadísticas inventadas presentadas como oficiales. Las contribuciones se distribuyen bajo MIT.
