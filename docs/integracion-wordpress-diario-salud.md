# Integración "Diario de la Salud": EcoFarma ↔ WordPress (vía API pública)

**Estado:** ✅ Implementado y verificado en vivo en producción (ecofarma.co) el 2026-08-07.
**Para quién es este documento:** cualquier sesión de Claude (o desarrollador humano) que
vaya a tocar cómo se muestran los artículos del Diario de la Salud en el sitio de WordPress.
Léelo ANTES de crear un nuevo snippet de WPCode o de tocar los existentes — varios de los
detalles de acá no son obvios y ya causaron bugs reales en producción.

---

## 1. Arquitectura actual (resumen para orientarte rápido)

```
Backend NestJS (este repo)                    WordPress (ecofarma.co)
─────────────────────────                     ────────────────────────
GET /articles                    <── pull ──   Snippet WPCode "shortcode via API"
GET /articles/:id                              (snippet_id=338437) registra [diario_salud]
  auth: X-API-Key                              Snippet WPCode "insercion en /blog/"
  (PUBLIC_API_KEY)                             (snippet_id=338438) lo invoca en /blog/
```

- **No hay push.** El backend nunca escribe en WordPress. `WordpressPublishService`
  (`src/wordpress/wordpress-publish.service.ts`) sigue existiendo en el código pero está
  desactivado en producción (las env vars `WORDPRESS_BASE_URL`/`WORDPRESS_USERNAME`/
  `WORDPRESS_APP_PASSWORD`/`WORDPRESS_CATEGORY_ID` no están seteadas en Render).
- **WordPress jala en vivo.** Cada carga de `/blog/` en ecofarma.co hace un
  `wp_remote_get()` (con cache de 5 min vía transient) a `GET /articles?state=PUBLICADO`.
  No existen posts nativos de WordPress para el Diario de la Salud — todo se renderiza al
  vuelo desde la API.
- **Un solo shortcode cubre listado y detalle.** `[diario_salud]` sin query params
  muestra la grilla; con `?articulo=<uuid>` en la URL muestra el detalle de ese artículo.
  No hay un custom post type ni una página por artículo.
- **La página se llama "Artículos"** (antes "Blog") en el título visible, pero el slug/URL
  sigue siendo `/blog/` — no lo cambiamos para no romper enlaces existentes.

---

## 2. Los dos snippets de WPCode (qué son, dónde viven)

| snippet_id | Nombre en WPCode | Qué hace | Ubicación configurada |
|---|---|---|---|
| **338437** | EcoFarma - Diario de la Salud (shortcode via API) | Registra `[diario_salud]`: toda la lógica (llamada a la API, render de tarjetas, render de detalle, CSS de la grilla) | "Ejecutar en todas partes" (solo *registra* el shortcode, no imprime nada por sí solo) |
| **338438** | EcoFarma - Diario de la Salud (insercion en /blog/) | Una línea: `echo do_shortcode('[diario_salud]');` | "Al principio de elemento HTML", selector `.site-main`, lógica condicional: URL contiene `/blog/` |

Copias fuente de ambos (para no depender de recordar qué hay pegado en producción):
- [`docs/wpcode-diario-salud-shortcode.php`](wpcode-diario-salud-shortcode.php) ↔ snippet 338437
- [`docs/wpcode-diario-salud-blog-insert.php`](wpcode-diario-salud-blog-insert.php) ↔ snippet 338438

**Estas copias NO se sincronizan solas.** Si editas el snippet en WPCode, actualiza el
archivo correspondiente en este repo (o viceversa). No hay CI ni webhook conectando ambos.

### Por qué son dos snippets separados y no uno solo

El primero (338437) es "lógica pura" — puede vivir en cualquier ubicación porque solo
registra el shortcode, no imprime nada. El segundo (338438) es "dónde aparece" — es
deliberadamente mínimo (una sola línea, sin funciones ni `define()`) para poder cambiar de
ubicación sin arriesgar corromper la lógica de negocio. Si mañana quieres mover el shortcode
a una página nueva en vez de `/blog/`, solo tienes que tocar 338438 (o de plano borrarlo y
poner `[diario_salud]` directo en el contenido de una Página de WordPress).

---

## 3. Autenticación

```
X-API-Key: <PUBLIC_API_KEY>
```

**El valor real que usa producción es `63ca0835f6dab5c589bf86d5019cc3075edc32854b65bd6a`**
(hardcodeado en el snippet 338437, constante `ECOFARMA_API_KEY`). Este valor viene del
dashboard de Render (servicio `diario-salud-backend`, env var `PUBLIC_API_KEY`).

⚠️ **No asumas que coincide con el `.env` local.** El 2026-08-07 confirmamos en vivo que el
`.env` local tenía un valor de `PUBLIC_API_KEY` distinto al de producción (probablemente
porque Render lo autogeneró al desplegar y nunca se sincronizó manualmente). Si el
shortcode empieza a devolver "No hay artículos disponibles" en vivo pero la API responde
bien por otro lado, sospecha primero de esto — verifica el valor real en el dashboard de
Render, no en el repo.

| Código HTTP | Significa |
|---|---|
| `401` | La clave falta o es incorrecta. |
| `404` | (Solo en `/articles/:id`) el artículo no existe, o no está aprobado. |
| `429` | Rate limit del backend (`ThrottlerModule`, 100 req/min global, `src/app.module.ts`). Puede aparecer si pruebas la API a mano muchas veces seguidas en poco tiempo — no es un error real de la integración, solo espera ~60s. |

---

## 4. Endpoints usados por el shortcode

### 4.1 `GET /articles?state=PUBLICADO&page={n}&pageSize={n}` — listado

Ver forma completa de la respuesta en `src/articles/articles.service.ts` (interfaz
`PublicArticle`). Campos que el shortcode realmente usa: `id`, `title`, `summary`,
`content` (texto plano, párrafos separados por `\n` — nunca imprimir crudo, siempre
`esc_html()` por párrafo), `keyPoints`, `whyItMatters`, `imageUrl`, `source.{name,url,
publishedAt}`.

### 4.2 `GET /articles/{id}` — detalle

Misma forma que un elemento de `data` del listado. `404` si no existe o no está aprobado.

---

## 5. Cosas que ya salieron mal una vez — no las repitas

### 5.1 Nunca declares funciones/constantes con nombre sin guard, en un snippet "Ejecutar en todas partes"

El 2026-08-04 (antes de esta implementación) otro snippet en este mismo sitio, con
funciones declaradas sin `function_exists()`, **tumbó el sitio completo** (ver el snippet
inactivo `snippet_id=338366` en WPCode, cuyo comentario documenta el incidente en detalle).
La causa: en PHP, redeclarar una función o `define()` de una constante ya definida es un
**fatal error no capturable con try/catch**. Un snippet "Ejecutar en todas partes" se
evalúa en cada carga de página — si por cualquier motivo el mismo código se carga dos
veces en el mismo request (duplicar el snippet por error, un bug de WPCode, multisite,
etc.), el sitio entero muere, no solo esa función.

**Regla:** todo `function`/`define()` en un snippet global va envuelto:
```php
if (!function_exists('mi_funcion')) {
function mi_funcion() { ... }
}
if (!defined('MI_CONSTANTE')) {
    define('MI_CONSTANTE', '...');
}
```
Los snippets 338437 y 338438 ya siguen esta regla — mantenla si los editas.

### 5.2 `get_permalink()` sin argumento es una trampa fuera del Loop

La primera versión del shortcode usaba `get_permalink()` (sin ID) para construir los
links "ver detalle" de cada tarjeta. Como el shortcode se invoca vía `do_shortcode()`
desde OTRO snippet (no como contenido de un post dentro del Loop principal de WordPress),
`get_permalink()` no sabe "en qué página estamos" — devuelve el permalink del último
`$post` global que haya quedado seteado por CUALQUIER OTRO código que corrió antes en esa
misma carga de página (otro widget, un loop de Elementor, etc.). En producción esto causó
que **todas las tarjetas enlazaran a la URL de un post nativo cualquiera** en vez de a
`/blog/`.

**La solución ya aplicada** (`ecofarma_current_page_url()` en el snippet 338437): calcular
la URL directamente desde `$_SERVER['REQUEST_URI']`, sin tocar el estado del Loop:
```php
function ecofarma_current_page_url() {
    $path_only = strtok($_SERVER['REQUEST_URI'], '?');
    return home_url($path_only);
}
```
Si en algún momento necesitas la URL "actual" dentro de un snippet de WPCode que no vive
dentro del Loop, usa este patrón, no `get_permalink()`.

### 5.3 Anclar un snippet a un selector CSS que depende de datos es frágil

La primera ubicación del snippet 338438 era "Después de elemento HTML" con selector
`.motta-posts-group` — el widget de tabs "Recent Posts / Popular Posts / Featured Posts"
del tema. Funcionaba mientras existían posts nativos en la categoría "Diario de la Salud".
Al mover esos posts a la papelera (sección 6), el widget dejó de tener contenido que
mostrar y **el tema dejó de renderizarlo por completo** — y con él, desapareció el punto
de anclaje del snippet, que simplemente dejó de insertarse en cualquier lado, sin ningún
error visible en logs ni en pantalla.

**Lección:** si vas a anclar un snippet de WPCode a un selector CSS, usa un elemento
estructural del tema que exista siempre (`.site-main`, `#primary`, `main`), no un widget
cuyo renderizado depende de si hay contenido. Si necesitas restringir a una sola página,
usa la sección "Lógica condicional inteligente" del propio snippet (regla "URL de la
página Contiene ..."), no el selector CSS.

### 5.4 Errores 520 de Cloudflare durante cambios masivos en wp-admin

Al mover varios posts a la papelera seguidos (sección 6), el sitio devolvió brevemente
`520` (Cloudflare no pudo conectar con el origen) dos veces, autorresolviéndose en
segundos ambas veces sin intervención. No se confirmó una causa exacta, pero lo más
probable es contención de recursos del hosting al disparar varios hooks a la vez (Rank
Math dispara "Indexado instantáneo" por cada cambio de estado de post, por ejemplo) — no
parece ser un error fatal de código, dado que se recuperó solo. Si vas a hacer cambios en
lote sobre varios posts/páginas, verifica la salud del sitio (`curl -s -o /dev/null -w
'%{http_code}' https://ecofarma.co/`) entre cada acción, no solo al final.

---

## 6. Historial: qué había ANTES de esta implementación (2026-08-07)

Antes de que este pull-based-shortcode fuera la única fuente de verdad, existían **otros
tres mecanismos independientes** en el mismo sitio, todos creados por el usuario en
sesiones anteriores, que se solapaban con esta funcionalidad:

1. **`snippet_id=338088`** "Diario de la Salud - Seccion Articulos en Blog" (creado 22 jul,
   estaba activo) — inyectaba una grilla de tarjetas parecida, apuntando al dominio viejo
   `diario-salud-backend.onrender.com` en vez de `diario.ecofarma.co`. **Desactivado.**
2. **`snippet_id=338087`** "Diario de la Salud - Sync Articulos (Cron)" (creado 22 jul,
   estaba activo) — cron por hora que **creaba entradas nativas de WordPress** en la
   categoría "diario-de-la-salud" jalando de la API. Usaba funciones con nombre SIN
   guards `function_exists()` — mismo patrón de riesgo que causó el incidente del 4 de
   agosto (ver 5.1). **Desactivado.**
3. **`snippet_id=338366`** "EcoFarma - Sync Diario de la Salud (pull desde
   diario.ecofarma.co)" (creado 4 ago, ya estaba inactivo) — rediseño defensivo del sync
   anterior, escrito TRAS el incidente de ese mismo día, usando solo closures y cero
   funciones con nombre. Documenta el incidente en su propio comentario (ver 5.1). Se dejó
   tal cual, inactivo, sin tocar.

Los **7 posts nativos** que había en la categoría "diario-de-la-salud" (creados por el
cron #2) — 5 legítimos + 2 intrusos en inglés pegados a mano por fuera del pipeline
("FDA Warns Consumers About Counterfeit Weight Loss Supplements Sold Online" y "WHO Issues
New Global Health Advisory on Rising Measles Cases", autor `sadiam`, investigados en una
sesión anterior) — se movieron a la Papelera de WordPress el 2026-08-07 (recuperables
durante 30 días si algún día se necesitan).

Si en el futuro reaparecen posts nativos en esa categoría sin que nadie los haya creado a
propósito, sospecha primero de estos snippets viejos — siguen existiendo en WPCode
(inactivos), alguien podría reactivarlos por error.

---

## 7. Cómo modificar esto en el futuro (guía práctica)

1. **Edita primero el archivo local** (`docs/wpcode-diario-salud-shortcode.php` o
   `docs/wpcode-diario-salud-blog-insert.php`), no directo en WPCode — así queda historial
   en git y puedes revisar el diff antes de tocar producción.
2. **Pega el contenido completo en WPCode usando el portapapeles, no tecleando.** El
   editor de código de WPCode (CodeMirror) tiene un bug de auto-cierre de etiquetas HTML
   que duplica cierres (`</p>p>`, etc.) si escribes carácter por carácter con HTML mezclado
   con PHP. La forma segura: `pbcopy < archivo.php` en tu máquina, luego en el navegador
   clic en el editor → Cmd+A → Delete → Cmd+V. Este es precisamente el motivo por el que
   el código de ambos snippets usa concatenación de strings PHP (`$html .= '<div>...'`)
   en vez de mezclar `<?php ?>` con HTML plano — evita el problema de raíz.
3. **Verifica visualmente el código completo pegado** (scroll de principio a fin) antes de
   guardar — un pegado parcial o con basura al final es indetectable a simple vista si no
   revisas todo el archivo.
4. **Guarda, activa, y prueba en `https://ecofarma.co/blog/` en una pestaña sin sesión
   iniciada** (o con curl anónimo) — WP Fastest Cache y otros plugins de caché suelen
   saltarse el cache para usuarios logueados, así que probar como admin puede ocultar
   bugs que sí ven los visitantes reales.
5. Si necesitas la clave real de `PUBLIC_API_KEY` de producción, pídela — no la asumas del
   `.env` local (ver sección 3).

---

## 8. Verificado en producción (2026-08-07)

- ✅ Ambos snippets guardados y activos.
- ✅ Grilla de 3 columnas en `/blog/`, título de la página cambiado a "Artículos".
- ✅ Clic en una tarjeta lleva al detalle correcto (bug de `get_permalink()` corregido).
- ✅ Los 3 mecanismos viejos solapados quedaron desactivados; los 7 posts nativos viejos,
  en papelera.
- ✅ Sitio estable durante y después de todos los cambios (dos blips de 520 que
  autorresolvieron en segundos, no relacionados con errores de código).

Pendiente / fuera de alcance de esta entrega:
- No se editó el menú principal del sitio (si algún enlace apunta directo a la vieja
  categoría "Diario de la Salud" en vez de a `/blog/`, revisar Apariencia → Menús).
- No se investigó si algún widget de Elementor sigue configurado para leer la categoría
  "diario-de-la-salud" — como ya no hay posts nativos ahí, esos widgets deberían
  mostrarse vacíos, pero no se auditó exhaustivamente el resto del sitio en busca de
  referencias a esa categoría.
