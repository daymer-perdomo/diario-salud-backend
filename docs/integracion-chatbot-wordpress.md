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

**Estado (2026-08-09): preparado, todavía sin pegar en WPCode de producción, sin
`snippet_id`.** Antes de pegarlo: validar sintaxis (`php -l`, no disponible en este entorno de
desarrollo -- validar donde sí haya PHP antes de guardar en WPCode) y, tras guardarlo,
confirmar que el sitio responde 200 y que el snippet realmente quedó "Activo" contra el
listado real de fragmentos (ver sección 10 de
`docs/integracion-wordpress-diario-salud.md` sobre falsos negativos con WPCode).

---

## 3. El chatbot ahora conoce WooCommerce, no solo Distrimonaco

Antes de esto, `ChatbotService` solo consultaba `InventoryService` (catálogo `Product`/
`ProductStock`, sincronizado desde Distrimonaco -- ver `DistrimonacoSyncService`). Eso es
stock **físico**, no necesariamente lo que se puede comprar en línea: un producto puede
tener existencia real en sucursal y a la vez estar oculto/agotado en la tienda WooCommerce
(marcado así desde el panel, ver `docs/integracion-inventario-wordpress.md`, o directo en
`wp-admin`).

`ChatbotService.gatherFacts()` ahora cruza por SKU cada producto encontrado contra
`WoocommerceCatalogItem` -- la misma copia local que sube el snippet de disponibilidad cada
15 minutos (`docs/wpcode-inventario-disponibilidad.php`, tarea
`ecofarma_evento_reportar_disponibilidad`). Un solo `findMany` por lote, nunca una consulta
por producto (`WoocommerceCatalogService.findAvailabilityBySkus`).

Cada producto en la respuesta del chatbot puede traer un campo `onlineStore`:

```json
{
  "sku": "7702870002636",
  "stockByBranch": [{ "branch": "PRINCIPAL", "quantity": 12, "price": 45000 }],
  "onlineStore": { "visibleOnline": false, "inStockOnline": false }
}
```

- Si el SKU todavía no está en la copia local de WooCommerce (el snippet de disponibilidad
  no lo ha subido -- puede ser normal si nunca estuvo agotado/oculto, ver la nota "solo sube
  lo que está agotado/oculto" en `docs/integracion-inventario-wordpress.md` sección 3.1),
  el campo simplemente no aparece. El chatbot nunca inventa este dato.
- El prompt `CHAT_REPLY_COMPOSITION` (editable en `Guía` → "Prompts y reglas de IA") ya sabe
  interpretar este campo: si hay stock físico pero `visibleOnline`/`inStockOnline` es
  `false`, la respuesta lo aclara explícitamente en vez de decir sin más que "está
  disponible".

No requiere ningún cambio adicional del lado de WordPress -- reutiliza exactamente los
mismos datos que ya sube el snippet de disponibilidad.

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
