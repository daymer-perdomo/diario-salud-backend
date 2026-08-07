<?php
/**
 * EcoFarma - Diario de la Salud (insercion en /blog/)
 *
 * WPCode snippet_id=338438 en producción. Tipo: Fragmento de código de PHP.
 * Depende de que el snippet 338437 (wpcode-diario-salud-shortcode.php) esté
 * activo -- este archivo SOLO invoca el shortcode que aquel registra.
 *
 * Ubicación: "Al principio de elemento HTML", CSS Selector ".site-main",
 * Element index "All".
 * Lógica condicional: activada, "URL de la página Contiene /blog/" -- sin esto,
 * ".site-main" existe en TODO el sitio (es el wrapper del tema), no solo en /blog/.
 *
 * POR QUÉ NO SE ANCLA A ".motta-posts-group" (el widget de tabs "Recent Posts /
 * Popular Posts / Featured Posts" del tema, que es donde vivía la versión
 * original de este snippet): ese widget solo se renderiza si existen posts
 * nativos de WordPress en la página. El 2026-08-07, al mover a la papelera los
 * 7 posts nativos de la categoría "diario-de-la-salud" (ver sección Historial
 * en integracion-wordpress-diario-salud.md), el widget entero dejó de aparecer
 * en el HTML -- y con él, el punto de anclaje de este snippet, que dejó de
 * insertarse en cualquier lado sin ningún error visible. ".site-main" es parte
 * de la estructura fija del tema (existe siempre, independiente de si hay
 * posts), así que no puede desaparecer por esta misma razón.
 */

echo do_shortcode('[diario_salud]');
