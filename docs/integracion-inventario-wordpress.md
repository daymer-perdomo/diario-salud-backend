# Integración de inventario: EcoFarma ↔ WordPress

**Para:** desarrollador de WordPress de ecofarma.co
**Backend:** `https://diario.ecofarma.co`
**Última actualización:** 2026-08-05

---

## 1. Qué hay que construir y por qué

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
