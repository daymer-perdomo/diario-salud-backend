# EcoFarma - Diario de la Salud (backend)

## Integración con WordPress (ecofarma.co)

Dos secciones de contenido de este backend se muestran en WordPress, cada una vía su propio
shortcode que consulta la API pública en vivo (nunca push de posts nativos):

- **Artículos** (Diario de la Salud) en `https://ecofarma.co/blog/` — shortcode
  `[diario_salud]`, consume `GET /articles` y `GET /articles/:id`.
- **Blogs** (posts SEO con hub/sub-hub, secciones y FAQs) en `https://ecofarma.co/blogs/` —
  shortcode `[diario_blog]`, consume `GET /blog/public` y `GET /blog/public/:id`.

Ambas páginas se enlazan entre sí con una miga de pan compartida.

**Antes de tocar cualquier cosa relacionada con cómo se ve este contenido en WordPress**
(diseño de la grilla, dónde aparecen, autenticación con la API, etc.), lee
[`docs/integracion-wordpress-diario-salud.md`](docs/integracion-wordpress-diario-salud.md)
completo. Documenta la arquitectura, los snippets de WPCode en producción con sus IDs
exactos, y — importante — varios bugs/incidentes reales ya resueltos (un fatal error que
tumbó el sitio completo, un bug de `get_permalink()` fuera del Loop, un anclaje CSS frágil,
y cómo verificar correctamente que un snippet de WPCode se guardó — ver sección 10, es
fácil obtener falsos negativos) para no repetirlos.

Copias fuente de los snippets de WPCode (edítalas aquí primero, luego copia a producción —
ver la sección "Cómo modificar esto en el futuro" del doc de arriba):
- `docs/wpcode-diario-salud-shortcode.php` ([diario_salud])
- `docs/wpcode-diario-salud-blog-insert.php` (inserción en /blog/)
- `docs/wpcode-diario-blog-shortcode.php` ([diario_blog])

## Disponibilidad de productos (WooCommerce)

El panel de EcoFarma (sección Inventario → "Disponibilidad en WordPress") permite buscar un
producto de WooCommerce y marcarlo no disponible/agotado desde ahí -- el cambio se encola
(`WoocommercePendingChange`) y un snippet en WordPress lo aplica automáticamente en su
próxima corrida (hasta 5 min). El panel también muestra qué está agotado/oculto en
WooCommerce ahora mismo, reportado por ese mismo snippet cada 15 min.

Van dos intentos previos que **fallaron en producción** (el snippet nunca lograba quedar
"Activo" en WPCode, causa nunca confirmada) antes de este tercero, que usa funciones con
nombre en vez de closures -- el mismo estilo que sí se mantiene activo en los snippets de
Diario de la Salud/Blog. Antes de tocar esto, lee
[`docs/integracion-inventario-wordpress.md`](docs/integracion-inventario-wordpress.md)
completo (secciones 0, 0.1 y 8) para no repetir los mismos intentos fallidos. Snippet:
`docs/wpcode-inventario-disponibilidad.php`.
