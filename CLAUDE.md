# EcoFarma - Diario de la Salud (backend)

## Integración con WordPress (ecofarma.co)

Los artículos de este backend se muestran en `https://ecofarma.co/blog/` (título visible
"Artículos") vía un shortcode de WordPress (`[diario_salud]`) que consulta `GET /articles`
y `GET /articles/:id` en vivo — no hay push de posts nativos.

**Antes de tocar cualquier cosa relacionada con cómo se ven los artículos en WordPress**
(diseño de la grilla, dónde aparecen, autenticación con la API, etc.), lee
[`docs/integracion-wordpress-diario-salud.md`](docs/integracion-wordpress-diario-salud.md)
completo. Documenta la arquitectura, dos snippets de WPCode en producción con sus IDs
exactos, y — importante — varios bugs/incidentes reales ya resueltos (un fatal error que
tumbó el sitio completo, un bug de `get_permalink()` fuera del Loop, un anclaje CSS frágil)
para no repetirlos.

Copias fuente de los snippets de WPCode (edítalas aquí primero, luego copia a producción —
ver la sección "Cómo modificar esto en el futuro" del doc de arriba):
- `docs/wpcode-diario-salud-shortcode.php`
- `docs/wpcode-diario-salud-blog-insert.php`
