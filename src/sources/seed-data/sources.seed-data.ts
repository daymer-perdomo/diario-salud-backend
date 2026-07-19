import { FetchMethod, SourceType } from '@prisma/client';

/// Catalogo inicial de las 15 fuentes autorizadas del brief (secciones 4.1
/// y 4.2). Cada URL/selector marcado como verificado fue confirmado en
/// vivo (fetch real) antes de escribirse aqui -- ver notas por fuente.
/// Las fuentes HTML_SCRAPE sin selectores verificados quedan con
/// isActive=false y un selector centinela "PENDIENTE_CALIBRACION_MANUAL":
/// no se inventan selectores para sitios que no se inspeccionaron al
/// detalle, en linea con el requisito del cliente de que nada en este
/// pipeline sea inventado.
export interface SourceSeedItem {
  institutionCode: string;
  name: string;
  type: SourceType;
  baseUrl: string;
  country: string;
  fetchMethod: FetchMethod;
  isActive: boolean;
  /// "HH:mm" (24h) para ingesta automatica diaria, u omitir para
  /// manual-only. Ninguna fuente del seed trae horario por defecto tras
  /// el incidente de agotamiento de credito -- se configura desde el
  /// panel (Fuentes) cuando el cliente decida que cadencia quiere.
  scheduledTime?: string;
  /// Tope de items nuevos por corrida, configurable despues desde el
  /// panel (pestaña Fuentes) -- omitir para usar el default propio de
  /// cada adapter. Ver Source.maxItemsPerRun en el schema.
  maxItemsPerRun?: number;
  /// Ventana de recencia en dias, configurable despues desde el panel --
  /// omitir para usar el default propio de cada adapter. Ver
  /// Source.maxAgeDays en el schema.
  maxAgeDays?: number;
  config: Record<string, unknown>;
  notes?: string;
}

const PENDIENTE = 'PENDIENTE_CALIBRACION_MANUAL';

export const SOURCE_SEED_DATA: SourceSeedItem[] = [
  // ---------- Colombia ----------
  {
    institutionCode: 'MINSALUD',
    name: 'Ministerio de Salud y Proteccion Social',
    type: SourceType.HTML_SCRAPE,
    baseUrl: 'https://www.minsalud.gov.co',
    country: 'CO',
    fetchMethod: FetchMethod.HTTP_SIMPLE,
    isActive: false,
    config: {
      listingUrl: 'https://www.minsalud.gov.co/comunicadosPrensa/Paginas/home.aspx',
      itemSelector: PENDIENTE,
      titleSelector: PENDIENTE,
      linkSelector: PENDIENTE,
      dateSelector: PENDIENTE,
    },
    notes:
      'Recalibracion intentada 2026-07-16: la URL de listado original ya devuelve 404 -- el sitio se ' +
      'reestructuro. Candidatos probados que TAMBIEN 404an: /CC/Noticias/2026/Paginas/noticias-2026.aspx ' +
      '(indexado por buscadores pero ya no existe), /CC/Paginas/Centro-de-Comunicaciones.aspx. El home ' +
      '(www.minsalud.gov.co) redirige con exito a /Paginas/InicioV2.aspx (SharePoint, HTTP 200) -- desde ahi ' +
      'hay que navegar manualmente en un navegador real para encontrar la URL de noticias vigente, porque el ' +
      'menu de navegacion es render de JS/SharePoint que un fetch simple no ejecuta. Sigue PENDIENTE.',
  },
  {
    institutionCode: 'INS',
    name: 'Instituto Nacional de Salud',
    type: SourceType.OPEN_DATA_API,
    baseUrl: 'https://www.datos.gov.co',
    country: 'CO',
    fetchMethod: FetchMethod.HTTP_SIMPLE,
    isActive: true,
    config: {
      apiUrls: ['https://www.datos.gov.co/resource/fhc4-jjti.json'],
      order: 'ano DESC, semana DESC',
      limit: 200,
      datasetLandingUrl: 'https://www.datos.gov.co/Salud-y-Protecci-n-Social/DA-SIVIGILA-2021-INS/fhc4-jjti',
    },
    notes:
      'Verificado en vivo: campos reales cod_eve/nombre_evento/semana/ano/municipio_ocurrencia/departamento_ocurrencia/conteo. ' +
      'IMPORTANTE: el dataset nacional agregado mas reciente encontrado en datos.gov.co es SIVIGILA 2021 (no hay 2022-2026 publicado ahi); ' +
      'es historico, no un feed en vivo de la semana actual. Pendiente de decision del cliente (pregunta abierta #11 del plan): ' +
      'si estos datos deben pasar por el pipeline narrativo de reescritura o mostrarse aparte como dashboard. ' +
      'maxItemsPerRun=20 (puesto el 2026-07-16 tras ver que 98 de 98 items scoreados en una corrida promediaron 0.40 ' +
      'de relevancia y ninguno llego al top-5) se saco el 2026-07-17: el filtro global de maxAgeDays=3 ' +
      '(OpenDataApiAdapter) ya deja esta fuente en 0 items por corrida, porque el dataset es de 2021 -- el problema ' +
      'de costo que motivo el 20 ya no aplica. Si el cliente confirma un dataset con datos recientes, esta fuente ' +
      'vuelve a usar el default global de 3 (mismo criterio que las demas).',
  },
  {
    institutionCode: 'INVIMA',
    name: 'INVIMA - Alertas Sanitarias',
    type: SourceType.HTML_SCRAPE,
    baseUrl: 'https://app.invima.gov.co',
    country: 'CO',
    fetchMethod: FetchMethod.HTTP_SIMPLE,
    isActive: true,
    config: {
      listingUrl: 'https://app.invima.gov.co/alertas/alertas-sanitarias-general',
      itemSelector: '.views-row',
      titleSelector: '.views-field-title .field-content',
      linkSelector: '.views-field-field-comunicado-invima a',
      dateSelector: '.views-field-field-a-o .field-content',
      docTypeSelector: '.views-field-field-tipo-de-documento .field-content',
      pagination: {
        nextPageSelector: '.pager-next a',
        maxPagesPerRun: 3,
      },
    },
    notes:
      'Verificado en vivo contra el HTML real (Drupal Views, sin JS). El enlace apunta a un PDF; ' +
      'HtmlScraperAdapter descarga y extrae el texto real del PDF con pdf-parse. Listado reverso-cronologico, ' +
      'paginado (~756 paginas de historico); maxPagesPerRun=3 cubre lo reciente, backfill historico es tarea aparte.',
  },
  {
    institutionCode: 'SUPERSALUD',
    name: 'Superintendencia Nacional de Salud',
    type: SourceType.HTML_SCRAPE,
    baseUrl: 'https://www.supersalud.gov.co',
    country: 'CO',
    fetchMethod: FetchMethod.HTTP_SIMPLE,
    isActive: false,
    config: {
      listingUrl: 'https://www.supersalud.gov.co/es-co/Paginas/noticias.aspx',
      itemSelector: PENDIENTE,
      titleSelector: PENDIENTE,
      linkSelector: PENDIENTE,
      dateSelector: PENDIENTE,
    },
    notes:
      'Recalibracion intentada 2026-07-16: la URL de listado original ya devuelve 404. El home ' +
      '(www.supersalud.gov.co) redirige con exito a /es-co/Paginas/Home.aspx, que enlaza a /es-co/noticias ' +
      '(HTTP 200) -- pero esa pagina no trae ningun item de noticia en el HTML servido, solo el menu de ' +
      'navegacion y datos de contacto: el listado real se carga por JS/AJAX que un fetch simple no ejecuta. ' +
      'Necesita inspeccion manual en navegador (DevTools -> Network) para encontrar el endpoint real que ' +
      'devuelve los items, o un fetcher headless (Playwright). Sigue PENDIENTE.',
  },
  {
    institutionCode: 'ADRES',
    name: 'ADRES',
    type: SourceType.HTML_SCRAPE,
    baseUrl: 'https://www.adres.gov.co',
    country: 'CO',
    fetchMethod: FetchMethod.HTTP_SIMPLE,
    isActive: true,
    config: {
      listingUrl: 'https://www.adres.gov.co/sala-de-prensa/noticias',
      itemSelector: '.list-item',
      titleSelector: '.title',
      linkSelector: 'a',
      dateSelector: '.date.fecha',
      detailImageSelector: '.ms-rtestate-field',
    },
    notes:
      'Verificado en vivo 2026-07-16 contra el HTML real (jplist widget, sin JS -- el listado inicial SI viene ' +
      'server-rendered, solo el filtro/paginado interactivo es JS). 33 items en la pagina, items reverso-' +
      'cronologico (mas reciente: 15/07/2026). El item completo esta envuelto en un unico <a>, por eso ' +
      'linkSelector="a" basta. Fecha en formato dd/mm/aaaa, la cubre parseFlexibleDate. Imagen del LISTADO no ' +
      'extraible (el sitio la pone como CSS background-image inline, no <img src>, y extractRowImageUrl solo lee ' +
      'atributo src) -- por eso imageSelector se deja sin configurar a proposito. detailImageSelector agregado ' +
      '2026-07-17: las paginas de detalle SharePoint no traen og:image, pero verificado contra 3 articulos reales ' +
      'que la primera <img> dentro de .ms-rtestate-field (el contenedor de texto enriquecido) es siempre la ' +
      'imagen real del articulo, nunca un icono/logo del sitio (esos quedan fuera de ese div). Sin paginacion ' +
      'configurada: la pagina no trae un link real de "siguiente" en el HTML estatico (el paginado es del widget ' +
      'jplist, JS).',
  },
  {
    institutionCode: 'CANCEROLOGIA',
    name: 'Instituto Nacional de Cancerologia',
    type: SourceType.HTML_SCRAPE,
    baseUrl: 'https://www.cancer.gov.co',
    country: 'CO',
    fetchMethod: FetchMethod.HEADLESS_BROWSER,
    isActive: false,
    config: {
      listingUrl: 'https://www.cancer.gov.co/medios-comunicacion-1/noticias-1',
      itemSelector: PENDIENTE,
      titleSelector: PENDIENTE,
      linkSelector: PENDIENTE,
      dateSelector: PENDIENTE,
    },
    notes:
      'Cloudflare bloquea fetch HTTP simple (403 confirmado, reconfirmado 2026-07-16) -- requiere ' +
      'HeadlessBrowserFetcher (Playwright), que no se pudo probar en esta calibracion (sin navegador headless ' +
      'disponible en el entorno). Su feed RSS declarado en <link rel="alternate"> (/tools/rss.php) esta ROTO: ' +
      'filtra codigo PHP sin ejecutar. NO USAR ese feed. Selectores de scraping pendientes de calibrar con un ' +
      'navegador real. Bajo volumen (~1 item/mes).',
  },
  {
    institutionCode: 'ICBF',
    name: 'Instituto Colombiano de Bienestar Familiar',
    type: SourceType.HTML_SCRAPE,
    baseUrl: 'https://www.icbf.gov.co',
    country: 'CO',
    fetchMethod: FetchMethod.HTTP_SIMPLE,
    isActive: false,
    config: {
      listingUrl: 'https://www.icbf.gov.co/noticias',
      itemSelector: PENDIENTE,
      titleSelector: PENDIENTE,
      linkSelector: PENDIENTE,
      dateSelector: PENDIENTE,
    },
    notes:
      'Drupal. El unico /rss.xml real que expone es de resoluciones de nombramientos (RRHH), no noticias -- no usar. ' +
      'Recalibracion intentada 2026-07-16: www.icbf.gov.co resuelve por DNS pero TODAS las conexiones HTTP ' +
      '(HTTP/1.1, IPv6, distintos User-Agent) hacen timeout completo -- el sitio parece bloquear trafico de ' +
      'datacenter/automatizado a nivel de red, no solo con un 403 aplicativo. Necesita probarse desde una IP ' +
      'residencial/oficina real o confirmar con el cliente si el sitio tiene alguna proteccion tipo firewall ' +
      'geografico. Selectores de scraping para /noticias siguen sin calibrar.',
  },
  {
    institutionCode: 'DANE',
    name: 'Departamento Administrativo Nacional de Estadistica',
    type: SourceType.HTML_SCRAPE,
    baseUrl: 'https://www.dane.gov.co',
    country: 'CO',
    fetchMethod: FetchMethod.HTTP_SIMPLE,
    isActive: false,
    config: {
      listingUrl: 'https://www.dane.gov.co/index.php/actualidad-dane',
      itemSelector: 'tr.cat-list-row0, tr.cat-list-row1',
      titleSelector: '.list-title a',
      linkSelector: '.list-title a',
      dateSelector: PENDIENTE,
    },
    notes:
      'Recalibrado 2026-07-16: Joomla, HTML servido sin JS. itemSelector/titleSelector/linkSelector SI ' +
      'verificados en vivo (tabla de noticias, filas tr.cat-list-row0/row1 alternadas). PERO el listado no ' +
      'trae fecha de publicacion en ninguna parte de la fila -- solo titulo+enlace. No se activa: inventar ' +
      'sourcePublishedAt (ej. usar la fecha de la corrida) violaria el principio de este pipeline de nunca ' +
      'fabricar procedencia. Para activar de verdad hace falta extender HtmlScraperAdapter para visitar la ' +
      'pagina de detalle de cada item (que si trae fecha) y leerla de ahi -- cambio de codigo, no de config, ' +
      'fuera del alcance de esta calibracion. La mayoria del contenido es institucional/estadistico, filtrar ' +
      'por relevancia de salud en ScoringModule cuando se active.',
  },
  {
    institutionCode: 'MINCIENCIAS',
    name: 'Ministerio de Ciencia, Tecnologia e Innovacion',
    type: SourceType.RSS,
    baseUrl: 'https://minciencias.gov.co',
    country: 'CO',
    fetchMethod: FetchMethod.HTTP_SIMPLE,
    isActive: true,
    config: {
      feedUrls: ['https://minciencias.gov.co/rss.xml'],
    },
    notes:
      'Feed RSS 2.0 verificado en vivo (HTTP 200, content-type application/rss+xml). Contenido general de ciencia/tecnologia; ' +
      'FilteringModule debe descartar lo no relacionado con salud.',
  },
  {
    institutionCode: 'SALUD_CAPITAL',
    name: 'Secretaria Distrital de Salud de Bogota (Salud Capital)',
    type: SourceType.RSS,
    baseUrl: 'https://www.saludcapital.gov.co',
    country: 'CO',
    fetchMethod: FetchMethod.HTTP_SIMPLE,
    isActive: true,
    config: {
      feedUrls: [
        'https://www.saludcapital.gov.co/_layouts/15/listfeed.aspx?List=%7B527F9964-24DB-431D-93C8-80FE99A0D34B%7D',
      ],
    },
    notes: 'Feed RSS de SharePoint (listfeed.aspx) verificado en vivo. Boletines epidemiologicos de SaluData no tienen feed (scraping aparte, pendiente).',
  },
  {
    institutionCode: 'DSSA',
    name: 'Direccion Seccional de Salud de Antioquia',
    type: SourceType.RSS,
    baseUrl: 'https://www.dssa.gov.co',
    country: 'CO',
    fetchMethod: FetchMethod.HTTP_SIMPLE,
    isActive: true,
    config: {
      feedUrls: ['https://www.dssa.gov.co/feed'],
    },
    notes:
      'WordPress, feed RSS 2.0 verificado en vivo. Es el feed de todo el sitio (no exclusivo de alertas) -- ' +
      'ScoringModule/FilteringModule deben filtrar por relevancia.',
  },

  // ---------- Internacional ----------
  {
    institutionCode: 'WHO',
    name: 'Organizacion Mundial de la Salud (OMS)',
    type: SourceType.RSS,
    baseUrl: 'https://www.who.int',
    country: 'INTL',
    fetchMethod: FetchMethod.HTTP_SIMPLE,
    isActive: true,
    config: {
      feedUrls: ['https://www.who.int/rss-feeds/news-english.xml'],
    },
    notes: 'Feed RSS verificado en vivo. Contenido en ingles -- ver pregunta abierta #12 (traduccion automatica) del plan.',
  },
  {
    institutionCode: 'PAHO',
    name: 'Organizacion Panamericana de la Salud (OPS)',
    type: SourceType.RSS,
    baseUrl: 'https://www.paho.org',
    country: 'INTL',
    fetchMethod: FetchMethod.HTTP_SIMPLE,
    isActive: true,
    config: {
      feedUrls: ['https://www.paho.org/en/rss.xml'],
    },
    notes: 'Feed RSS verificado en vivo (feed principal en ingles; PAHO tambien publica en espanol, confirmar si existe /es/rss.xml antes de duplicar fuente).',
  },
  {
    institutionCode: 'CDC',
    name: 'Centros para el Control y la Prevencion de Enfermedades (CDC)',
    type: SourceType.RSS,
    baseUrl: 'https://www.cdc.gov',
    country: 'INTL',
    fetchMethod: FetchMethod.HTTP_SIMPLE,
    isActive: true,
    config: {
      feedUrls: [
        'https://tools.cdc.gov/api/v2/resources/media/132608.rss',
        'https://tools.cdc.gov/api/v2/resources/media/413690.rss',
      ],
    },
    notes:
      'www.cdc.gov bloquea fetch automatizado (403, Akamai) -- se usa el subdominio tools.cdc.gov en su lugar. ' +
      'Dos feeds: newsroom (132608) y Health Alert Network / HAN Managed Feed (413690, verificado en vivo: RSS 2.0 ' +
      'valido, 0 items al momento de verificar -- las alertas HAN son eventos urgentes/raros, no contenido constante, ' +
      'asi que en corridas normales aporta cero ruido). ' +
      'REEMPLAZA a wwwnc.cdc.gov/travel/rss/notices.xml (avisos de viaje), retirado tras el incidente de agotamiento ' +
      'de credito del 2026-07-12: ese feed trajo ~1800 items historicos en una sola corrida y todos se encolaron a ' +
      'scoring con IA sin ningun tope. HAN es la seccion correcta de alertas sanitarias del CDC, no avisos de viaje.',
  },
  {
    institutionCode: 'NIH',
    name: 'Institutos Nacionales de Salud (NIH)',
    type: SourceType.RSS,
    baseUrl: 'https://www.nih.gov',
    country: 'INTL',
    fetchMethod: FetchMethod.HTTP_SIMPLE,
    isActive: true,
    config: {
      feedUrls: ['https://www.niehs.nih.gov/news/newsroom/rssfeed/rss_news.xml'],
    },
    notes:
      'www.nih.gov (el dominio raiz) sigue bloqueando fetch automatizado (403). Activado 2026-07-16 con el feed ' +
      'RSS real y verificado en vivo del NIEHS (National Institute of Environmental Health Sciences, un ' +
      'instituto de NIH) -- HTTP 200, RSS 2.0 valido, 225 items, lastBuildDate del mismo dia de la verificacion. ' +
      'baseUrl se deja en www.nih.gov (la institucion "NIH" del brief/whitelist) aunque el feed real vive en el ' +
      'subdominio del instituto -- mismo patron que CDC (tools.cdc.gov). Contenido de un instituto especifico ' +
      '(salud ambiental), no de todo NIH -- ScoringModule filtra por relevancia como con cualquier otra fuente.',
  },
];
