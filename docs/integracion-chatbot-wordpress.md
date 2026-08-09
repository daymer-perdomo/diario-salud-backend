# Integración del chatbot: EcoFarma ↔ WordPress

**Para:** desarrollador de WordPress de ecofarma.co
**Backend:** `https://diario.ecofarma.co`
**Última actualización:** 2026-08-09

---

## 1. Qué es esto

El chatbot de inventario ya está construido en el backend (`src/chatbot/`): un widget
público, sin login, que un cliente usa para preguntar por disponibilidad/precio/sucursal de
un producto y, si quiere, agregarlo directo al **carrito real de WooCommerce** (el mismo
`/carrito/` de la tienda -- ver sección 8, no existe un carrito propio del chat desde
2026-08-09).

Esta integración tiene dos partes, ambas ya implementadas del lado del backend:

1. **Embeber el widget en el sitio** -- un `<script>` que WordPress inserta en cada página.
2. **Que el chatbot sepa qué está realmente disponible en la tienda WooCommerce**, no solo
   en el catálogo interno de EcoFarma (Distrimonaco).

---

## 2. El widget (`public/widget/chatbot.js`)

Vanilla JS, sin dependencias, Shadow DOM (el CSS del widget nunca choca con el theme de
WordPress, y viceversa). Se sirve como archivo estático del backend en
`https://diario.ecofarma.co/widget/chatbot.js` -- no requiere build ni empaquetado del lado
de WordPress.

Resuelve su propia URL base de API en este orden (ver `public/widget/chatbot.js:13-21`):
1. El atributo `data-api-base-url` de su propio `<script>`, si está presente.
2. El origen (`https://dominio`) desde el que se cargó el script.

Habla con un único endpoint público, sin autenticación (protegido por rate limiting, no por
login -- es el único caso en todo el backend):
- `POST /chatbot/message` -- el mensaje del cliente y la respuesta del asistente (incluye el
  `id` numérico de WooCommerce de cada producto, que el widget usa para agregarlo al carrito
  nativo -- ver sección 8). Ya no existe `GET/POST /chatbot/cart/*` (carrito propio del chat,
  eliminado 2026-08-09 junto con `Pedidos`/`OrderRequest`).

Detecta el botón flotante del carrito de WooCommerce (`.xoo-wsc-basket`) para posicionar su
propio botón (FAB) siempre encima, sin importar el tema o el dispositivo.

### 2.1 Snippet de inserción

`docs/wpcode-chatbot-widget-embed.php` -- imprime el `<script>` en el footer de cada página
vía el hook `wp_footer`. A diferencia del snippet de disponibilidad de WooCommerce
(`docs/wpcode-inventario-disponibilidad.php`), este **no tiene cron ni lógica de negocio**:
es el snippet más simple y de menor riesgo de las cuatro integraciones con WordPress de este
proyecto. Aun así sigue el mismo patrón defensivo (función con nombre + `function_exists()`,
nunca un closure anónimo en un snippet "Ejecutar en todas partes" -- ver el incidente real
del 2026-08-04 documentado en `docs/integracion-inventario-wordpress.md` sección 4.2).

```php
if (!function_exists('ecofarma_chatbot_widget_embed')) {
function ecofarma_chatbot_widget_embed() {
    echo '<script src="https://diario.ecofarma.co/widget/chatbot.js" ' .
         'data-api-base-url="https://diario.ecofarma.co" defer></script>';
}
}
add_action('wp_footer', 'ecofarma_chatbot_widget_embed');
```

**Estado (2026-08-09): en producción, activo, confirmado funcionando.** `post_id=338459`
(WPCode, `post_status=publish`, tipo `php`, ubicación `everywhere`), creado y verificado vía
Novamira (sintaxis validada con `php -l` contra el propio servidor, y confirmado contra la
base de datos real -- `post_status`, taxonomías y la caché `wpcode_snippets` -- en vez de
confiar solo en la UI, ver sección 10 de `docs/integracion-wordpress-diario-salud.md` sobre
falsos negativos con WPCode). Validado en vivo: el `<script>` aparece en el HTML de
ecofarma.co, el botón flotante del widget se ve y abre el panel de chat, y una petición real
a `POST /chatbot/message` **desde el origen `https://ecofarma.co`** (no localhost) respondió
`201` con una respuesta real de Gemini -- confirma también que el CORS abierto del backend
funciona correctamente cross-origin.

---

## 3. WooCommerce es la fuente PRIMARIA de búsqueda, precio y disponibilidad

**Cambio de arquitectura 2026-08-09, pedido explícito del usuario:** hasta acá el chatbot
buscaba primero en el catálogo interno de EcoFarma (`Product`/`ProductStock`, alimentado por
Distrimonaco, ~7,000 productos) y solo cruzaba WooCommerce como verificación secundaria de
si el producto seguía disponible en línea. Eso se invirtió: **la búsqueda por nombre ahora
consulta primero WooCommerce** (`WoocommerceCatalogItem`, ~42,000 productos -- el catálogo
real y completo de la tienda), y Distrimonaco pasó a ser un enriquecimiento secundario.

- **Nombre, precio, imagen, disponibilidad ("¿se puede comprar ahora?")**: siempre de
  WooCommerce. El precio (`price` en `WoocommerceCatalogItem`, columna nueva) es el que sube
  el snippet de disponibilidad vía `get_price()` de WooCommerce -- el precio efectivo, con
  oferta aplicada si la hay, igual al que ve el cliente en la tienda.
- **Stock físico por sucursal, si requiere receta, alternativas por principio activo**: solo
  si ese mismo SKU *también* existe, activo, en el catálogo interno de Distrimonaco -- son
  datos que WooCommerce no tiene. Si no hay esa segunda fila, el chatbot lo dice con
  claridad (`requiresPrescription: null` → "confirma si requiere receta médica") en vez de
  asumir que no aplica.

**`canOrder` es informativo, no gatekeeper (desde 2026-08-09, 2da vuelta):** al principio,
`canOrder: false` (sin cruce con Distrimonaco) bloqueaba "agregar" y el widget ofrecía solo
el link a la tienda -- porque el carrito propio del chat (`ChatCartService`, eliminado)
armaba cada solicitud contra el catálogo interno, y el personal solo podía despachar de ahí.
Con el carrito **nativo** de WooCommerce (sección 8), esa limitación desaparece: cualquier
producto con `id` de WooCommerce se puede agregar al carrito real, tenga o no contraparte en
Distrimonaco. `canOrder` se queda solo para decidir si mostrar stock físico por
sucursal/receta/alternativas (datos que sí dependen de ese cruce).

`ChatbotService.gatherFacts()` hace, en orden:
1. `WoocommerceCatalogService.searchByTerms()` -- búsqueda primaria, multi-término (con
   expansión de sinónimos/categoría, igual que antes), un solo `findMany`.
2. Por cada resultado, un cruce por SKU exacto contra Distrimonaco
   (`InventoryService.findBySku`) para completar lo que WooCommerce no tiene.
3. Si hace falta mostrar alternativas, un solo lote (`WoocommerceCatalogService.findBySkus`)
   completa precio/estado de WooCommerce de TODAS las alternativas a la vez -- mismo
   principio de nunca mezclar el precio de Distrimonaco con el de WooCommerce para un mismo
   producto.

**Frescura del precio:** el snippet de disponibilidad sube el catálogo completo (con precio)
**una vez al día**, de madrugada -- un cambio de precio puro (sin afectar stock/visibilidad)
puede tardar hasta 24h en reflejarse. Si el producto entra/sale de stock o se oculta, se
refresca en minutos igual que siempre (las tareas de 15/5 min ya re-suben el estado real, y
ahora también el precio). Consecuencia aceptada, documentada -- si hace falta más frescura,
es cambiar el intervalo de un `wp_schedule_event`.

---

## 4. Modelo y API key configurables desde el panel

El chatbot (y el resto del pipeline de IA -- reescritura, scoring, etc.) usa un solo
proveedor: Gemini. Antes, el modelo y la API key estaban fijos en las variables de entorno
`GEMINI_MODEL`/`GEMINI_API_KEY` de Render. Ahora son configurables desde
`Chatbot` → "Configuración del modelo de IA" en el panel (`GET`/`PATCH /ai-settings`, PATCH
solo ADMIN):

- Sin nada configurado desde el panel, el comportamiento es idéntico al de antes (usa las
  variables de entorno).
- La API key nunca se guarda en texto plano (cifrada con AES-256-GCM, clave derivada de
  `JWT_SECRET`) ni se expone completa por la API -- solo se muestra si hay una guardada y sus
  últimos 4 caracteres.
- Un cambio desde el panel tiene efecto inmediato en la siguiente llamada a Gemini, sin
  reiniciar el backend.

La **personalidad/tono** del chatbot no se configura aquí -- sigue siendo el prompt
`CHAT_REPLY_COMPOSITION`, editable en `Guía` → "Prompts y reglas de IA" (decisión explícita:
no se creó un campo de "personalidad" separado, se reutiliza lo que ya existía).

---

## 5. Cómo probarlo

```bash
curl -s -X POST https://diario.ecofarma.co/chatbot/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"tienen acetaminofen disponible?"}'
```

Una vez pegado el snippet en WordPress, abrir cualquier página de ecofarma.co y confirmar que
el botón flotante del chatbot aparece encima del carrito de WooCommerce (si lo hay) y que una
conversación de prueba responde con datos reales.

---

## 6. Estado final validado (2026-08-09) -- dos incidentes reales al desplegar

Todo lo de arriba **ya está en producción y confirmado funcionando de punta a punta**, no es
un plan. Prueba real: el usuario preguntó `"Necesito NOFERTYL"` (SKU 7702870002636 -- un
producto que estaba oculto/agotado en WooCommerce y **no existe en Distrimonaco**, el caso
exacto que este cambio de arquitectura buscaba resolver) y el chatbot respondió con nombre,
precio real de WooCommerce ($11.880), `canOrder: false` y hasta encontró una segunda
presentación del mismo producto. Al desplegar salieron dos incidentes reales, documentados
para no repetirlos:

### 6.1 Se sobreescribió la API key real de producción con el placeholder del repo

Al editar el snippet de disponibilidad (`post_id=338454`) para agregar el campo `price`, se
reemplazó **todo** `post_content` con el contenido de la copia local del repo
(`docs/wpcode-inventario-disponibilidad.php`). Esa copia local **siempre** tiene
`define('ECOFARMA_DISPONIBILIDAD_API_KEY', '<INTEGRATION_API_KEY>')` -- el placeholder, nunca
el valor real, a propósito (ver el comentario del propio archivo: "nunca commitear el valor
real en este repo"). La única copia con el valor real vivía exclusivamente en WPCode de
producción, y se perdió al sobreescribir el post completo.

**Síntoma:** las tres tareas del snippet (reportar, aplicar pendientes, subir catálogo)
empezaron a fallar con `401 Unauthorized: X-API-Key invalida o ausente` -- confirmado
reproduciendo a mano, vía Novamira, exactamente la misma llamada `wp_remote_post` que hace
`ecofarma_disponibilidad_subir_tanda()`, en vez de asumir la causa.

**Fix aplicado:** el usuario recuperó el valor real desde Render (Environment →
`INTEGRATION_API_KEY`) y se reemplazó **solo esa línea** con `str_replace()` sobre el
`post_content` actual (no todo el archivo), confirmando el reemplazo (`$count === 1`) antes
de guardar. Se probó primero con un valor que el usuario pegó por error (no correspondía a
esta variable) -- se detectó porque la misma prueba de `wp_remote_post` seguía devolviendo
`401`, nunca se asumió que "ya debería funcionar".

**Regla para la próxima vez que haya que editar este snippet en producción:** si el cambio no
toca la clave, editar **solo la función/línea específica** sobre el `post_content` que ya está
en WPCode (leído en vivo), nunca reemplazar el post completo con la copia local del repo --
esa copia siempre tiene el placeholder de la clave por diseño.

### 6.2 El código nuevo del backend no estaba desplegado cuando se editó el snippet

Justo después de arreglar la clave, la prueba de subida (un solo producto) devolvió
`400 Bad Request: "items.0.property price should not exist"`. Causa: el cambio de
"WooCommerce como fuente primaria + columna `price`" (`CatalogItemDto`,
`WoocommerceCatalogItem`, `ChatbotService`, etc.) todavía estaba sin commitear localmente --
el `ValidationPipe` del backend (`forbidNonWhitelisted: true`, ver `src/main.ts`) rechaza
cualquier campo que el DTO desplegado no conozca. El snippet de WordPress ya estaba enviando
`price`, pero el backend en Render seguía corriendo el código viejo.

**Fix:** commit + push manual a `main` (en vez de esperar al pipeline automático de este
repo, dado que el usuario estaba probando en vivo) -- Render redesplegó en ~1-2 minutos,
confirmado con un polling simple contra `POST /chatbot/message` esperando a que la respuesta
incluyera el campo `canOrder` (señal inequívoca del código nuevo).

**Lección:** al desplegar un cambio que toca **ambos lados** de esta integración (snippet de
WordPress + backend), el orden importa -- verificar que el backend ya esté en producción
*antes* de asumir que un snippet de WordPress recién editado va a funcionar, no después de
que falle.

---

## 7. UX del widget: carrusel horizontal + saludo estructurado (2026-08-09)

El usuario compartió capturas de un chatbot de referencia ("Sommer", de la app de Farmatodo)
pidiendo entender su lógica -- no copiar sus estilos, que siguen siendo los de EcoFarma.
Decisiones explícitas tomadas sobre esa referencia:

- **Sí**: resultados de productos siempre en un carrusel horizontal deslizable (antes:
  tarjetas para 1-2, tabla para 3+), y un saludo inicial estructurado en viñetas de lo que
  el asistente puede hacer.
- **No, por ahora**: escalar a un humano (el botón "Hablar con un farmacéutico" ya existe en
  el menú pero sigue deshabilitado, decisión previa del 2026-07-29) y un gate de
  consentimiento de datos (el chat sigue siendo completamente anónimo, sin login).

Cambios en `public/widget/chatbot.js`: `ensureGreeting()` con lista de capacidades +
disclaimer ("puedo cometer errores"); `renderProductsCards`/`renderProductsTable` se
fusionaron en una sola `renderProductsCarousel()`, usada siempre. Mismo tratamiento en
`public/sections/chatbot-test.html` (consola interna).

### 7.1 Dos bugs de CSS reales encontrados en producción, ninguno visible en el código

Ambos pasaron los tres commits+push+redeploy sin ningún error de build ni de consola --
silenciosos hasta que se inspeccionó el CSSOM real con `getComputedStyle`/
`getBoundingClientRect` en producción.

**Bug 1 -- comentario `///` inválido en CSS.** Este repo usa `///` como convención de
comentario de documentación en TypeScript (ver casi cualquier archivo de `src/`). Se usó por
costumbre dentro del string `STYLES` (CSS puro) de `chatbot.js`. `//` no es un comentario
válido en CSS -- el parser del navegador lo trata como un error de sintaxis y, según el
navegador, puede descartar en silencio la regla completa que sigue. Confirmado inspeccionando
`shadowRoot.styleSheets[0].cssRules`: la regla `.products-carousel` nunca apareció en el
CSSOM pese a estar, textualmente, en el `<style>` -- 59 reglas se parsearon bien, esa una se
perdió sin ningún error en consola. Fix: `/* ... */`, el único comentario válido en CSS.
**Lección: nunca usar `///` dentro de un template literal de CSS, ni siquiera por hábito.**

**Bug 2 -- el carrusel se aplastaba a ~2px con historial largo.** `overflow-x: auto` en
`.products-carousel` (necesario para el scroll horizontal) hace que el navegador calcule
también `overflow-y: auto` -- regla real de CSS: si un eje es `visible` y el otro no, el
`visible` pasa a `auto` también. Eso activa un caso especial de flexbox: `min-height: auto`
se vuelve `min-height: 0` para cualquier item cuyo `overflow` no sea `visible`. Como
`.messages` es `flex-direction: column` con una altura definida (`flex: 1` dentro del panel),
en cuanto el historial de la conversación excede esa altura visible, el algoritmo de
`flex-shrink` aplasta primero a los items con `min-height` efectivo `0` -- el carrusel,
nunca los globos de texto normales (que sí conservan `min-height: auto` real porque su
`overflow` es `visible`). Confirmado con `getBoundingClientRect()` real en producción:
altura de la tarjeta 2px pese a que sus hijos (imagen 96px + cuerpo ~105px) reportaban su
alto real por separado. Fix: `flex-shrink: 0` explícito en `.products-carousel`. Validado de
nuevo en producción simulando 4 preguntas seguidas (`scrollHeight` de `.messages`: 2084px vs.
`clientHeight`: 438px, la misma condición de desborde que causaba el bug) -- la tarjeta quedó
en 337px, su alto de contenido real.

---

## 8. Carrito nativo de WooCommerce + vista de detalle + conversación persistente (2026-08-09, 2da vuelta)

El usuario volvió a compartir la referencia de Farmatodo ("Sommer") con un pedido concreto:
que "Agregar producto" en la vista de detalle agregue de verdad al **carrito de la tienda**
(no a una solicitud interna que el personal confirma a mano), y que se quite por completo la
función de Pedidos -- ya no hace falta ese paso manual. En el mismo mensaje, pidió además que
recargar el navegador no borre visualmente la conversación.

### 8.1 Se eliminó el carrito propio del chat (Pedidos / `OrderRequest`)

Confirmado explícitamente por el usuario antes de borrar: la pestaña "Pedidos" del panel
llevaba desde el 2026-08-02 sin botón de acceso en el menú (quedó huérfana al reorganizar el
sidebar) y **nunca se gestionó una solicitud real** por ahí -- se pudo eliminar sin
necesidad de respaldo.

Se borraron por completo: las tablas `order_requests`/`order_request_items` (migración
`remove_order_requests`), `src/orders/`, `src/chatbot/chat-cart.service.ts`,
`src/chatbot/cart.controller.ts` y sus DTOs, la pestaña "Pedidos" del panel
(`public/sections/pedidos.html` y el estado/métodos `orders*` en `public/index.html`), y en
el widget todo el bloque de `.cart-bar`/`renderCartBar`/`refreshCart`/`addToCart` (el viejo,
contra `/chatbot/cart/items`)/`submitCart`/`checkOrderStatus`/`renderReferenceForm` y la
opción de menú "Ver el estado de mi solicitud".

`InventoryService.findBySku` **no se tocó** -- lo sigue usando `ChatbotService.gatherFacts()`
para el cruce con Distrimonaco (stock físico, receta, alternativas), que no depende del
carrito.

### 8.2 Carrito nativo de WooCommerce -- mecanismo verificado en vivo

El tema de ecofarma.co ya carga el script core de WooCommerce (`window.wc_add_to_cart_params`
existe) y usa el patrón estándar de botón AJAX:
`<a class="ajax_add_to_cart add_to_cart_button" data-product_id="X" data-quantity="1"
href="?add-to-cart=X">`. Se verificó en vivo, sin dejar cambios permanentes, que:

- Un `<a>` con esas mismas clases/atributos, creado **dinámicamente** por JS (nunca antes en
  la página) y con un `.click()` disparado a mano, **sí activa el flujo AJAX nativo** -- la
  delegación de eventos de WooCommerce no depende de que el elemento ya estuviera en el DOM.
  Confirmado con la clase pasando a `...ajax_add_to_cart added`, `.xoo-wsc-items-count` (badge
  del carrito lateral del tema) subiendo a 1, y el producto apareciendo de verdad en
  `/carrito/` (`get_page_text` mostró el nombre real y el precio real del producto).
- `window.jQuery` existe y el evento estándar `added_to_cart` se dispara en `document.body`
  con los fragments reales -- es la señal confiable para saber que terminó, más robusta que
  un timeout a ciegas (el widget igual mantiene un timeout corto de respaldo, 1.5s, por si
  jQuery no cargó todavía).
- `/carrito/` usa el Cart Block moderno de WooCommerce (React, Store API) -- el botón de
  quitar es `.wc-block-cart-item__remove-link`, no el clásico `a.remove[href*="remove_item"]`.
- Como esto corre en el navegador del **cliente** (no en nuestro backend), no aplica el
  bloqueo de Cloudflare que sí afecta el tráfico backend→WordPress documentado en
  `docs/integracion-inventario-wordpress.md` -- es tráfico normal del navegador al mismo
  sitio.

Implementación (`addToWooCommerceCart` en `public/widget/chatbot.js`): crea el `<a>` dinámico
con `data-product_id` = el `id` numérico de WooCommerce que ahora trae cada producto en la
respuesta de `/chatbot/message` (`ChatbotService.gatherFacts`, ver sección 1), le hace
`.click()`, y escucha `added_to_cart` (con el timeout de respaldo) para mostrar "Agregado al
carrito ✓" en el botón. Si `window.wc_add_to_cart_params` no existe (nunca debería pasar en
ecofarma.co real -- es solo defensivo, y es el caso siempre en la consola de prueba interna
del panel, que vive en nuestro propio dominio), cae a abrir `permalink` en pestaña nueva.

**Verificado en producción tras el despliegue (2026-08-09):** con un producto realmente en
stock en WooCommerce, "Agregar producto" agregó de verdad al carrito real sin salir del
widget (`.xoo-wsc-basket` y `/carrito/` lo confirmaron, limpiado después). **Comportamiento
observado con productos agotados en WooCommerce (esperado, no es un bug de esta
integración):** si el producto está agotado *en WooCommerce* (no en Distrimonaco -- son
sistemas de stock independientes, ver sección 3), el propio JS core de WooCommerce
(`add-to-cart.min.js`) responde al POST con `{error: true, product_url: "..."}` y hace
`window.location = product_url` -- el cliente sale del widget y aterriza en la página del
producto (que sí muestra "AGOTADO" con claridad). Es el mismo comportamiento que tendría
CUALQUIER botón "Añadir al carrito" nativo del sitio con ese producto, no algo específico de
nuestro `<a>` dinámico. Al probar esto se encontró además que **el catálogo de WooCommerce
tiene entradas duplicadas para el mismo nombre de producto** (una real con stock/precio
correcto, otra obsoleta con precio placeholder `9999999`) -- el buscador del chatbot, al ser
por similitud de texto, a veces encuentra la duplicada. Es un problema de calidad de datos
del catálogo sincronizado, no de esta feature; queda anotado para una futura limpieza de
`WoocommerceCatalogItem` (deduplicar por nombre o preferir el registro con precio real).

### 8.3 Vista de detalle ("Ver producto")

El pequeño bloque de detalle que se expandía dentro de la tarjeta del carrusel (iteración
anterior, sección 7) se reemplazó por un **overlay a pantalla completa** dentro del panel del
widget (imagen grande, nombre, laboratorio, precio, aviso de receta si aplica, botón ancho
completo "Agregar producto", link secundario "Ver en la tienda", botón × para cerrar) --
mismo espíritu visual que la referencia de Farmatodo. Mismo overlay replicado en
`public/sections/chatbot-test.html` para QA visual, aunque ahí "Agregar producto" siempre cae
al fallback de abrir la tienda (esa consola nunca está dentro de una página de WordPress).

### 8.4 Conversación persistente entre recargas

Antes, solo `conversationId` se guardaba en `localStorage` (`ecofarma_chat_conversation_id`)
-- el backend conservaba el historial, pero un F5 vaciaba visualmente el chat porque los
mensajes/carruseles ya renderizados no se guardaban en ningún lado. Se agregó una segunda
clave, `ecofarma_chat_history`, con el arreglo de turnos reales de la conversación (eco del
usuario, respuesta del bot, carruseles de productos), capado a los últimos 30. Al abrir el
widget: si hay `conversationId` **y** hay historial guardado, se reconstruye la UI llamando a
los mismos renderers (`appendMessage`/`renderProductsCarousel`) por cada entrada guardada, en
vez de mostrar el saludo + menú inicial. Si `localStorage` está bloqueado (modo privado) o no
hay historial, cae al comportamiento de siempre (saludo nuevo) -- mismo manejo defensivo
try/catch que ya existía para `conversationId`. El saludo/menú inicial y los mensajes de
error/"escribiendo..." **no** se persisten a propósito (solo los turnos reales).
