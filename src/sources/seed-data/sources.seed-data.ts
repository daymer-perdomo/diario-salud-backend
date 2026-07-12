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
      'SharePoint. URL de listado confirmada reachable; selectores CSS pendientes de calibrar contra el HTML real antes de activar.',
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
      'si estos datos deben pasar por el pipeline narrativo de reescritura o mostrarse aparte como dashboard.',
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
    notes: 'SharePoint. Selectores pendientes de calibrar antes de activar.',
  },
  {
    institutionCode: 'ADRES',
    name: 'ADRES',
    type: SourceType.HTML_SCRAPE,
    baseUrl: 'https://www.adres.gov.co',
    country: 'CO',
    fetchMethod: FetchMethod.HTTP_SIMPLE,
    isActive: false,
    config: {
      listingUrl: 'https://www.adres.gov.co/sala-de-prensa/noticias',
      itemSelector: PENDIENTE,
      titleSelector: PENDIENTE,
      linkSelector: PENDIENTE,
      dateSelector: PENDIENTE,
    },
    notes: 'Selectores pendientes de calibrar antes de activar.',
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
      'Cloudflare bloquea fetch HTTP simple (403 confirmado) -- requiere HeadlessBrowserFetcher (Playwright). ' +
      'Su feed RSS declarado en <link rel="alternate"> (/tools/rss.php) esta ROTO: filtra codigo PHP sin ejecutar. NO USAR ese feed. ' +
      'Selectores de scraping pendientes de calibrar. Bajo volumen (~1 item/mes).',
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
      'Selectores de scraping para /noticias pendientes de calibrar.',
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
      itemSelector: PENDIENTE,
      titleSelector: PENDIENTE,
      linkSelector: PENDIENTE,
      dateSelector: PENDIENTE,
    },
    notes: 'Selectores pendientes de calibrar. La mayoria del contenido es institucional/estadistico, filtrar por relevancia de salud en ScoringModule.',
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
        'https://wwwnc.cdc.gov/travel/rss/notices.xml',
      ],
    },
    notes:
      'www.cdc.gov bloquea fetch automatizado (403, Akamai) -- se usan los subdominios tools.cdc.gov (newsroom) ' +
      'y wwwnc.cdc.gov (avisos de viaje/brotes) en su lugar, ambos verificados en vivo (el content-type de este ultimo esta mal ' +
      'etiquetado como text/html pero el cuerpo es RSS 2.0 valido).',
  },
  {
    institutionCode: 'NIH',
    name: 'Institutos Nacionales de Salud (NIH)',
    type: SourceType.RSS,
    baseUrl: 'https://www.nih.gov',
    country: 'INTL',
    fetchMethod: FetchMethod.HTTP_SIMPLE,
    isActive: false,
    config: {
      feedUrls: [],
    },
    notes:
      'www.nih.gov bloquea fetch automatizado (403). Los subdominios de institutos individuales (ej. niehs.nih.gov) ' +
      'si son alcanzables, pero su URL exacta de feed RSS no fue verificada en vivo -- no se hardcodea sin confirmar. ' +
      'Activar solo tras verificar un feedUrl real de un instituto especifico.',
  },
];
