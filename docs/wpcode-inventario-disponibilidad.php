<?php
/**
 * EcoFarma - Disponibilidad WooCommerce (reporte + aplicar cambios + catalogo)
 *
 * WPCode snippet -- EN PRODUCCION desde 2026-08-08: post_id=338454, Activo, "Ejecutar en
 * todas partes" (Auto insertar). Confirmado funcionando de punta a punta con espera
 * pasiva real (sin disparo manual) -- ver docs/integracion-inventario-wordpress.md
 * seccion 9 para el estado actual completo y los dos bugs que hubo que resolver para
 * llegar aca (post_status + cache de WPCode, y el fix de wp_set_current_user() de abajo).
 * Esta copia local sigue siendo la fuente de verdad para editar: cualquier cambio se edita
 * aca primero, se valida con `php -l`, y despues se copia a WPCode de produccion
 * (post_id=338454) regenerando el cache con wpcode()->cache->cache_all_loaded_snippets().
 *
 * FIX 2026-08-08 (segunda vuelta): rest_do_request() exige current_user_can(
 * 'manage_woocommerce'). El cron real del sistema (crontab -> php -q wp-cron.php) corre
 * sin usuario autenticado -- el PUT fallaba en silencio (is_error true, reportado como
 * ok:false al backend, sin excepcion que loggear) y el cambio nunca se aplicaba. Ver
 * wp_set_current_user() al inicio de la tarea 2.
 *
 * TERCER intento de conectar disponibilidad de WooCommerce con el backend de EcoFarma --
 * ver docs/integracion-inventario-wordpress.md secciones 0 y 0.1 para el historial
 * completo de los dos anteriores:
 *   1. snippet_id=338451 (closures, lee+escribe): nunca logro quedar "Activo".
 *   2. wpcode-inventario-disponibilidad-reporte.php (funciones con nombre, SOLO lee):
 *      nunca se llego a pegar en produccion -- el usuario pidio agregar tambien la
 *      escritura antes de probarlo, asi que se fusiono en este archivo.
 * Este usa funciones CON NOMBRE + guards (function_exists) en TODO el archivo -- el
 * mismo patron que SI se mantuvo activo sin problemas en los snippets de Diario de la
 * Salud/Blog (snippet_id 338434-338437). Si este tampoco logra quedar "Activo" en
 * WPCode, es evidencia fuerte de que el problema no es la complejidad ni el estilo del
 * codigo sino algo especifico de registrar eventos de WP-Cron en este hosting/WPCode --
 * reportar a soporte de WPCode con los tres casos documentados.
 *
 * Tres tareas independientes, cada una su propio evento de WP-Cron:
 *
 *   1. ecofarma_evento_reportar_disponibilidad (cada 15 min) -- SOLO LEE WooCommerce
 *      (funciones nativas, nunca REST) y sube por POST /integration/woocommerce/catalog
 *      los productos agotados/ocultos ahora mismo. Alimenta la tarjeta "Disponibilidad
 *      en WordPress" del panel (solo lectura ahi).
 *
 *   2. ecofarma_evento_aplicar_pendientes (cada 5 min) -- lee GET /integration/
 *      woocommerce/pending-changes (lo que el admin encolo desde el panel al buscar un
 *      producto y marcarlo no disponible/agotado), lo aplica LOCAL en WooCommerce via
 *      rest_do_request (sin salir a la red, sin pasar por Cloudflare) y confirma con
 *      POST /integration/woocommerce/pending-changes/ack. Esta es la unica tarea que
 *      ESCRIBE en WooCommerce.
 *
 *   3. ecofarma_evento_subir_catalogo (diario, de madrugada) -- sube el catalogo
 *      COMPLETO de WooCommerce (~42,300 productos, por tandas de 500) para que el
 *      buscador del panel tenga con que trabajar al buscar un producto por primera vez
 *      (si no esta en la copia local, no se puede encolar un cambio para el).
 *
 * DISENO DEFENSIVO: cada tarea esta envuelta en su propio try/catch (\Throwable) -- si
 * una falla, muere unicamente esa ejecucion de wp-cron, nunca el sitio y nunca las otras
 * dos tareas. En una carga normal de pagina este snippet SOLO registra hooks.
 */

if (!defined('ECOFARMA_DISPONIBILIDAD_API_BASE')) {
    define('ECOFARMA_DISPONIBILIDAD_API_BASE', 'https://diario.ecofarma.co');
}
if (!defined('ECOFARMA_DISPONIBILIDAD_API_KEY')) {
    // Valor real (INTEGRATION_API_KEY de Render) -- pegar SOLO en WPCode, nunca
    // commitear el valor real en este repo.
    define('ECOFARMA_DISPONIBILIDAD_API_KEY', '<INTEGRATION_API_KEY>');
}

// ============================================================================
// Registro de horarios y eventos -- corre en CADA carga de pagina, tiene que
// ser barato y no puede fallar: solo compara/agenda, ninguna llamada externa.
// ============================================================================

if (!function_exists('ecofarma_disponibilidad_cron_schedules')) {
function ecofarma_disponibilidad_cron_schedules($schedules) {
    if (!isset($schedules['ecofarma_cinco_minutos'])) {
        $schedules['ecofarma_cinco_minutos'] = array('interval' => 5 * MINUTE_IN_SECONDS, 'display' => 'Cada 5 minutos (EcoFarma)');
    }
    if (!isset($schedules['ecofarma_quince_minutos'])) {
        $schedules['ecofarma_quince_minutos'] = array('interval' => 15 * MINUTE_IN_SECONDS, 'display' => 'Cada 15 minutos (EcoFarma)');
    }
    return $schedules;
}
}
add_filter('cron_schedules', 'ecofarma_disponibilidad_cron_schedules');

if (!function_exists('ecofarma_disponibilidad_registrar_eventos')) {
function ecofarma_disponibilidad_registrar_eventos() {
    if (!wp_next_scheduled('ecofarma_evento_reportar_disponibilidad')) {
        wp_schedule_event(time(), 'ecofarma_quince_minutos', 'ecofarma_evento_reportar_disponibilidad');
    }
    if (!wp_next_scheduled('ecofarma_evento_aplicar_pendientes')) {
        wp_schedule_event(time(), 'ecofarma_cinco_minutos', 'ecofarma_evento_aplicar_pendientes');
    }
    if (!wp_next_scheduled('ecofarma_evento_subir_catalogo')) {
        wp_schedule_event(strtotime('tomorrow 3:00am'), 'daily', 'ecofarma_evento_subir_catalogo');
    }
}
}
add_action('init', 'ecofarma_disponibilidad_registrar_eventos');

// ============================================================================
// Helpers compartidos
// ============================================================================

/// Arma el payload de un producto exactamente como lo espera CatalogItemDto
/// del backend (ver src/integration/dto/upload-catalog.dto.ts).
if (!function_exists('ecofarma_disponibilidad_payload_producto')) {
function ecofarma_disponibilidad_payload_producto($product) {
    $imagen_id = $product->get_image_id();
    $imagen_url = $imagen_id ? wp_get_attachment_image_url($imagen_id, 'full') : null;
    return array(
        'id'                => $product->get_id(),
        'sku'               => (string) $product->get_sku(),
        'name'              => (string) $product->get_name(),
        'permalink'         => (string) $product->get_permalink(),
        'imageUrl'          => $imagen_url ?: null,
        'stockStatus'       => (string) $product->get_stock_status(),
        'catalogVisibility' => (string) $product->get_catalog_visibility(),
        'manageStock'       => (bool) $product->get_manage_stock(),
    );
}
}

if (!function_exists('ecofarma_disponibilidad_subir_tanda')) {
function ecofarma_disponibilidad_subir_tanda($items) {
    $res = wp_remote_post(ECOFARMA_DISPONIBILIDAD_API_BASE . '/integration/woocommerce/catalog', array(
        'headers' => array('X-API-Key' => ECOFARMA_DISPONIBILIDAD_API_KEY, 'Content-Type' => 'application/json'),
        'body'    => wp_json_encode(array('items' => $items)),
        'timeout' => 30,
    ));
    if (is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 201) {
        error_log('EcoFarma disponibilidad: fallo subiendo tanda de ' . count($items) . ' items -- ' .
            (is_wp_error($res) ? $res->get_error_message() : wp_remote_retrieve_body($res)));
    }
}
}

// ============================================================================
// Tarea 1: reportar agotados/ocultos (solo lectura, cada 15 min)
// ============================================================================

if (!function_exists('ecofarma_disponibilidad_reportar')) {
function ecofarma_disponibilidad_reportar() {
    try {
        if (!class_exists('WooCommerce') || !function_exists('wc_get_products')) {
            return;
        }

        $ids_agotados = wc_get_products(array(
            'status' => 'publish', 'stock_status' => 'outofstock', 'limit' => -1, 'return' => 'ids',
        ));

        $ids_ocultos = get_posts(array(
            'post_type'      => 'product',
            'post_status'    => 'publish',
            'posts_per_page' => -1,
            'fields'         => 'ids',
            'tax_query'      => array(array( // phpcs:ignore
                'taxonomy' => 'product_visibility',
                'field'    => 'slug',
                'terms'    => 'exclude-from-catalog',
            )),
        ));

        $ids = array_unique(array_merge($ids_agotados, $ids_ocultos));
        if (empty($ids)) {
            return;
        }

        $items = array();
        foreach ($ids as $id) {
            $product = wc_get_product($id);
            if (!$product) {
                continue;
            }
            $items[] = ecofarma_disponibilidad_payload_producto($product);
            if (count($items) === 500) {
                ecofarma_disponibilidad_subir_tanda($items);
                $items = array();
            }
        }
        if (!empty($items)) {
            ecofarma_disponibilidad_subir_tanda($items);
        }
    } catch (\Throwable $e) {
        error_log('EcoFarma disponibilidad: excepcion en reportar -- ' . $e->getMessage());
    }
}
}
add_action('ecofarma_evento_reportar_disponibilidad', 'ecofarma_disponibilidad_reportar');

// ============================================================================
// Tarea 2: aplicar cambios pendientes encolados desde el panel (ESCRIBE, cada
// 5 min) -- unica tarea que modifica WooCommerce.
// ============================================================================

if (!function_exists('ecofarma_disponibilidad_aplicar_pendientes')) {
function ecofarma_disponibilidad_aplicar_pendientes() {
    try {
        // rest_do_request() exige que el usuario ACTUAL tenga manage_woocommerce
        // (lo revisa el permission_callback del controlador de productos). El
        // cron real del sistema (crontab -> php -q wp-cron.php) corre sin ningun
        // usuario autenticado -- sin esto, cada PUT fallaba en silencio (is_error
        // true, capturado y reportado como "ok:false" al backend, nunca se veia
        // en error_log porque no es una excepcion) y el producto nunca cambiaba.
        // Confirmado 2026-08-08: el mismo rest_do_request SI funciono al probarlo
        // a mano (contexto con usuario cargado), y fallo via el cron real.
        if (!get_current_user_id()) {
            wp_set_current_user(889); // daymer, administrador
        }

        $res = wp_remote_get(ECOFARMA_DISPONIBILIDAD_API_BASE . '/integration/woocommerce/pending-changes', array(
            'headers' => array('X-API-Key' => ECOFARMA_DISPONIBILIDAD_API_KEY),
            'timeout' => 20,
        ));
        if (is_wp_error($res)) {
            error_log('EcoFarma disponibilidad: fallo de red pidiendo cambios pendientes -- ' . $res->get_error_message());
            return;
        }
        if (wp_remote_retrieve_response_code($res) !== 200) {
            error_log('EcoFarma disponibilidad: HTTP ' . wp_remote_retrieve_response_code($res) . ' pidiendo cambios pendientes');
            return;
        }

        $body = json_decode(wp_remote_retrieve_body($res), true);
        if (empty($body['changes'])) {
            return;
        }

        $resultados = array();
        // Ids de los productos tocados en esta corrida, para refrescar su
        // copia local al final -- ver nota "AUTO-SANAR" abajo.
        $productos_tocados = array();

        foreach ($body['changes'] as $cambio) {
            if (empty($cambio['id']) || empty($cambio['productId']) || !isset($cambio['payload'])) {
                continue; // forma inesperada -- se ignora sin ack, se reintenta cuando el backend la corrija
            }

            $request = new WP_REST_Request('PUT', '/wc/v3/products/' . (int) $cambio['productId']);
            $request->set_body_params($cambio['payload']); // tal cual viene, sin tocarlo
            $response = rest_do_request($request);

            if ($response->is_error()) {
                $resultados[] = array(
                    'id'    => $cambio['id'],
                    'ok'    => false,
                    'error' => substr($response->as_error()->get_error_message(), 0, 500),
                );
            } else {
                $resultados[] = array('id' => $cambio['id'], 'ok' => true);
                $productos_tocados[(int) $cambio['productId']] = true;
            }
        }

        // AUTO-SANAR (2026-08-08): la tarea de "reportar" (evento 1) solo
        // sube lo que esta agotado/oculto AHORA -- si un cambio de aca deja
        // un producto DISPONIBLE de nuevo, esa tarea deja de mencionarlo, y
        // la copia local se queda pegada mostrandolo agotado/oculto para
        // siempre (bug real, reportado por el usuario: el boton del panel
        // seguia ofreciendo "Marcar disponible" sobre un producto que ya
        // estaba disponible). Por eso, cualquier producto tocado aca --
        // disponible o no -- se resube de una vez con su estado real actual.
        if (!empty($productos_tocados)) {
            $items = array();
            foreach (array_keys($productos_tocados) as $id) {
                $product = wc_get_product($id);
                if ($product) {
                    $items[] = ecofarma_disponibilidad_payload_producto($product);
                }
            }
            if (!empty($items)) {
                ecofarma_disponibilidad_subir_tanda($items);
            }
        }

        if (empty($resultados)) {
            return;
        }

        wp_remote_post(ECOFARMA_DISPONIBILIDAD_API_BASE . '/integration/woocommerce/pending-changes/ack', array(
            'headers' => array('X-API-Key' => ECOFARMA_DISPONIBILIDAD_API_KEY, 'Content-Type' => 'application/json'),
            'body'    => wp_json_encode(array('results' => $resultados)),
            'timeout' => 20,
        ));
    } catch (\Throwable $e) {
        error_log('EcoFarma disponibilidad: excepcion en aplicar_pendientes -- ' . $e->getMessage());
    }
}
}
add_action('ecofarma_evento_aplicar_pendientes', 'ecofarma_disponibilidad_aplicar_pendientes');

// ============================================================================
// Tarea 3: subir el catalogo completo (diario, de madrugada) -- para que el
// buscador del panel encuentre productos que todavia no esten agotados/ocultos.
// ============================================================================

if (!function_exists('ecofarma_disponibilidad_subir_catalogo')) {
function ecofarma_disponibilidad_subir_catalogo() {
    try {
        if (!class_exists('WooCommerce') || !function_exists('wc_get_products')) {
            return;
        }

        $items = array();
        $pagina = 1;

        while (true) {
            $ids = wc_get_products(array(
                'status' => 'publish', 'limit' => 100, 'page' => $pagina, 'return' => 'ids', 'orderby' => 'ID',
            ));
            if (empty($ids)) {
                break;
            }

            foreach ($ids as $id) {
                $product = wc_get_product($id);
                if (!$product) {
                    continue;
                }
                $items[] = ecofarma_disponibilidad_payload_producto($product);
                if (count($items) === 500) {
                    ecofarma_disponibilidad_subir_tanda($items);
                    $items = array();
                }
            }

            if (count($ids) < 100) {
                break;
            }
            $pagina++;
        }

        if (!empty($items)) {
            ecofarma_disponibilidad_subir_tanda($items);
        }
    } catch (\Throwable $e) {
        error_log('EcoFarma disponibilidad: excepcion en subir_catalogo -- ' . $e->getMessage());
    }
}
}
add_action('ecofarma_evento_subir_catalogo', 'ecofarma_disponibilidad_subir_catalogo');
