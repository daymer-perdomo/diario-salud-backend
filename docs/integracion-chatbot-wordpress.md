# Integración del chatbot: EcoFarma ↔ WordPress

**Para:** desarrollador de WordPress de ecofarma.co
**Backend:** `https://diario.ecofarma.co`
**Última actualización:** 2026-08-09

---

## 1. Qué es esto

El chatbot de inventario ya está construido en el backend (`src/chatbot/`): un widget
público, sin login, que un cliente usa para preguntar por disponibilidad/precio/sucursal de
un producto y, si quiere, armar una solicitud de pedido (nunca un cobro en línea -- el
personal la confirma manualmente desde `Pedidos`).

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

Habla con dos grupos de endpoints, ambos públicos y sin autenticación (protegidos por rate
limiting, no por login -- es el único caso en todo el backend):
- `POST /chatbot/message` -- el mensaje del cliente y la respuesta del asistente.
- `GET/POST /chatbot/cart/*` -- carrito de la conversación y solicitud de pedido.

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

**Límite real de producto, aceptado a propósito:** el carrito del chatbot
(`ChatCartService.addItem`) arma cada solicitud de pedido contra el catálogo interno de
Distrimonaco, porque el personal despacha desde inventario físico real -- nunca desde
WooCommerce. Con ~42,000 productos en WooCommerce contra ~7,000 en Distrimonaco, la mayoría
de lo que el chatbot ahora puede *mostrar* no se puede agregar al carrito del chat. Para esos
casos (`canOrder: false` en cada producto), el chatbot no ofrece "agregar" -- ofrece el
enlace directo a la página del producto (`permalink`) para comprarlo normal por la tienda en
línea. El widget (`renderProductsCards`/`renderProductsTable` en `public/widget/chatbot.js`)
muestra un link "Ver en la tienda" en ese caso en vez de los controles de cantidad.

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
