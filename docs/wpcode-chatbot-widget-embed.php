<?php
/**
 * EcoFarma - Chatbot de inventario (embeber el widget en el sitio)
 *
 * WPCode snippet -- todavia NO existe en produccion (falta pegarlo en
 * https://ecofarma.co/wp-admin/admin.php?page=wpcode-snippet-manager y asignarle
 * snippet_id). Tipo: Fragmento de codigo de PHP. Ubicacion: "Ejecutar en todas partes"
 * (Auto insertar).
 *
 * A diferencia de docs/wpcode-inventario-disponibilidad.php, este snippet NO tiene
 * cron ni logica de negocio -- solo imprime un <script> en el footer de cada pagina.
 * Bajo riesgo: nada que pueda fallar en tiempo de ejecucion, nada que dependa de
 * WooCommerce estar cargado. Aun asi sigue el mismo patron defensivo que el resto de
 * los snippets de este sitio (funcion CON NOMBRE + function_exists()), nunca un
 * closure anonimo en un snippet "Ejecutar en todas partes" -- ver el incidente del
 * 2026-08-04 documentado en docs/integracion-inventario-wordpress.md seccion 4.2.
 *
 * El propio widget (public/widget/chatbot.js, servido por el backend en
 * /widget/chatbot.js) resuelve su URL base de API desde el atributo
 * data-api-base-url de su propio <script> -- no hace falta nada mas del lado del
 * backend, y el mismo archivo ya sirve tanto la consola de prueba interna del panel
 * como este embed publico.
 *
 * Ver docs/integracion-chatbot-wordpress.md para el estado completo de esta
 * integracion (snippet_id una vez pegado en produccion, como probarlo, que hace el
 * widget del lado del cliente).
 */

if (!function_exists('ecofarma_chatbot_widget_embed')) {
function ecofarma_chatbot_widget_embed() {
    echo '<script src="https://diario.ecofarma.co/widget/chatbot.js" ' .
         'data-api-base-url="https://diario.ecofarma.co" defer></script>';
}
}
add_action('wp_footer', 'ecofarma_chatbot_widget_embed');
