/// Imagen de respaldo para productos en las respuestas del chatbot.
/// Decision 2026-07-29: el SKU local (Product.sku = CodigoBarras de
/// Distrimonaco) NO tiene equivalente confiable en WooCommerce -- el SKU
/// de WooCommerce es un codigo interno ("ECOFARMA-XXXX") y ni GTIN/EAN ni
/// "codigo_del_proveedor" identifican el producto individual (verificado
/// contra la API real, ver conversacion). Emparejar por nombre es
/// arriesgado con medicamentos (distintas presentaciones/dosis del mismo
/// principio activo) asi que, por ahora, TODOS los productos usan esta
/// imagen generica -- ninguna imagen por producto hasta que exista una
/// llave confiable (ver Opcion 2/3 discutidas: fuzzy matching con umbral
/// alto + revision humana, o que WooCommerce empiece a guardar el GTIN).
///
/// URL absoluta (vive en WordPress, no en este backend) -- el widget la
/// consume tal cual como src de <img> desde el sitio de WordPress mismo,
/// asi que no aplica el problema de ruta relativa de
/// default-article-image.util.ts.
export const DEFAULT_PRODUCT_IMAGE_URL = 'https://ecofarma.co/wp-content/uploads/2026/05/ecofarma-default.png';
