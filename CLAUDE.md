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
Diario de la Salud/Blog. **Este tercer intento sí quedó activo y confirmado funcionando en
producción** (post_id=338454), validado de punta a punta con espera pasiva real (sin
disparo manual) en ambas direcciones (marcar no disponible → se aplica solo; volver a
disponible → también se aplica solo). Antes de tocar esto, lee
[`docs/integracion-inventario-wordpress.md`](docs/integracion-inventario-wordpress.md)
completo -- secciones 0 y 0.1 para el historial de los intentos fallidos y no repetirlos,
**sección 9 para el estado actual en producción** (los dos bugs reales que hubo que resolver,
qué hay activo en el panel: botón combinado, Lista Negra, creación manual de productos,
paginación) y sección 8 como alternativa manual si el snippet alguna vez está caído. Snippet:
`docs/wpcode-inventario-disponibilidad.php`.

## Chatbot en WordPress

El chatbot de inventario (`src/chatbot/`, widget en `public/widget/chatbot.js`) se embebe en
ecofarma.co con un snippet propio (distinto de los dos de arriba) que solo imprime un
`<script>` en el footer -- sin cron, sin lógica de negocio, el más simple y de menor riesgo
de las tres integraciones. Además del catálogo interno (Distrimonaco), el chatbot ahora
también consulta `WoocommerceCatalogItem` (la misma copia que alimenta la sección de
Disponibilidad de arriba) para saber si un producto con stock físico está realmente visible/
disponible en la tienda en línea. El modelo y la API key de Gemini (compartidos con el resto
del pipeline de IA) son configurables desde el panel en `Chatbot` → "Configuración del modelo
de IA" (`GET`/`PATCH /ai-settings`) en vez de fijos en variables de entorno; la personalidad/
tono sigue siendo el prompt `CHAT_REPLY_COMPOSITION` de siempre, editable en `Guía`. Antes de
tocar esto, lee
[`docs/integracion-chatbot-wordpress.md`](docs/integracion-chatbot-wordpress.md) completo.
Snippet: `docs/wpcode-chatbot-widget-embed.php` (2026-08-09: preparado, todavía sin pegar en
WPCode de producción).
