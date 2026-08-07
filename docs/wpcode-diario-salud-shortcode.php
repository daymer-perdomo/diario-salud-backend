<?php
/**
 * EcoFarma - Diario de la Salud (shortcode via API)
 *
 * WPCode snippet_id=338437 en producción (https://ecofarma.co/wp-admin/admin.php?page=wpcode-snippet-manager&snippet_id=338437).
 * Tipo: Fragmento de código de PHP. Ubicación: "Ejecutar en todas partes" (Auto insertar).
 * Estado: Activo.
 *
 * Registra el shortcode [diario_salud], que consulta en vivo GET /articles (listado)
 * y GET /articles/:id (detalle) contra el backend de EcoFarma. NUNCA crea entradas
 * nativas de WordPress -- solo renderiza al vuelo. Reemplaza por completo al viejo
 * mecanismo de push (WordpressPublishService -> wp-json/wp/v2/posts) y a los
 * mecanismos de pull más viejos que existían antes en este mismo sitio (ver
 * docs/integracion-wordpress-diario-salud.md, sección "Historial").
 *
 * La llamada a la API ocurre en el SERVIDOR de WordPress (wp_remote_get), nunca en
 * el navegador -- la clave no queda expuesta en el HTML ni en JS.
 *
 * DISEÑO DEFENSIVO: cada función/constante está envuelta en un guard
 * (function_exists/defined/shortcode_exists) porque este snippet corre en
 * "Ejecutar en todas partes" -- si alguna vez se duplica o se recarga en el mismo
 * request, una redeclaración sin guard sería un fatal error de PHP no capturable,
 * que puede tumbar el sitio completo. Ese incidente ya ocurrió una vez en este sitio
 * el 2026-08-04 con OTRO snippet (ver el snippet_id=338366, inactivo, que documenta
 * el incidente en su propio comentario). Este snippet SÍ usa funciones con nombre y
 * define(), a diferencia de la variante 100% con closures del 338366 -- se consideró
 * aceptable porque los guards previenen la redeclaración por construcción, pero si se
 * vuelve a tocar este código, mantener SIEMPRE los guards.
 *
 * BUG CORREGIDO 2026-08-07: la primera versión usaba get_permalink() sin argumento
 * para construir el link "ver detalle" de cada tarjeta. Como este snippet corre FUERA
 * del Loop principal de WordPress (se invoca vía do_shortcode() desde otro snippet,
 * no como contenido de un post), get_permalink() recogía el $post global que había
 * dejado "sucio" el último post iterado por OTRO widget de la página (el listado
 * "Diario de la Salud" de Elementor, o el widget de tabs del tema) -- el resultado
 * era que TODAS las tarjetas enlazaban a la URL de un post cualquiera (en un caso
 * real, al post intruso "FDA Warns..."), no a la página actual. Ver
 * ecofarma_current_page_url() abajo: calcula la URL directamente desde
 * $_SERVER['REQUEST_URI'], sin depender del estado del Loop.
 */

if (!defined('ECOFARMA_API_BASE')) {
    define('ECOFARMA_API_BASE', 'https://diario.ecofarma.co');
}
if (!defined('ECOFARMA_API_KEY')) {
    // Valor real tomado del dashboard de Render (servicio diario-salud-backend,
    // env var PUBLIC_API_KEY) -- NO necesariamente igual al .env local; verificar
    // ahí si algún día deja de funcionar, no asumir que coincide con el repo.
    define('ECOFARMA_API_KEY', '63ca0835f6dab5c589bf86d5019cc3075edc32854b65bd6a');
}

/**
 * GET autenticado al backend, con cache corta vía transients para no golpear
 * la API en cada carga de página. Devuelve null (nunca lanza) si algo falla --
 * el shortcode debe degradar con un mensaje, jamás romper la página.
 */
if (!function_exists('ecofarma_api_get')) {
function ecofarma_api_get($path) {
    $cache_key = 'ecofarma_api_' . md5($path);
    $cached = get_transient($cache_key);
    if ($cached !== false) {
        return $cached;
    }
    $response = wp_remote_get(ECOFARMA_API_BASE . $path, array(
        'headers' => array('X-API-Key' => ECOFARMA_API_KEY),
        'timeout' => 10,
    ));
    if (is_wp_error($response)) {
        error_log('EcoFarma API: ' . $response->get_error_message());
        return null;
    }
    $code = wp_remote_retrieve_response_code($response);
    if ($code !== 200) {
        error_log('EcoFarma API: HTTP ' . $code . ' en ' . $path);
        return null;
    }
    $data = json_decode(wp_remote_retrieve_body($response), true);
    // Cache corta (5 min): el contenido cambia poco, pero no debe quedar
    // "pegado" mucho tiempo si un validador corrige algo después de publicar.
    set_transient($cache_key, $data, 5 * MINUTE_IN_SECONDS);
    return $data;
}
}

/**
 * URL de la página actual, calculada directamente desde la petición HTTP --
 * a propósito NO usa get_permalink() (ver nota de "BUG CORREGIDO" arriba).
 */
if (!function_exists('ecofarma_current_page_url')) {
function ecofarma_current_page_url() {
    $path_only = strtok($_SERVER['REQUEST_URI'], '?');
    return home_url($path_only);
}
}

if (!function_exists('ecofarma_render_articulo_detalle')) {
function ecofarma_render_articulo_detalle($articulo) {
    $html = '<article class="ecofarma-articulo">';
    $html .= '<h1>' . esc_html($articulo['title']) . '</h1>';
    if (!empty($articulo['imageUrl'])) {
        $html .= '<img src="' . esc_url($articulo['imageUrl']) . '" alt="" style="max-width:100%;height:auto;border-radius:8px;margin:12px 0;" />';
    }
    if (!empty($articulo['summary'])) {
        $html .= '<p class="ecofarma-resumen"><em>' . esc_html($articulo['summary']) . '</em></p>';
    }
    if (!empty($articulo['keyPoints'])) {
        $html .= '<h2>Puntos clave</h2><ul>';
        foreach ($articulo['keyPoints'] as $punto) {
            $html .= '<li>' . esc_html($punto) . '</li>';
        }
        $html .= '</ul>';
    }
    $html .= '<div class="ecofarma-cuerpo">';
    // content es texto plano con párrafos separados por salto de línea (nunca
    // HTML) -- se escapa siempre, nunca se imprime crudo.
    $parrafos = array_filter(array_map('trim', explode("\n", (string) $articulo['content'])));
    foreach ($parrafos as $p) {
        $html .= '<p>' . esc_html($p) . '</p>';
    }
    $html .= '</div>';
    if (!empty($articulo['whyItMatters'])) {
        $html .= '<h2>Por qu&eacute; es importante</h2><p>' . esc_html($articulo['whyItMatters']) . '</p>';
    }
    $html .= '<p class="ecofarma-fuente"><em>Fuente: <a href="' . esc_url($articulo['source']['url']) . '" target="_blank" rel="noopener noreferrer">' . esc_html($articulo['source']['name']) . '</a>';
    $html .= ' &mdash; ' . esc_html(date_i18n('j \d\e F \d\e Y', strtotime($articulo['source']['publishedAt']))) . '</em></p>';
    $html .= '<p class="ecofarma-disclaimer"><small>Este contenido tiene fines exclusivamente informativos y no sustituye la orientaci&oacute;n de un profesional de la salud.</small></p>';
    $html .= '<p><a href="' . esc_url(remove_query_arg('articulo')) . '">&larr; Volver al listado</a></p>';
    $html .= '</article>';
    return $html;
}
}

/**
 * Tarjeta de la grilla de 3 columnas (ver ecofarma_diario_salud_css() para el
 * grid). Todo el <a> es clicable -- envuelve imagen + tag de fuente + título +
 * resumen + fecha.
 */
if (!function_exists('ecofarma_render_articulo_card')) {
function ecofarma_render_articulo_card($articulo, $page_url) {
    $detalle_url = add_query_arg('articulo', $articulo['id'], $page_url);
    $html = '<a class="ecofarma-card" href="' . esc_url($detalle_url) . '">';
    if (!empty($articulo['imageUrl'])) {
        $html .= '<div class="ecofarma-card__img"><img src="' . esc_url($articulo['imageUrl']) . '" alt="" loading="lazy" /></div>';
    } else {
        $html .= '<div class="ecofarma-card__img ecofarma-card__img--placeholder"></div>';
    }
    $html .= '<div class="ecofarma-card__body">';
    if (!empty($articulo['source']['name'])) {
        $html .= '<span class="ecofarma-card__tag">' . esc_html($articulo['source']['name']) . '</span>';
    }
    $html .= '<h3 class="ecofarma-card__title">' . esc_html($articulo['title']) . '</h3>';
    if (!empty($articulo['summary'])) {
        $html .= '<p class="ecofarma-card__excerpt">' . esc_html($articulo['summary']) . '</p>';
    }
    if (!empty($articulo['source']['publishedAt'])) {
        $html .= '<span class="ecofarma-card__meta">' . esc_html(date_i18n('j M Y', strtotime($articulo['source']['publishedAt']))) . '</span>';
    }
    $html .= '</div></a>';
    return $html;
}
}

if (!function_exists('ecofarma_diario_salud_css')) {
function ecofarma_diario_salud_css() {
    return '<style>'
        . '.ecofarma-diario-salud{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin:24px 0;}'
        . '@media (max-width:900px){.ecofarma-diario-salud{grid-template-columns:repeat(2,1fr);}}'
        . '@media (max-width:600px){.ecofarma-diario-salud{grid-template-columns:1fr;}}'
        . '.ecofarma-card{display:flex;flex-direction:column;text-decoration:none;color:inherit;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;background:#fff;transition:box-shadow .2s,transform .2s;}'
        . '.ecofarma-card:hover{box-shadow:0 8px 24px rgba(20,20,43,.12);transform:translateY(-2px);}'
        . '.ecofarma-card__img{width:100%;aspect-ratio:16/10;overflow:hidden;background:linear-gradient(135deg,#2a3a8f,#1c2668);}'
        . '.ecofarma-card__img img{width:100%;height:100%;object-fit:cover;display:block;}'
        . '.ecofarma-card__body{padding:16px;display:flex;flex-direction:column;gap:8px;flex:1;}'
        . '.ecofarma-card__tag{font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#2a3a8f;}'
        . '.ecofarma-card__title{font-size:16px;font-weight:700;color:#141428;line-height:1.35;margin:0;}'
        . '.ecofarma-card__excerpt{font-size:13px;color:#6b6b7b;line-height:1.5;margin:0;flex:1;}'
        . '.ecofarma-card__meta{font-size:11px;color:#a1a1aa;}'
        . '.ecofarma-paginacion{display:flex;gap:8px;margin-top:16px;}'
        . '</style>';
}
}

/**
 * [diario_salud pagina_size="9"]
 * Con ?articulo=<uuid> en la URL de la misma página, muestra el detalle en vez
 * del listado -- un solo shortcode cubre las dos vistas, sin necesitar un
 * custom post type ni una página aparte por artículo.
 */
if (!function_exists('ecofarma_diario_salud_shortcode')) {
function ecofarma_diario_salud_shortcode($atts) {
    $atts = shortcode_atts(array('pagina_size' => 9), $atts);
    $page_url = ecofarma_current_page_url();

    if (!empty($_GET['articulo'])) {
        $id = sanitize_text_field(wp_unslash($_GET['articulo']));
        $articulo = ecofarma_api_get('/articles/' . rawurlencode($id));
        if (!$articulo) {
            return '<p>No se pudo cargar este art&iacute;culo en este momento. Intenta de nuevo m&aacute;s tarde.</p>';
        }
        return ecofarma_render_articulo_detalle($articulo);
    }

    $pagina = isset($_GET['pag']) ? max(1, intval($_GET['pag'])) : 1;
    $path = '/articles?state=PUBLICADO&page=' . $pagina . '&pageSize=' . intval($atts['pagina_size']);
    $resultado = ecofarma_api_get($path);

    if (!$resultado || empty($resultado['data'])) {
        return '<p>No hay art&iacute;culos disponibles en este momento.</p>';
    }

    $html = ecofarma_diario_salud_css();
    $html .= '<div class="ecofarma-diario-salud">';
    foreach ($resultado['data'] as $articulo) {
        $html .= ecofarma_render_articulo_card($articulo, $page_url);
    }
    $html .= '</div>';

    $meta = $resultado['meta'];
    if (!empty($meta['totalPages']) && $meta['totalPages'] > 1) {
        $html .= '<div class="ecofarma-paginacion">';
        for ($p = 1; $p <= $meta['totalPages']; $p++) {
            if ($p === $pagina) {
                $html .= '<strong>' . esc_html($p) . '</strong>';
            } else {
                $html .= '<a href="' . esc_url(add_query_arg('pag', $p, $page_url)) . '">' . esc_html($p) . '</a>';
            }
        }
        $html .= '</div>';
    }
    return $html;
}
}

if (!shortcode_exists('diario_salud')) {
    add_shortcode('diario_salud', 'ecofarma_diario_salud_shortcode');
}
