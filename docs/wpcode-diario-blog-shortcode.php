<?php
/**
 * EcoFarma - Blog (shortcode via API)
 *
 * Snippet nuevo de WPCode (hermano de wpcode-diario-salud-shortcode.php,
 * snippet_id=338437). Tipo: Fragmento de codigo de PHP. Ubicacion: "Ejecutar
 * en todas partes" (Auto insertar).
 *
 * Registra el shortcode [diario_blog], que consulta en vivo GET /blog/public
 * (listado) y GET /blog/public/:id (detalle) contra el backend de EcoFarma --
 * mismo patron que [diario_salud], pero para el contenido de BlogPost
 * (posts SEO con hub/sub-hub, secciones H2 y FAQs), que es un tipo de
 * contenido totalmente distinto a Articles/Diario de la Salud.
 *
 * Vive en la pagina "Blogs" (https://ecofarma.co/blogs/), contenido literal
 * `[diario_blog]`. La pagina "Articulos" (https://ecofarma.co/blog/) y esta
 * se enlazan entre si con una miga de pan (ver ecofarma_breadcrumb_nav) para
 * que el visitante pueda moverse entre las dos secciones.
 *
 * IMPORTANTE -- constantes y funciones compartidas con
 * wpcode-diario-salud-shortcode.php: ECOFARMA_API_BASE, ECOFARMA_API_KEY,
 * ECOFARMA_NAV_ARTICULOS_URL, ECOFARMA_NAV_BLOGS_URL, ecofarma_api_get(),
 * ecofarma_current_page_url(), ecofarma_breadcrumb_nav(),
 * ecofarma_breadcrumb_css(), ecofarma_diario_salud_css() estan definidas
 * IDENTICAS en ambos snippets, cada una envuelta en su guard
 * (defined()/function_exists()). Da igual cual de los dos snippets cargue
 * primero en una pagina dada -- el primero "gana" la definicion real, el
 * segundo la respeta por el guard. Si tocas cualquiera de estos nombres
 * compartidos, cambialos en AMBOS archivos a la vez, o quedaran
 * desincronizados (aunque no rotos: solo uno de los dos definira la version
 * real, silenciosamente).
 */

if (!defined('ECOFARMA_API_BASE')) {
    define('ECOFARMA_API_BASE', 'https://diario.ecofarma.co');
}
if (!defined('ECOFARMA_API_KEY')) {
    define('ECOFARMA_API_KEY', '63ca0835f6dab5c589bf86d5019cc3075edc32854b65bd6a');
}
if (!defined('ECOFARMA_NAV_ARTICULOS_URL')) {
    define('ECOFARMA_NAV_ARTICULOS_URL', 'https://ecofarma.co/blog/');
}
if (!defined('ECOFARMA_NAV_BLOGS_URL')) {
    define('ECOFARMA_NAV_BLOGS_URL', 'https://ecofarma.co/blogs/');
}

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
    set_transient($cache_key, $data, 5 * MINUTE_IN_SECONDS);
    return $data;
}
}

if (!function_exists('ecofarma_current_page_url')) {
function ecofarma_current_page_url() {
    $path_only = strtok($_SERVER['REQUEST_URI'], '?');
    return home_url($path_only);
}
}

if (!function_exists('ecofarma_breadcrumb_nav')) {
function ecofarma_breadcrumb_nav($active) {
    $html = '<nav class="ecofarma-breadcrumb-nav" aria-label="breadcrumb">';
    $html .= $active === 'articulos'
        ? '<strong>Art&iacute;culos</strong>'
        : '<a href="' . esc_url(ECOFARMA_NAV_ARTICULOS_URL) . '">Art&iacute;culos</a>';
    $html .= '<span class="ecofarma-breadcrumb-sep">/</span>';
    $html .= $active === 'blogs'
        ? '<strong>Blogs</strong>'
        : '<a href="' . esc_url(ECOFARMA_NAV_BLOGS_URL) . '">Blogs</a>';
    $html .= '</nav>';
    return $html;
}
}

if (!function_exists('ecofarma_breadcrumb_css')) {
function ecofarma_breadcrumb_css() {
    return '<style>'
        . '.ecofarma-breadcrumb-nav{display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:14px;color:#6b6b7b;}'
        . '.ecofarma-breadcrumb-nav a{color:#2a3a8f;text-decoration:none;}'
        . '.ecofarma-breadcrumb-nav a:hover{text-decoration:underline;}'
        . '.ecofarma-breadcrumb-nav strong{color:#141428;}'
        . '.ecofarma-breadcrumb-sep{color:#c4c4cc;}'
        . '</style>';
}
}

/// Mismo grid/tarjeta de 3 columnas que [diario_salud] -- comparten clases
/// CSS (.ecofarma-diario-salud, .ecofarma-card) a proposito, para que ambas
/// secciones se vean visualmente consistentes.
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

if (!function_exists('ecofarma_blog_css')) {
function ecofarma_blog_css() {
    return '<style>'
        . '.ecofarma-blog-tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#2a3a8f;background:#eef0fb;padding:4px 10px;border-radius:999px;margin-bottom:8px;}'
        . '.ecofarma-blog-faq{border-top:1px solid #e4e4e7;padding:16px 0;}'
        . '.ecofarma-blog-faq__q{font-weight:700;color:#141428;margin:0 0 8px;}'
        . '.ecofarma-blog-faq__a{color:#3f3f46;margin:0;}'
        . '</style>';
}
}

if (!function_exists('ecofarma_render_blog_detalle')) {
function ecofarma_render_blog_detalle($post) {
    $html = '<article class="ecofarma-blog-articulo">';
    if (!empty($post['tagPrincipal'])) {
        $html .= '<span class="ecofarma-blog-tag">' . esc_html($post['tagPrincipal']) . '</span>';
    }
    $html .= '<h1>' . esc_html($post['title']) . '</h1>';
    if (!empty($post['imageUrl'])) {
        $html .= '<img src="' . esc_url($post['imageUrl']) . '" alt="" style="max-width:100%;height:auto;border-radius:8px;margin:12px 0;" />';
    }
    if (!empty($post['sections'])) {
        foreach ($post['sections'] as $section) {
            if (!empty($section['heading'])) {
                $html .= '<h2>' . esc_html($section['heading']) . '</h2>';
            }
            if (!empty($section['body'])) {
                $parrafos = array_filter(array_map('trim', explode("\n", (string) $section['body'])));
                foreach ($parrafos as $p) {
                    $html .= '<p>' . esc_html($p) . '</p>';
                }
            }
        }
    }
    if (!empty($post['faqs'])) {
        $html .= '<h2>Preguntas frecuentes</h2>';
        foreach ($post['faqs'] as $faq) {
            $html .= '<div class="ecofarma-blog-faq">';
            $html .= '<p class="ecofarma-blog-faq__q">' . esc_html($faq['question']) . '</p>';
            if (!empty($faq['answer'])) {
                $html .= '<p class="ecofarma-blog-faq__a">' . esc_html($faq['answer']) . '</p>';
            }
            $html .= '</div>';
        }
    }
    $html .= '<p><a href="' . esc_url(remove_query_arg('post_blog')) . '">&larr; Volver al listado</a></p>';
    $html .= '</article>';
    return $html;
}
}

if (!function_exists('ecofarma_render_blog_card')) {
function ecofarma_render_blog_card($post, $page_url) {
    $detalle_url = add_query_arg('post_blog', $post['id'], $page_url);
    $excerpt = '';
    if (!empty($post['sections'][0]['body'])) {
        $excerpt = wp_trim_words(wp_strip_all_tags($post['sections'][0]['body']), 24, '...');
    }
    $html = '<a class="ecofarma-card" href="' . esc_url($detalle_url) . '">';
    if (!empty($post['imageUrl'])) {
        $html .= '<div class="ecofarma-card__img"><img src="' . esc_url($post['imageUrl']) . '" alt="" loading="lazy" /></div>';
    } else {
        $html .= '<div class="ecofarma-card__img ecofarma-card__img--placeholder"></div>';
    }
    $html .= '<div class="ecofarma-card__body">';
    $html .= '<span class="ecofarma-card__tag">' . esc_html($post['hub']) . '</span>';
    $html .= '<h3 class="ecofarma-card__title">' . esc_html($post['title']) . '</h3>';
    if ($excerpt) {
        $html .= '<p class="ecofarma-card__excerpt">' . esc_html($excerpt) . '</p>';
    }
    $html .= '</div></a>';
    return $html;
}
}

/**
 * [diario_blog pagina_size="9"]
 * Con ?post_blog=<uuid> en la URL de la misma pagina, muestra el detalle en
 * vez del listado -- mismo patron que [diario_salud] con ?articulo=<uuid>.
 * Se usa un nombre de parametro distinto (post_blog en vez de articulo) para
 * que ambos shortcodes puedan convivir sin pisarse si algun dia aparecen en
 * la misma pagina.
 */
if (!function_exists('ecofarma_diario_blog_shortcode')) {
function ecofarma_diario_blog_shortcode($atts) {
    $atts = shortcode_atts(array('pagina_size' => 9), $atts);
    $page_url = ecofarma_current_page_url();
    $breadcrumb = ecofarma_breadcrumb_css() . ecofarma_breadcrumb_nav('blogs');

    if (!empty($_GET['post_blog'])) {
        $id = sanitize_text_field(wp_unslash($_GET['post_blog']));
        $post = ecofarma_api_get('/blog/public/' . rawurlencode($id));
        if (!$post) {
            return $breadcrumb . '<p>No se pudo cargar este contenido en este momento. Intenta de nuevo m&aacute;s tarde.</p>';
        }
        return $breadcrumb . ecofarma_blog_css() . ecofarma_render_blog_detalle($post);
    }

    $pagina = isset($_GET['pag']) ? max(1, intval($_GET['pag'])) : 1;
    $path = '/blog/public?page=' . $pagina . '&pageSize=' . intval($atts['pagina_size']);
    $resultado = ecofarma_api_get($path);

    if (!$resultado || empty($resultado['data'])) {
        return $breadcrumb . '<p>No hay contenido de blog disponible en este momento.</p>';
    }

    $html = ecofarma_diario_salud_css() . $breadcrumb;
    $html .= '<div class="ecofarma-diario-salud">';
    foreach ($resultado['data'] as $post) {
        $html .= ecofarma_render_blog_card($post, $page_url);
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

if (!shortcode_exists('diario_blog')) {
    add_shortcode('diario_blog', 'ecofarma_diario_blog_shortcode');
}
