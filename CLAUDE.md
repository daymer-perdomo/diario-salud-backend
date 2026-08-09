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
de las tres integraciones. Snippet: `docs/wpcode-chatbot-widget-embed.php` (post_id=338459,
en producción y confirmado funcionando desde 2026-08-09).

**2026-08-09, pedido explícito del usuario: WooCommerce (`WoocommerceCatalogItem`, ~42,000
productos) es la fuente PRIMARIA de búsqueda por nombre, precio y disponibilidad del
chatbot** -- antes buscaba primero en el catálogo interno de Distrimonaco (~7,000) y solo
cruzaba WooCommerce como verificación secundaria; eso se invirtió. Distrimonaco pasó a ser el
enriquecimiento secundario (stock físico por sucursal, si requiere receta, alternativas por
principio activo) solo cuando el mismo SKU también existe ahí. Consecuencia real aceptada:
como el carrito del chat (`ChatCartService`) solo puede armar pedidos con productos que
existen en Distrimonaco (el personal despacha de inventario físico real), la mayoría de lo
que WooCommerce ahora expone no se puede agregar al carrito del chat -- en esos casos el
chatbot ofrece el link directo a la tienda (`permalink`) en vez de "Agregar" (ver `canOrder`
en `ChatbotService`). El modelo y la API key de Gemini (compartidos con el resto del pipeline
de IA) son configurables desde el panel en `Chatbot` → "Configuración del modelo de IA"
(`GET`/`PATCH /ai-settings`) en vez de fijos en variables de entorno; la personalidad/tono
sigue siendo el prompt `CHAT_REPLY_COMPOSITION` de siempre, editable en `Guía`. Antes de tocar
esto, lee
[`docs/integracion-chatbot-wordpress.md`](docs/integracion-chatbot-wordpress.md) completo --
**sección 6 en particular** documenta dos incidentes reales de despliegue: sobreescribir la
API key real de producción con el placeholder del repo al reemplazar `post_content` completo
en vez de solo la línea que cambiaba, y editar el snippet de WordPress antes de que el código
nuevo del backend estuviera desplegado (el `ValidationPipe` rechaza cualquier campo que el
DTO en producción no conozca todavía). Ambos con su fix real, para no repetirlos. Validado en
producción con un producto real que solo existe en WooCommerce (NOFERTYL, SKU
7702870002636).

**Sección 7**: resultados de productos en carrusel horizontal siempre (no tarjetas/tabla
según cantidad) y saludo inicial con lista de capacidades -- **dos bugs de CSS reales que no
daban ningún error visible** (comentario `///` inválido dentro de un string CSS, que hace que
el navegador descarte la regla completa en silencio; y un carrusel que se aplastaba a ~2px
con historial largo por la interacción `overflow-x:auto` → `min-height:auto` se vuelve `0` en
flexbox). Si algo dentro de `chatbot.js` deja de aplicarse "sin razón", **verificar el CSSOM
real** (`shadowRoot.styleSheets[0].cssRules`) en vez de asumir que el código fuente es lo que
se está aplicando -- un error de sintaxis CSS no siempre aparece en la consola.
