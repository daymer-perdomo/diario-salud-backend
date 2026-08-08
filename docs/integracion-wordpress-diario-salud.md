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

---

## 9. Segunda sección de contenido: Blog (`[diario_blog]`, /blogs/) — 2026-08-07

Adicional al Diario de la Salud, el backend tiene un módulo `src/blog/*` (modelos
`BlogPost`/`BlogPostSection`/`BlogFaq`/`BlogTag`) para posts SEO con taxonomía hub/sub-hub,
secciones H2 y FAQs, importados desde un Excel maestro. Es un tipo de contenido totalmente
distinto a Articles: sin pipeline de validación (grounding/compliance/revisor humano), sin
`riskLevel`, sin `imageUrl`. Ver `scripts/import-blog-master.ts` para el import.

**Endpoint público** (mismo patrón que `/articles`, mismo `PUBLIC_API_KEY`):
- `GET /blog/public?page=&pageSize=&hub=` — listado. **Filtrado por `published: true`**
  (ver sección 9.1 — corregido el 2026-08-07, antes no filtraba nada).
- `GET /blog/public/:id` — detalle con `sections` y `faqs` ordenadas. `404` tanto si no
  existe como si existe pero no está publicado.
- Implementado en `src/blog/blog-public.controller.ts` + métodos `findPublicPosts`/
  `findPublicPostById`/`toPublicBlogPost` en `src/blog/blog.service.ts`. Interfaz
  `PublicBlogPost` ahí mismo — nunca expone `aiGenerationRule`, `notes`,
  `regulatoryLevel`, `productPolicy`, `sourceFile`, etc.

### 9.1. Crear y publicar un post desde el panel — 2026-08-07

Antes de esta fecha, la única forma de meter datos en `BlogPost` era el import masivo del
Excel (`scripts/import-blog-master.ts`), y `/blog/public` no filtraba por ningún estado —
cualquier fila, sin importar cómo llegara, se mostraba de inmediato en WordPress. Ambas
cosas se corrigieron:

- **`published: Boolean` + `publishedAt: DateTime?`** (nuevos campos en `BlogPost`,
  migración `20260807220608_add_blog_published_state`) son el único gate real hacia
  `/blog/public`. Todo lo demás (`draftStatus`, `reviewStatus`, `medicalValidationStatus`,
  `publicationStatus`) sigue siendo texto/estado heredado del Excel, sin efecto en qué se
  publica.
- **Crear un post desde cero** (sin pasar por el Excel): panel → Blog → "+ Nuevo post"
  (título + hub) → `POST /blog/posts`. Nace con `published: false`. `globalId` (NOT NULL +
  unique en el schema, normalmente traza la fila del Excel) se genera sintético
  (`panel-<uuid>`) para posts creados así.
- **Agregar contenido**: dentro del detalle del post, "+ Agregar sección"/"+ Agregar FAQ"
  (`POST /blog/posts/:id/sections` y `.../faqs`) van sumando H2s y preguntas una por una —
  a diferencia del import del Excel, que trae todo de una vez.
- **Publicar**: botón "Publicar en WordPress" en el detalle del post
  (`POST /blog/posts/:id/publish` / `.../unpublish`). Es la única acción que lo hace
  aparecer en `GET /blog/public` y por lo tanto en `https://ecofarma.co/blogs/` —
  crear el post, redactar secciones/FAQs o guardar cambios de título/slug **no** lo publican
  por sí solos.
- Verificado end-to-end en local el 2026-08-07: crear → confirmar ausente en
  `/blog/public` → agregar sección + FAQ → publicar → confirmar presente con el contenido
  completo → despublicar → confirmar que vuelve a desaparecer.
- Verificado también en **producción** el mismo día, de punta a punta desde el panel real
  (`https://diario.ecofarma.co/`) hasta `https://ecofarma.co/blogs/`: post "La importancia
  de la hidratación diaria para tu salud" (hub Vida Saludable) creado, con una sección y una
  FAQ, publicado, y confirmado visible tanto en la tarjeta del listado como en el detalle
  (`?post_blog=<uuid>`), con la miga de pan Artículos↔Blogs funcionando en ambas direcciones.
  Dos hallazgos de esta prueba en vivo están documentados en la sección 11 (bug de UI) y la
  sección 12 (demora esperada por cache).

### 9.2. Imagen del post (subida manual, con la misma imagen de respaldo que Artículos) — 2026-08-07

`BlogPost.imageUrl` (`String?`, migración `20260807230648_add_blog_image_url`) es opcional y
se gestiona con dos acciones dedicadas, separadas de crear/editar el post (mismo criterio
que `published`/`publishedAt`, sección 9.1):

- `POST /blog/posts/:id/image` — multipart, campo `file`. Acepta JPG/PNG/WEBP/GIF, máx 5MB
  (`src/blog/blog-image.storage.ts`, `blogImageMulterOptions`). Si el post ya tenía una
  imagen subida, borra el archivo viejo del disco antes de guardar el nuevo. El nombre en
  disco siempre se genera (`randomUUID()` + extensión), nunca se usa el nombre original del
  archivo subido.
- `DELETE /blog/posts/:id/image` — quita la imagen (borra el archivo y pone `imageUrl` en
  `null` en la fila).
- **Fallback en la API pública**: `toPublicBlogPost()` en `blog.service.ts` devuelve
  `post.imageUrl || DEFAULT_ARTICLE_IMAGE_URL` — reutiliza **la misma constante** que ya usan
  los Artículos (`src/common/default-article-image.util.ts`, aplicada en
  `toPublicArticle()` dentro de `articles.service.ts`), a propósito: un solo lugar para
  cambiar la imagen de respaldo de todo el sitio. `GET /blog/public` nunca devuelve
  `imageUrl: null`.
- **Panel**: en el detalle del post, campo "Imagen del post" (`public/sections/blog.html`) —
  preview + `<input type="file">` + botón "Quitar imagen". Métodos `uploadBlogImage`/
  `removeBlogImage` en `public/index.html`, invocados desde dentro de
  `x-for="post in blogPosts"` — usan `this._fetch(...)` directo (nunca el alias
  `this.post(...)`, ver sección 11) y, para la subida, arman un `FormData` sin fijar
  `Content-Type` a mano (el navegador arma el boundary multipart solo; usar
  `this.headers()` ahí rompería la subida al forzar `application/json`).

**Almacenamiento — por qué hay un Render Disk (`render.yaml`)**

El backend corre en Render sin disco persistente configurado antes de esta fecha (Docker
`runtime`, sin bloque `disk:`). El filesystem de un contenedor así es efímero: cualquier
archivo escrito en disco (como una imagen subida) desaparece en el siguiente deploy o
restart. Se agregó un disco (`diario-salud-blog-uploads` / `-staging`, 1GB, montado en
`/app/public/uploads`) a **ambos** servicios (producción y staging) para que las imágenes
sobrevivan. El resto de `public/` (panel, `assets/`) sigue viniendo de la imagen Docker vía
`COPY . .` — el disco solo cubre `/app/public/uploads`, que `ServeStaticModule` sirve en
`/uploads/blog/<archivo>` igual que cualquier otro estático de `public/`.

⚠️ **Aplicar `render.yaml` requiere sincronizar el Blueprint en el dashboard de Render** —
agregar un disco a un servicio existente no ocurre solo con el `git push`; hace falta que
Render aplique el cambio de infraestructura (ver el servicio en el dashboard tras el deploy).

**Lado de WordPress:** `ecofarma_render_blog_card()`/`ecofarma_render_blog_detalle()` en
`docs/wpcode-diario-blog-shortcode.php` ya renderizan `<img>` cuando `imageUrl` viene
presente, con el mismo patrón (`esc_url`, mismo estilo inline) que
`wpcode-diario-salud-shortcode.php` usa para Artículos — no se creó CSS nueva, la tarjeta
reutiliza `.ecofarma-card__img img{...}` de `ecofarma_diario_salud_css()`, compartida con
Artículos. **Pendiente**: pegar el archivo actualizado en el snippet real de WPCode
(`snippet_id=338447`) en producción — el cambio en el repo todavía no se llevó al sitio en
vivo (ver sección 7 para el procedimiento seguro de pegar en el editor de WPCode).

Verificado end-to-end en local el 2026-08-07: crear post → subir imagen → confirmar
`imageUrl` real en `/blog/public` tras publicar → quitar imagen → confirmar que
`/blog/public` vuelve a devolver `DEFAULT_ARTICLE_IMAGE_URL` → reemplazar una imagen dos
veces seguidas y confirmar que el archivo viejo se borra del disco (no quedan huérfanos) →
subir a un `postId` inexistente y confirmar que el archivo que multer ya había escrito a
disco (antes de que el service pudiera validar que el post no existe) se borra igual, sin
dejar huérfano (ver el `try/catch` en `BlogService.uploadImage`). No se probó contra
producción ni se aplicó el Render Disk todavía.

- **`snippet_id=338447`** "EcoFarma - Blog (shortcode via API)" — hermano del 338437,
  registra `[diario_blog]`. Copia fuente:
  [`docs/wpcode-diario-blog-shortcode.php`](wpcode-diario-blog-shortcode.php).
- **Página "Blogs"** en `https://ecofarma.co/blogs/` (post_id=338445), contenido literal
  `[diario_blog]` — a diferencia de "Artículos", esta SÍ es una Página normal con contenido
  editable (no la posts-page del sitio), así que no necesitó un snippet de "inserción"
  como el 338438.
- **Migas de pan compartidas**: `ecofarma_breadcrumb_nav()`/`ecofarma_breadcrumb_css()` y
  las constantes `ECOFARMA_NAV_ARTICULOS_URL`/`ECOFARMA_NAV_BLOGS_URL` están definidas
  IDÉNTICAS en AMBOS snippets (338437 y 338447), cada una con su guard
  (`function_exists`/`defined`). Si tocas estos nombres, cámbialos en los dos archivos a la
  vez (ver el comentario de cabecera en `wpcode-diario-blog-shortcode.php`).

---

## 10. Lección crítica: cómo verificar que un snippet de WPCode SÍ se guardó

El editor de código de WPCode usa **CodeMirror**, que virtualiza las líneas — solo renderiza
en el DOM las líneas actualmente visibles en el viewport del editor. Esto rompe una forma
obvia de verificar que un guardado se aplicó:

```js
// MAL -- da falso negativo si el texto buscado está en una línea no renderizada
document.body.innerText.includes('mi_funcion_nueva')
```

La única forma confiable de leer el contenido REAL y COMPLETO del editor (esté o no
scrolleado a la vista) es a través de la instancia de CodeMirror directamente:

```js
// BIEN -- devuelve el documento completo sin importar el scroll
document.querySelector('.CodeMirror').CodeMirror.getValue()
```

El 2026-08-07 esto causó una sesión larga de debugging fantasma: varios guardados de
snippets SÍ se habían aplicado correctamente en el primer intento, pero la verificación con
`document.body.innerText` reportaba "no guardado" porque el código buscado estaba fuera del
área visible del editor en ese momento — llevando a reintentar el guardado innecesariamente
varias veces (sin causar daño, gracias a los guards `function_exists()`/`defined()`, pero
sí perdiendo tiempo). Al mismo tiempo se investigó (sin necesidad, en retrospectiva) una
supuesta discrepancia de escala de píxeles entre capturas de pantalla y coordenadas reales
de clic (`getBoundingClientRect()` mostraba `devicePixelRatio: 2` y coordenadas distintas a
las de la captura) — las coordenadas de captura de pantalla (screenshot-space) resultaron
ser las correctas para la herramienta de automatización del navegador; no hacía falta
"corregirlas" multiplicando por el device pixel ratio. **Siempre usa
`CodeMirror.getValue()` para verificar contenido guardado antes de sospechar de las
coordenadas de clic.**

---

## 11. Lección: colisión de nombre entre un loop `x-for` y un método helper en Alpine.js

Al agregar los botones "+ Agregar sección"/"+ Agregar FAQ"/"Publicar en WordPress" al panel
(`public/sections/blog.html`), sus métodos (`addBlogSection`, `addBlogFaq`,
`toggleBlogPublish`, en `public/index.html`) llamaban al helper genérico de POST autenticado
del componente Alpine, `this.post(url, body)`. En producción, el clic en "+ Agregar sección"
fallaba con:

```
TypeError: this.post is not a function
```

**Causa:** la fila de la tabla donde vive el botón está dentro de
`<template x-for="post in blogPosts" :key="post.id">`. Alpine expone `post` como variable
mágica de ámbito local dentro de ese `x-for` — y esa variable de ámbito **tapa** (shadowing)
cualquier propiedad/método del componente que se llame igual, incluido el método helper
`post(url, body)`. Dentro de una expresión evaluada en ese ámbito (incluyendo el cuerpo de un
método invocado desde ahí, como `addBlogSection(post)`), `this.post` deja de resolver al
helper HTTP y resuelve al ítem del loop — de ahí el `TypeError`.

Pistas que confirmaron el diagnóstico en su momento:
- `createBlogPost()` (invocado FUERA del `x-for`, desde el formulario "+ Nuevo post" al nivel
  superior de la sección) funcionaba bien usando `this.post(...)`.
- `saveBlogSection`/`saveBlogFaq` (preexistentes, invocados DESDE DENTRO del mismo `x-for`,
  pero usando `this.patch(...)` — un nombre que no colisiona) también funcionaban bien.
- Solo los métodos nuevos que combinaban "invocado desde dentro de `x-for="post in ..."`" +
  "llama a `this.post(...)`" fallaban.

**Solución aplicada:** en cualquier método invocado desde dentro de ese `x-for`, evitar el
alias `this.post(...)` y llamar directo al helper de más bajo nivel que no colisiona:

```js
const r = await this._fetch(url, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
```

**Regla general:** antes de agregar un método que se invoque desde dentro de un
`x-for="X in algo"`, revisa si `X` coincide con el nombre de algún método/propiedad del
componente Alpine que ese método necesite usar. Un `x-for="product in products"` que llame a
`this.get`/`this.patch`/`this.delete` es seguro (no hay colisión de nombre); un
`x-for="post in ..."` que llame a `this.post` no lo es. Cuando haya duda, usa el helper de
más bajo nivel (`this._fetch`) en vez del alias corto, o renombra la variable de loop para
que no coincida con ningún método del componente.

---

## 12. Lecciones de la prueba en vivo del flujo de publicación de Blog (2026-08-07)

### 12.1 Un atributo `disabled` de Alpine puede quedar "pegado" en el DOM, incluso tras un reload

Al probar el botón "Publicar en WordPress" en producción, los clics no producían ningún
efecto: sin error en consola, sin petición de red (confirmado revisando
`performance.getEntriesByType('resource')` y el listado de requests — cero peticiones a
`.../publish` en ningún momento). Un recargue completo de la página (`F5`, confirmado como
recarga real vía `performance.getEntriesByType('navigation')[0].type === 'reload'`) y volver
a abrir el mismo post **no resolvió el problema** — el botón seguía sin reaccionar al clic.

Inspeccionando el elemento directamente:

```js
const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Publicar en WordPress'));
b.disabled       // true
b.hasAttribute('disabled')   // true — atributo HTML real, no solo la propiedad
```

pero el objeto reactivo real detrás del binding (`post._publishBusy`, obtenido con
`window.Alpine.$data(b).post`) ni siquiera tenía esa clave definida (`undefined`, no
`false`). Es decir: el atributo `disabled="disabled"` estaba presente en el DOM sin que la
expresión `:disabled="post._publishBusy"` que se supone lo controla evaluara a un valor
verdadero — una desincronización entre el binding de Alpine y el atributo real del elemento,
sobreviviendo incluso a un reload completo de la página (posiblemente el navegador
restaurando el estado del formulario/DOM desde el historial en vez de un parseo 100% desde
cero — no se confirmó la causa raíz exacta).

**Cómo se destrabó para poder seguir la prueba:**
```js
document.querySelector('button')... .removeAttribute('disabled')
```
tras lo cual el clic normal en el botón sí disparó `toggleBlogPublish` correctamente.

**Qué hacer si se repite:** no asumas que un botón "sin reacción" es un bug de lógica de
negocio antes de revisar `elemento.hasAttribute('disabled')` directamente — un `:disabled`
de Alpine puede quedar pegado por una desincronización de reactividad ajena al código de
`toggleBlogPublish`/`addBlogSection`/etc. en sí. Si vuelve a pasar en varios botones o de
forma reproducible (no solo una vez en una sesión de prueba larga con muchos reloads), vale
la pena investigar si es un bug real de la versión de Alpine usada o de cómo se estructuran
los `x-if`/`x-for` anidados en `blog.html`, en vez de solo destrabarlo a mano cada vez.

### 12.2 Publicar un post no lo muestra de inmediato en `/blogs/` — cache de 5 minutos

Justo después de publicar, `https://ecofarma.co/blogs/` seguía mostrando "No hay contenido
de blog disponible en este momento." **Esto no es un bug** — `ecofarma_api_get()` (compartida
entre los snippets 338437/338447, ver sección 2) cachea la respuesta de `GET /blog/public`
en un `transient` de WordPress por 5 minutos (`set_transient($cache_key, $data, 5 *
MINUTE_IN_SECONDS)`), y la página ya se había visitado (y cacheado como "sin resultados")
antes de que el post existiera. Confirmar directo contra la API (`curl` con el
`PUBLIC_API_KEY` real, sección 3) mostró el post ya presente y publicado — bastó esperar a
que el transient expirara para que `/blogs/` lo reflejara. **Al probar una publicación nueva,
espera hasta 5 minutos (o usa la API directo para confirmar) antes de concluir que la
publicación falló.** Nota aparte: WP Fastest Cache (visible en la barra de admin) NO es la
causa aquí — tiene activada la opción de no cachear para usuarios conectados, así que un
admin logueado ya ve HTML fresco; el cuello de botella es el transient propio del snippet,
independiente de ese plugin.
