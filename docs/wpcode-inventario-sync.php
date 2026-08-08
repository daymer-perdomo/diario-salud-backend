<?php
/**
 * EcoFarma - Inventario y Disponibilidad (sync via WP-Cron)
 *
 * WPCode snippet_id=338451 en produccion
 * (https://ecofarma.co/wp-admin/admin.php?page=wpcode-snippet-manager&snippet_id=338451),
 * pegado el 2026-08-08. Tipo: Fragmento de codigo de PHP. Ubicacion: "Ejecutar en todas
 * partes" (Auto insertar). Estado: Activo, con "Modo de pruebas" de WPCode encendido (el
 * snippet solo corre para usuarios logueados con permisos de administrador hasta que se
 * desactive ese modo) -- falta correr la prueba de fin a fin de la seccion 5 del doc y
 * luego apagar "Modo de pruebas" para que corra para todo el trafico/WP-Cron real.
 *
 * Contrato completo de los 3 endpoints que consume:
 * docs/integracion-inventario-wordpress.md
 *
 * Cierra el ciclo de Disponibilidad: el backend de EcoFarma NUNCA escribe en WordPress
 * (Cloudflare responde 403 a todo trafico entrante desde las IPs de Render), asi que es
 * WordPress quien inicia la conexion, via dos eventos de WP-Cron:
 *   - ecofarma_inventory_sync_pending (cada 5 min) -> lee GET /integration/woocommerce/
 *     pending-changes, aplica cada cambio contra WooCommerce (local, via
 *     rest_do_request -- no sale a la red, no pasa por Cloudflare) y confirma con
 *     POST /integration/woocommerce/pending-changes/ack.
 *   - ecofarma_inventory_sync_catalog (diario, de madrugada) -> recorre todo el catalogo
 *     de WooCommerce y lo sube por tandas de 500 con POST /integration/woocommerce/
 *     catalog, para que el buscador del panel admin de EcoFarma tenga con que trabajar.
 *
 * DISENO DEFENSIVO (ver seccion 4.2 del doc de inventario): a diferencia de los
 * snippets de Diario de la Salud/Blog (que solo LEEN y usan funciones con nombre +
 * guards), este snippet ESCRIBE en WooCommerce desde un cron -- un error no capturado
 * aca no debe poder tumbar el sitio en NINGUNA carga de pagina (ver el incidente real
 * del 2026-08-04 documentado en docs/integracion-wordpress-diario-salud.md, seccion
 * 5.1: un snippet con una funcion redeclarada tumbo ecofarma.co completo). Por eso:
 *   1. Cero funciones con nombre y cero define(): solo closures y variables locales
 *      dentro de cada closure, para que una recarga accidental del snippet en el mismo
 *      request nunca redeclare nada.
 *   2. Toda la logica de negocio vive DENTRO de un try/catch (\Throwable) en el cuerpo
 *      del closure de cada evento de cron -- si algo falla, muere unicamente esa
 *      ejecucion de wp-cron (invisible para el visitante), nunca el sitio.
 *   3. En una carga normal de pagina (fuera del cron) este snippet SOLO registra hooks
 *      -- ninguna llamada de red, ninguna escritura, nada que pueda fallar.
 *   4. Antes de pegarlo en WPCode: validar sintaxis (`php -l docs/wpcode-inventario-sync.php`)
 *      y, despues de guardar, confirmar que https://ecofarma.co responde 200.
 */

// --- clave de integracion: PEGAR EL VALOR REAL SOLO EN WPCODE, nunca commitear el
// valor real en este repo (es distinta de la clave publica de Diario de la Salud/Blog
// y el equipo de EcoFarma la entrega por un canal seguro aparte -- ver seccion 2 del
// doc de inventario) ---
$ecofarma_inventario_api = 'https://diario.ecofarma.co';
$ecofarma_inventario_key = '<INTEGRATION_API_KEY>';

// --- registro de los eventos de cron: corre en CADA carga de pagina, tiene que ser
// barato y no puede fallar -- solo compara/agenda, ninguna llamada externa ---
add_filter('cron_schedules', function ($schedules) {
    if (!isset($schedules['ecofarma_five_minutes'])) {
        $schedules['ecofarma_five_minutes'] = array(
            'interval' => 5 * MINUTE_IN_SECONDS,
            'display'  => 'Cada 5 minutos (EcoFarma)',
        );
    }
    return $schedules;
});

add_action('init', function () {
    if (!wp_next_scheduled('ecofarma_inventory_sync_pending')) {
        wp_schedule_event(time(), 'ecofarma_five_minutes', 'ecofarma_inventory_sync_pending');
    }
    if (!wp_next_scheduled('ecofarma_inventory_sync_catalog')) {
        // primera corrida manana 3am hora del servidor; wp_schedule_event repite
        // 'daily' a partir de ese timestamp.
        wp_schedule_event(strtotime('tomorrow 3:00am'), 'daily', 'ecofarma_inventory_sync_catalog');
    }
});

// --- evento 1: aplicar cambios de disponibilidad/stock encolados desde el panel ---
add_action('ecofarma_inventory_sync_pending', function () use ($ecofarma_inventario_api, $ecofarma_inventario_key) {
    try {
        $res = wp_remote_get($ecofarma_inventario_api . '/integration/woocommerce/pending-changes', array(
            'headers' => array('X-API-Key' => $ecofarma_inventario_key),
            'timeout' => 20,
        ));
        if (is_wp_error($res)) {
            error_log('EcoFarma inventario: fallo de red pidiendo cambios pendientes -- ' . $res->get_error_message());
            return;
        }
        if (wp_remote_retrieve_response_code($res) !== 200) {
            error_log('EcoFarma inventario: HTTP ' . wp_remote_retrieve_response_code($res) . ' pidiendo cambios pendientes');
            return;
        }

        $body = json_decode(wp_remote_retrieve_body($res), true);
        if (empty($body['changes'])) {
            return; // nada que hacer
        }

        $resultados = array();
        foreach ($body['changes'] as $cambio) {
            if (empty($cambio['id']) || empty($cambio['productId']) || !isset($cambio['payload'])) {
                // forma inesperada -- se ignora sin ack, se reintenta en la proxima
                // corrida una vez el backend la corrija.
                continue;
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
            }
        }

        if (empty($resultados)) {
            return;
        }

        wp_remote_post($ecofarma_inventario_api . '/integration/woocommerce/pending-changes/ack', array(
            'headers' => array('X-API-Key' => $ecofarma_inventario_key, 'Content-Type' => 'application/json'),
            'body'    => wp_json_encode(array('results' => $resultados)),
            'timeout' => 20,
        ));
    } catch (\Throwable $e) {
        error_log('EcoFarma inventario: excepcion en sync_pending -- ' . $e->getMessage());
    }
});

// --- evento 2: subir la copia del catalogo completo (una vez al dia, de madrugada) ---
add_action('ecofarma_inventory_sync_catalog', function () use ($ecofarma_inventario_api, $ecofarma_inventario_key) {
    try {
        $subir_tanda = function ($items) use ($ecofarma_inventario_api, $ecofarma_inventario_key) {
            $res = wp_remote_post($ecofarma_inventario_api . '/integration/woocommerce/catalog', array(
                'headers' => array('X-API-Key' => $ecofarma_inventario_key, 'Content-Type' => 'application/json'),
                'body'    => wp_json_encode(array('items' => $items)),
                'timeout' => 30,
            ));
            if (is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 201) {
                error_log('EcoFarma inventario: fallo subiendo tanda de catalogo de ' . count($items) . ' items -- ' .
                    (is_wp_error($res) ? $res->get_error_message() : wp_remote_retrieve_body($res)));
            }
        };

        $items = array();
        $pagina = 1;

        while (true) {
            $consulta = new WP_REST_Request('GET', '/wc/v3/products');
            $consulta->set_query_params(array('per_page' => 100, 'page' => $pagina));
            $respuesta = rest_do_request($consulta);

            if ($respuesta->is_error()) {
                error_log('EcoFarma inventario: fallo leyendo pagina ' . $pagina . ' de WooCommerce -- ' . $respuesta->as_error()->get_error_message());
                break;
            }

            $productos = $respuesta->get_data();
            if (empty($productos)) {
                break; // no hay mas paginas
            }

            foreach ($productos as $p) {
                $items[] = array(
                    'id'                => (int) $p['id'],
                    'sku'               => (string) $p['sku'],
                    'name'              => (string) $p['name'],
                    'permalink'         => (string) $p['permalink'],
                    'imageUrl'          => !empty($p['images'][0]['src']) ? $p['images'][0]['src'] : null,
                    'stockStatus'       => (string) $p['stock_status'],
                    'catalogVisibility' => (string) $p['catalog_visibility'],
                    'manageStock'       => (bool) $p['manage_stock'],
                );

                if (count($items) === 500) {
                    $subir_tanda($items);
                    $items = array();
                }
            }

            if (count($productos) < 100) {
                break; // ultima pagina
            }
            $pagina++;
        }

        if (!empty($items)) {
            $subir_tanda($items);
        }
    } catch (\Throwable $e) {
        error_log('EcoFarma inventario: excepcion en sync_catalog -- ' . $e->getMessage());
    }
});
