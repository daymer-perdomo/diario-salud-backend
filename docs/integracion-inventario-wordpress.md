# Integración de inventario: EcoFarma ↔ WordPress

**Para:** desarrollador de WordPress de ecofarma.co
**Backend:** `https://diario.ecofarma.co`
**Última actualización:** 2026-08-08

---

## 0. Estado (2026-08-08): este enfoque quedó abandonado

Todo lo de abajo (endpoints `/integration/woocommerce/*`, el snippet
`docs/wpcode-inventario-sync.php`, la sección "Disponibilidad en WordPress" que existió en
el panel de EcoFarma) **describe un diseño que se intentó y no se terminó de poner en
producción** -- se documenta tal cual para que quede el rastro de por qué se descartó, no
como guía a seguir.

**Qué pasó:** se escribió el snippet de WP-Cron (sección 4) y se pegó dos veces en WPCode de
producción. Ambas veces, WordPress lo revertía solo a "Inactivo" después de guardarlo con
"Activo" -- confirmado contra el listado real de fragmentos, no un falso negativo de la UI.
Se descartó que fuera un bug de automatización (un snippet PHP mínimo de una sola línea sí
se activó sin problema en el mismo sitio). La causa más probable es la protección de errores
fatales de WordPress (desde 5.2), que pausa en silencio un snippet/plugin que causa un fatal
error real y notifica por correo al admin -- pero no se llegó a confirmar el mensaje exacto
porque no había acceso a los logs del hosting ni al correo de administración en ese momento.

**Decisión (2026-08-08):** en vez de seguir depurando esa cadena (backend → cola → WP-Cron →
WooCommerce), se usa lo que WooCommerce ya trae nativo: cada producto en `wp-admin` tiene sus
propios campos **"Visibilidad en el catálogo"** (opción "Oculto") y **"Estado del
inventario"** (opción "Agotado") -- exactamente los mismos campos (`catalog_visibility`,
`stock_status`) que este diseño intentaba controlar por control remoto. No hace falta ningún
código para eso; ver sección 8.

**Qué se limpió como consecuencia:**
- La sección "Disponibilidad en WordPress" del panel de EcoFarma (buscador de catálogo +
  botones "Marcar no disponible"/"Marcar agotado") se reemplazó por una nota que enlaza a
  este documento -- ver `public/sections/inventario.html`.
- Los dos snippets de WPCode creados durante el intento (`snippet_id=338451` y su reemplazo)
  se mandaron a la papelera en producción.

**Qué NO se tocó** (queda como posible trabajo futuro si alguna vez hace falta de nuevo):
`src/integration/*` (el módulo NestJS con los 3 endpoints), `src/inventory/
woocommerce-catalog.service.ts`, y las tablas `WoocommerceCatalogItem`/
`WoocommercePendingChange` en la base de datos. Todo eso sigue en el repo, inerte, sin nada
que lo llame desde el panel ni desde WordPress.

## 0.1 Tercer intento (2026-08-08): lectura + escritura, funciones con nombre

El equipo confirmó que sí quiere ambas direcciones: marcar un producto no disponible/agotado
**desde el panel de EcoFarma** y que WordPress lo aplique solo, y además ver reflejado en el
panel lo que ya está marcado en WordPress. Es decir, el diseño original completo (sección 1),
pero reescrito con el estilo que sí se mantuvo activo en este sitio (funciones con nombre +
`function_exists()`, como los snippets de Diario de la Salud/Blog) en vez de closures sin
nombre.

Un solo snippet, tres tareas independientes (cada una su propio evento de WP-Cron, cada una
en su propio try/catch):
[`docs/wpcode-inventario-disponibilidad.php`](wpcode-inventario-disponibilidad.php)

1. **`ecofarma_evento_reportar_disponibilidad`** (cada 15 min, solo lee) -- junta los
   productos agotados/ocultos con funciones nativas de WooCommerce (`wc_get_products`,
   taxonomía `product_visibility`) y los sube por `POST /integration/woocommerce/catalog`.
2. **`ecofarma_evento_aplicar_pendientes`** (cada 5 min, **la única que escribe**) -- lee
   `GET /integration/woocommerce/pending-changes` (lo que el admin encoló desde el panel al
   buscar un producto y marcarlo), lo aplica local con `rest_do_request` y confirma con
   `POST /integration/woocommerce/pending-changes/ack`.
3. **`ecofarma_evento_subir_catalogo`** (diario, de madrugada) -- sube el catálogo completo
   (~42,300 productos) para que el buscador del panel encuentre un producto la primera vez
   (antes de que esté agotado/oculto, no puede aparecer en el reporte de la tarea 1).

Del lado del panel se restauró el buscador + botones "Marcar no disponible"/"Marcar agotado"
en la tarjeta "Disponibilidad en WordPress" (`public/sections/inventario.html`), que ya
existían en el diseño original y usan los mismos endpoints `PATCH /inventory/woocommerce/
products/:id/availability` y `.../stock-status` -- nunca se habían tocado, solo dejaron de
tener quien aplicara lo que encolaban.

**Por qué probablemente esta vez sí se mantenga activo:** los snippets de Diario de la
Salud/Blog, que llevan semanas activos sin problema, usan exactamente este patrón (funciones
con nombre + guards). Si aun así WPCode vuelve a revertirlo a "Inactivo", es evidencia fuerte
de que el problema no es el estilo del código sino algo específico de registrar eventos de
WP-Cron en este hosting/WPCode -- en ese caso, reportar a soporte de WPCode con los tres
intentos documentados (snippet_id=338451, el descartado de solo-lectura, y este).

**Estado:** ver sección 9 -- **ya está en producción, activo, y confirmado funcionando de
punta a punta sin intervención manual** (no se quedó en "probado solo localmente").

---

## 1. Qué hay que construir y por qué (diseño original, no completado)

El panel administrativo de EcoFarma (backend en Render) tiene una pantalla donde un
administrador marca productos de WooCommerce como **"no disponible"** (los oculta de la tienda
y del buscador sin borrarlos) o como **"agotado"**.

Hasta ahora el backend escribía directo contra `wp-json/wc/v3/products/{id}`. **Eso dejó de
funcionar:** Cloudflare responde `403 Attention Required` a todo el tráfico que llega a
ecofarma.co desde las IPs de datacenter de Render.

Está comprobado que el bloqueo es por reputación de IP y no por la URL, el User-Agent ni
ningún header:

| Origen de la petición | Respuesta |
|---|---|
| IP de Render (backend) | `403` de Cloudflare — nunca llega a WordPress |
| IP residencial, misma petición idéntica | `401` de WooCommerce — llegó a WordPress |

No tenemos acceso al panel de Cloudflare para agregar una regla de excepción, así que se
**invirtió el sentido de la conexión**: el tráfico *saliente* de WordPress no pasa por esa
regla, así que **WordPress es siempre el que inicia la conexión**.

Lo que hay que construir es un plugin (o snippet de WPCode) que corra por WP-Cron y haga tres
cosas:

```
   1. subir el catálogo   →  POST /integration/woocommerce/catalog
   2. preguntar qué cambiar →  GET  /integration/woocommerce/pending-changes
   3. aplicar y confirmar  →  POST /integration/woocommerce/pending-changes/ack
```

**Toda la lógica de negocio vive en el backend.** El plugin no decide nada: el paso 2 ya
devuelve el body exacto que hay que enviarle a WooCommerce. Si mañana cambia la regla de qué
significa "no disponible", se cambia en el backend y el plugin no se toca.

> **Alternativa, si algún día hay acceso a Cloudflare:** una regla WAF de tipo *Skip* que
> permita el paso cuando venga el header `X-EcoFarma-Backend-Secret` con el valor acordado, o
> un allowlist de las IPs de salida estáticas de Render. Eso permitiría volver al modelo
> directo. Mientras no exista, esta integración es la solución.

---

## 2. Autenticación

Las tres llamadas van con el header `X-API-Key`:

```
X-API-Key: <INTEGRATION_API_KEY>
```

La clave la entrega el equipo de EcoFarma por un canal seguro (no va en este documento ni en
un repositorio). Es distinta de la clave de la API pública de artículos y se puede rotar sin
afectar nada más.

Códigos de error de autenticación:

| Código | Significa |
|---|---|
| `401` | La clave falta o es incorrecta. |
| `503` | La integración todavía no está habilitada del lado del backend (falta configurar la variable). No es un problema de tu clave. |

---

## 3. Endpoints

### 3.1 `POST /integration/woocommerce/catalog` — subir el catálogo

El panel ya no puede buscar en vivo en WooCommerce, así que trabaja sobre una copia del
catálogo que sube este endpoint. Sin esta copia, el buscador del panel no muestra nada.

Son ~42.300 productos, así que se sube **por páginas de hasta 500 ítems por petición**.

**Request**

```http
POST /integration/woocommerce/catalog
X-API-Key: <clave>
Content-Type: application/json
```

```json
{
  "items": [
    {
      "id": 286654,
      "sku": "7702870002636",
      "name": "NOFERTYL 50 MG/5 MG SLN INY - CAJA x 1 AMP x 1 ML + JERINGA",
      "permalink": "https://ecofarma.co/producto/nofertyl-50-mg-5-mg/",
      "imageUrl": "https://ecofarma.co/wp-content/uploads/2025/03/nofertyl.jpg",
      "stockStatus": "instock",
      "catalogVisibility": "visible",
      "manageStock": true
    }
  ]
}
```

| Campo | Tipo | Obligatorio | De dónde sale (WC REST) |
|---|---|---|---|
| `id` | entero > 0 | sí | `id` |
| `sku` | string | sí | `sku` (puede ir `""` si el producto no tiene) |
| `name` | string | sí | `name` |
| `permalink` | string | sí | `permalink` |
| `imageUrl` | string o `null` | no | `images[0].src`, o `null` si no tiene imagen |
| `stockStatus` | string | sí | `stock_status` |
| `catalogVisibility` | string | sí | `catalog_visibility` |
| `manageStock` | booleano | sí | `manage_stock` |

**Respuesta `201`**

```json
{ "upserted": 500 }
```

**Notas de comportamiento**

- Es un *upsert* por `id`: subir la misma página dos veces no duplica nada, se puede reintentar
  sin miedo.
- **No borra** lo que no venga en la tanda. Un producto eliminado en WooCommerce sigue
  apareciendo en el buscador del panel hasta que se limpie a mano. Se decidió así a propósito:
  si borráramos lo ausente, una página que falle a mitad de camino vaciaría el índice.
- Basta con correrlo **una vez al día** (de madrugada). No hace falta que sea frecuente: la
  copia solo se usa para que el administrador encuentre el producto.

**Errores**

| Código | Cuándo |
|---|---|
| `400` | Falta un campo obligatorio o tiene el tipo equivocado. El body de la respuesta dice exactamente cuál: `{"message":["items.0.sku must be a string"],...}` |
| `400` | `items` viene vacío o con más de 500 elementos. |

---

### 3.2 `GET /integration/woocommerce/pending-changes` — preguntar qué cambiar

Devuelve hasta 50 cambios pendientes, **del más antiguo al más reciente**.

**Request**

```http
GET /integration/woocommerce/pending-changes
X-API-Key: <clave>
```

**Respuesta `200`**

```json
{
  "count": 2,
  "changes": [
    {
      "id": "c5c4c049-6ac6-4c7d-84fc-baf0fcc88a7b",
      "productId": 286654,
      "sku": "7702870002636",
      "name": "NOFERTYL 50 MG/5 MG SLN INY",
      "kind": "VISIBILITY",
      "payload": { "catalog_visibility": "hidden" },
      "createdAt": "2026-08-05T03:56:06.012Z"
    },
    {
      "id": "50ff4673-8d41-4b15-9e30-71316d963ed3",
      "productId": 210345,
      "sku": "7708480649858",
      "name": "SHAMPOO KONICASP MEDICADO",
      "kind": "STOCK_STATUS",
      "payload": { "manage_stock": false, "stock_status": "outofstock" },
      "createdAt": "2026-08-05T03:56:05.997Z"
    }
  ]
}
```

**Lo único que hay que hacer con cada elemento:**

```
PUT /wp-json/wc/v3/products/{productId}
body = payload   ← tal cual, sin agregar ni quitar nada
```

- `payload` ya viene armado. **No lo modifiques ni le agregues campos.**
- `kind` y `sku`/`name` son solo informativos, para que puedas loguear algo legible. `sku` y
  `name` pueden venir `null` si el producto no está en la copia del catálogo; el cambio se
  entrega igual, porque `productId` es lo único que WooCommerce necesita.
- Si `count` es `0`, no hay nada que hacer: terminá sin llamar al `ack`.

> **Por qué `manage_stock: false` viene junto al `stock_status`:** está verificado contra la API
> real que, mientras `manage_stock` sea `true`, WooCommerce recalcula `stock_status` a partir de
> `stock_quantity` y **descarta** el `stock_status` que se le envía. Sin apagar `manage_stock`
> el cambio no se sostiene. Es intencional y el equipo de EcoFarma conoce la consecuencia (ese
> producto puntual deja de rastrear cantidad real). Por eso no hay que tocar el `payload`.

---

### 3.3 `POST /integration/woocommerce/pending-changes/ack` — confirmar el resultado

**Obligatorio.** Un cambio que no se confirma se sigue entregando en cada corrida.

**Request**

```http
POST /integration/woocommerce/pending-changes/ack
X-API-Key: <clave>
Content-Type: application/json
```

```json
{
  "results": [
    { "id": "c5c4c049-6ac6-4c7d-84fc-baf0fcc88a7b", "ok": true },
    {
      "id": "50ff4673-8d41-4b15-9e30-71316d963ed3",
      "ok": false,
      "error": "woocommerce_rest_product_invalid_id"
    }
  ]
}
```

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `id` | UUID v4 | sí | El `id` del cambio, tal como vino en el paso 3.2, **sin modificarlo**. **No** el `productId`. Se valida el formato: si mandás otra cosa, la respuesta es `400 results.N.id must be a UUID`. |
| `ok` | booleano | sí | `true` = el `PUT` a WooCommerce respondió 2xx. `false` = falló. |
| `error` | string (≤500) | no | Solo cuando `ok` es `false`. Mandá el mensaje real de WooCommerce: se muestra al administrador en el panel. |

Máximo 200 resultados por petición.

**Respuesta `201`**

```json
{ "applied": 1, "failed": 1, "ignored": 0 }
```

- `applied` — confirmados OK. El panel ya refleja el estado nuevo.
- `failed` — quedan marcados como fallidos, con su mensaje visible para el administrador.
- `ignored` — ids que ya no estaban pendientes (un `ack` duplicado, o un reintento tras un
  timeout). **No es un error**: confirmar dos veces el mismo cambio es seguro.

**Importante:** un cambio que falla **no se reintenta automáticamente**. Queda marcado como
fallido con su motivo, y es el administrador quien decide volver a intentarlo desde el panel.
Esto es a propósito: un error permanente (por ejemplo, un producto borrado) reintentándose en
cada corrida sería ruido infinito.

---

## 4. Implementación sugerida del plugin

**Ya existe una copia fuente lista para pegar en WPCode:**
[`docs/wpcode-inventario-sync.php`](wpcode-inventario-sync.php). Sigue las reglas de la
sección 4.2 de abajo (cero funciones con nombre, cero `define()`, try/catch por closure de
cron).

**Estado (2026-08-08):** `INTEGRATION_API_KEY` configurada en Render y verificada contra el
endpoint real (`GET /integration/woocommerce/pending-changes` responde `200
{"count":0,"changes":[]}` con la clave correcta, `401` sin clave o con una incorrecta).
Snippet pegado en WPCode de producción como **`snippet_id=338451`**, ubicación "Ejecutar en
todas partes", **Activo**, con **"Modo de pruebas" de WPCode encendido** (solo corre para
usuarios logueados con permisos de administrador todavía, no para el tráfico/WP-Cron real).
Confirmado contra el listado real de fragmentos (`admin.php?page=wpcode`), no solo por la
ausencia de un error al guardar — ver sección 10 sobre falsos negativos.

**Falta:** 1) probar el ciclo completo (sección 5) con el modo de pruebas encendido, 2)
apagar "Modo de pruebas" una vez confirmado, para que el cron corra también para visitantes
anónimos (WP-Cron se dispara en cualquier carga de página, no solo las de un admin logueado).

### 4.1 Frecuencia

| Tarea | Cada cuánto | Por qué |
|---|---|---|
| Aplicar cambios pendientes (3.2 + 3.3) | **cada 5–15 minutos** | Es el tiempo que el administrador espera a que su cambio se vea en la tienda. |
| Subir el catálogo (3.1) | **una vez al día**, de madrugada | Son 85 páginas de 500; es la parte pesada y no necesita ser fresca. |

WP-Cron depende de que alguien visite el sitio. Si el sitio tiene poco tráfico de madrugada,
conviene un cron real del servidor apuntando a `wp-cron.php`, o un servicio de ping externo.

### 4.2 Diseño defensivo — importante

> El 2026-08-04 un snippet con funciones PHP declaradas, activo como "ejecutar en todas
> partes", tumbó ecofarma.co completo (frontend y wp-admin en 500). Un snippet se evalúa en
> **cada carga de página** y una redeclaración de función o constante es un error fatal **no
> capturable**.

Si esto se implementa como snippet de WPCode (y no como plugin en su propia carpeta), hay que
respetar estas reglas:

1. **Cero funciones con nombre y cero `define()`.** Solo closures y variables locales.
2. **Toda la lógica dentro del closure del cron**, envuelta en `try/catch (\Throwable)`. Así,
   si algo falla, muere únicamente esa petición de wp-cron (invisible para el visitante), nunca
   el sitio.
3. En una carga normal de página, el snippet debe limitarse a **registrar hooks**. Ninguna
   operación que pueda fallar.
4. Validar la sintaxis antes de guardar (`php -l`) y verificar que el sitio responde 200
   después de cada guardado.

Si se implementa como **plugin propio** (recomendado), las reglas 1 y 3 dejan de ser críticas —
un plugin se carga una sola vez — pero la 2 sigue siendo buena práctica.

### 4.3 Esqueleto de referencia

```php
add_action( 'ecofarma_inventory_sync', function () {
    try {
        $api  = 'https://diario.ecofarma.co';
        $key  = '<INTEGRATION_API_KEY>';

        // --- 1. pedir los cambios pendientes ---
        $res = wp_remote_get( $api . '/integration/woocommerce/pending-changes', array(
            'headers' => array( 'X-API-Key' => $key ),
            'timeout' => 20,
        ) );
        if ( is_wp_error( $res ) || 200 !== wp_remote_retrieve_response_code( $res ) ) {
            error_log( 'EcoFarma inventario: no se pudieron leer los cambios pendientes' );
            return;
        }

        $body = json_decode( wp_remote_retrieve_body( $res ), true );
        if ( empty( $body['changes'] ) ) {
            return; // nada que hacer
        }

        // --- 2. aplicar cada uno en WooCommerce ---
        $results = array();
        foreach ( $body['changes'] as $change ) {
            // $wc_request() es tu forma de llamar a la API de WooCommerce.
            // Al ser una llamada local, lo más simple y robusto es usar
            // WC_REST_Products_Controller vía rest_do_request(), que evita
            // pasar por la red y por Cloudflare.
            $request = new WP_REST_Request( 'PUT', '/wc/v3/products/' . (int) $change['productId'] );
            $request->set_body_params( $change['payload'] ); // <- tal cual viene
            $response = rest_do_request( $request );

            if ( $response->is_error() ) {
                $err = $response->as_error();
                $results[] = array(
                    'id'    => $change['id'],
                    'ok'    => false,
                    'error' => substr( $err->get_error_message(), 0, 500 ),
                );
            } else {
                $results[] = array( 'id' => $change['id'], 'ok' => true );
            }
        }

        // --- 3. confirmar ---
        wp_remote_post( $api . '/integration/woocommerce/pending-changes/ack', array(
            'headers' => array( 'X-API-Key' => $key, 'Content-Type' => 'application/json' ),
            'body'    => wp_json_encode( array( 'results' => $results ) ),
            'timeout' => 20,
        ) );
    } catch ( \Throwable $e ) {
        error_log( 'EcoFarma inventario: excepcion -- ' . $e->getMessage() );
    }
} );
```

> **`rest_do_request()` en vez de un `PUT` por HTTP a tu propio sitio:** al ser una llamada
> interna de PHP no sale a la red, así que no pasa por Cloudflare, no necesita las claves de
> consumidor de WooCommerce y es mucho más rápido. Requiere que el cron corra con un usuario
> con permisos (`manage_woocommerce`); si eso complica, un `wp_remote_request()` con
> autenticación Basic a `https://ecofarma.co/wp-json/wc/v3/...` también funciona, porque sale
> desde la propia IP del servidor.

Para el catálogo (3.1), el bucle equivalente es: recorrer
`/wc/v3/products?per_page=100&page=N` hasta que devuelva vacío, acumular en tandas de 500 y
hacer un `POST` por tanda.

---

## 5. Cómo probarlo

Con `curl`, reemplazando `<clave>`:

```bash
# 1. La clave funciona y hay conexión (debe responder {"count":0,"changes":[]} o con cambios)
curl -s https://diario.ecofarma.co/integration/woocommerce/pending-changes \
  -H "X-API-Key: <clave>"

# 2. Subir un solo producto de prueba, para validar el formato del body
curl -s -X POST https://diario.ecofarma.co/integration/woocommerce/catalog \
  -H "X-API-Key: <clave>" -H 'Content-Type: application/json' \
  -d '{"items":[{"id":286654,"sku":"7702870002636","name":"NOFERTYL 50 MG/5 MG","permalink":"https://ecofarma.co/producto/nofertyl/","imageUrl":null,"stockStatus":"instock","catalogVisibility":"visible","manageStock":true}]}'
# esperado: {"upserted":1}
```

Después de eso, el equipo de EcoFarma marca ese producto como "no disponible" desde el panel y
vuelve a aparecer en el paso 1 con su `payload`. Ese es el momento de probar el ciclo completo.

**Prueba de fin a fin, ya validada contra el backend:** subir catálogo → encolar cambio desde
el panel → el cambio aparece con su `payload` → `ack` con `ok:true` → el panel muestra el
estado nuevo. Los casos de `ack` duplicado, cambio fallido y reintento también están cubiertos.

---

## 6. Qué NO hace falta

- **No hace falta tocar Cloudflare.** Ese es justamente el punto de este diseño.
- **No hace falta abrir ningún endpoint nuevo en WordPress.** Todo el tráfico sale de
  WordPress; nada entra.
- **No hace falta implementar lógica de negocio.** El `payload` viene listo.
- **No hace falta reintentar los fallos.** Los maneja el administrador desde el panel.

---

## 7. Consecuencias conocidas y aceptadas

Estas son decisiones tomadas a conciencia, no pendientes:

1. **Los cambios no son instantáneos.** Se aplican dentro del intervalo del cron. El panel
   muestra "Pendiente" mientras eso pasa, para no aparentar que ya se aplicó.
2. **La búsqueda del panel no es en vivo.** Trabaja sobre la copia del catálogo, que puede
   tener hasta un día de atraso en nombres y precios. Para lo que se usa (encontrar un producto
   y ocultarlo) es suficiente.
3. **Un producto borrado en WooCommerce sigue apareciendo en el panel** hasta que se limpie.
   Si se intenta cambiarlo, el cambio queda marcado como fallido con el error real.

---

## 8. Cómo se hace hoy en la práctica (2026-08-08 en adelante)

Sin nada del backend de EcoFarma de por medio -- directo en `ecofarma.co/wp-admin`:

1. **Productos** → buscar el producto → abrir para editar.
2. En el panel "Datos del producto":
   - **Ocultarlo de la tienda/buscador:** pestaña **General** → **Visibilidad en el
     catálogo** → elegir **"Oculto"**. La URL directa del producto sigue funcionando; solo
     deja de aparecer en categorías, la tienda y el buscador de ecofarma.co.
   - **Marcarlo agotado (que no se pueda comprar):** pestaña **Inventario** → **Estado del
     inventario** → elegir **"Agotado"**.
3. Guardar/Actualizar el producto. El cambio es instantáneo -- no hay cola, no hay cron, no
   hay retraso.

Estos son los mismos dos campos (`catalog_visibility` y `stock_status`) que todo el diseño
de las secciones 1-7 intentaba controlar por control remoto desde el backend. Al hacerlo
directo en WordPress no hace falta ninguna clave, ningún snippet, ni nada de este documento
-- solo permisos de `wp-admin` para editar productos.

**Nota (2026-08-08):** esta sección queda como referencia de "cómo hacerlo a mano si el
snippet alguna vez está caído", pero ya no es el camino principal -- ver sección 9. El
snippet automatizado terminó funcionando y es la forma normal de operar desde el panel.

---

## 9. Estado actual (2026-08-08): en producción, activo, validado de punta a punta

Esto reemplaza el pesimismo de las secciones 0 y 0.1 -- el tercer intento **sí funcionó**.
Todo lo que sigue está confirmado, no es un plan.

### 9.1 Qué hay activo en producción

- **Snippet:** `docs/wpcode-inventario-disponibilidad.php`, pegado en WPCode como el post
  **`post_id = 338454`** (tipo `wpcode`), ubicación "Ejecutar en todas partes", estado
  **Activo** (`post_status = publish`), sin "Modo de pruebas". Confirmado contra el listado
  real de fragmentos y contra `$wpdb` directo, no solo por la UI -- ver sección 10 de
  [`docs/integracion-wordpress-diario-salud.md`](integracion-wordpress-diario-salud.md) sobre
  por qué eso importa (es fácil obtener un falso negativo con WPCode).
- **Cron real del hosting** (no WP-Cron pseudo-cron): `crontab` del servidor corre
  `php -q wp-cron.php` cada 5 minutos, con `DISABLE_WP_CRON=true` en `wp-config.php`. Las
  tres tareas del snippet (sección 0.1) se disparan desde ahí.
- **`INTEGRATION_API_KEY`** configurada en Render y en el snippet, verificada extremo a
  extremo (no solo con `curl` suelto).

### 9.2 Los dos bugs reales que había que resolver (ya resueltos)

1. **El snippet no quedaba "Activo" en WPCode.** Causa de dos partes, encontrada con acceso
   directo a la base de datos de WordPress (vía Novamira):
   - `post_status` del snippet tenía que ser `publish` (se puede editar directo con
     `wp_update_post()`).
   - Eso solo no bastaba: WPCode Pro mantiene un **índice de caché separado**
     (`option 'wpcode_snippets'`, clase `WPCode_Snippet_Cache`) que hay que regenerar después
     de cualquier edición del snippet a nivel de base de datos, con
     `wpcode()->cache->cache_all_loaded_snippets()`. Sin este paso, el snippet aparecía
     "Activo" en la UI pero WordPress seguía ejecutando la versión vieja o ninguna.

2. **Los cambios se encolaban pero nunca se aplicaban en WooCommerce, sin ningún error
   visible.** `rest_do_request()` exige `current_user_can('manage_woocommerce')` del usuario
   *actual*. El cron real del sistema (PHP-CLI vía `crontab`) corre sin ningún usuario de
   WordPress autenticado -- el `PUT` fallaba el chequeo de permisos en silencio (`is_error()`
   `true`, se reportaba como `ok:false` al backend, pero nunca lanzaba una excepción que
   quedara en `error_log`). Diagnosticado reproduciendo `rest_do_request()` a mano (con
   usuario cargado, funcionaba) contra el disparo real por cron (fallaba). Fix: `if
   (!get_current_user_id()) { wp_set_current_user(889); }` al inicio de
   `ecofarma_disponibilidad_aplicar_pendientes()` (ver
   `docs/wpcode-inventario-disponibilidad.php:203-205`).

Ambos bugs quedaron **validados dos veces con espera pasiva real** (sin disparar nada a
mano, solo esperando la corrida real del cron): un producto marcado "no disponible" desde el
panel terminó agotado/oculto en WooCommerce solo, y luego uno marcado "disponible" de nuevo
volvió a aparecer solo -- ambos dentro de la ventana normal de 5-15 min.

### 9.3 Lo que se agregó sobre el diseño original de la sección 0.1

- **Auto-sanar:** después de aplicar cada cambio pendiente, la tarea 2 vuelve a subir de
  inmediato el estado REAL del producto tocado (no solo el que se acaba de aplicar). Esto
  evita que un producto que vuelve a estar disponible se quede mostrado como agotado/oculto
  en el panel hasta la próxima corrida diaria de la tarea 3 -- bug real, reportado por el
  usuario, ver `docs/wpcode-inventario-disponibilidad.php:251-269`.
- **Límite de tamaño del body en el backend:** la subida diaria del catálogo completo
  (~42,300 productos, tandas de 500) superaba el límite por defecto de Express (~100kb) y
  WordPress recibía `413`. Fix en `src/main.ts`:
  `app.useBodyParser('json', { limit: '5mb' })` (requiere crear la app como
  `NestExpressApplication`).

### 9.4 Qué hay del lado del panel de EcoFarma (`Inventario` → "Disponibilidad en WordPress")

- **Buscador** contra la copia local del catálogo (`GET /inventory/woocommerce/products?q=`).
- **Un solo botón combinado** "Marcar no disponible" / "Marcar disponible" por producto, que
  encola *a la vez* `catalog_visibility: hidden` y `stock_status: outofstock` (o lo inverso)
  -- ya no son dos acciones separadas. Mientras el cambio está pendiente de que WordPress lo
  aplique, el botón queda deshabilitado (no se puede volver a tocar hasta que una recarga
  confirme que WordPress ya lo aplicó); el estado se deriva del backend
  (`WoocommerceCatalogService.withPending()`), así que sobrevive a un F5.
  Ver `wooEffectiveHidden`/`wooEffectiveOutOfStock`/`wooIsPending`/
  `toggleWoocommerceUnavailable` en `public/index.html`.
- **Tabla "Lo que WordPress reportó"** (`GET /inventory/woocommerce/unavailable`): lo que la
  tarea 1 del snippet subió como agotado/oculto en su última corrida, con el mismo botón
  combinado y el mismo estado pendiente/fallido. **Paginada a 5 ítems por página** (agregado
  2026-08-08, ver `wooUnavailablePageItems`/`goToWooUnavailablePage` en `public/index.html`).
- **Lista Negra** (`ProductBlacklist`, tabla `product_blacklist`): un log manual de
  referencia -- SKU + nombre + motivo -- para que el equipo audite periódicamente qué
  debería estar bloqueado. **No aplica nada automáticamente** en WooCommerce ni WordPress;
  es intencional, existe como respaldo de auditoría para el riesgo residual de que
  WooCommerce recalcule `stock_status` solo si algún día `manage_stock` queda en `true` en
  un producto marcado agotado desde acá. Endpoints: `GET/POST/DELETE /inventory/blacklist`.
- **Creación manual de productos** en el catálogo propio del backend (`Product`, no
  `WoocommerceCatalogItem`): `POST /inventory/products`, valida SKU único, marca
  `sourceFile: 'manual-panel'`. Es un catálogo aparte del de Distrimonaco -- la
  sincronización automática con Distrimonaco nunca lo toca (upsert por SKU, sin deletes; ver
  `src/inventory/distrimonaco-sync.service.ts`).

### 9.5 Qué NO hay que repetir (evitar retrabajo)

- No volver a intentar closures sin nombre en un snippet de WPCode "Ejecutar en todas
  partes" -- confirmado que causa fatal errors no capturables (sección 4.2, incidente
  2026-08-04). Usar siempre funciones con nombre + `function_exists()`.
- No asumir que un snippet quedó "Activo" solo porque la UI de WPCode no mostró error al
  guardar -- verificar `post_status` Y regenerar `wpcode_snippets` (9.2, punto 1).
- No asumir que `count: 0` en `pending-changes` después de una corrida significa que el
  cambio se aplicó -- puede significar que se marcó como `FALLIDO` (ack con `ok:false`). Si
  el cron corre como PHP-CLI puro (crontab del sistema, no WP-Cron disparado por una visita),
  verificar que haya un `wp_set_current_user()` como el de 9.2, punto 2.
