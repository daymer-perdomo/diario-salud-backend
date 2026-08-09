import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChatMessageRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_SERVICE, LlmService } from '../llm/llm.service.interface';
import { ChatIntentOutput } from '../llm/schemas/chat-intent.schema';
import { InventoryService } from '../inventory/inventory.service';
import { WoocommerceCatalogService } from '../inventory/woocommerce-catalog.service';
import { checkRegexRules } from '../compliance/compliance-rules';
import { DEFAULT_PRODUCT_IMAGE_URL } from '../common/default-product-image.util';

const HISTORY_TURNS = 6;

/// Techo TECNICO, no una regla de negocio -- pedido explicito del usuario
/// 2026-08-09: "quita el limite que tenemos de mostrar, muestra lo que
/// encuentre" (antes: 3 resultados para busquedas por categoria, 5 para
/// las demas). Este numero solo evita mandarle al LLM un JSON de cientos
/// de productos (costo/latencia) y un carrusel inutilizable si un termino
/// resulta demasiado generico -- en la practica, una busqueda real de
/// farmacia rara vez encuentra mas de esto.
const SEARCH_RESULTS_LIMIT = 30;

const MEDICAL_OFF_TOPIC_REPLY =
  'No puedo dar consejo médico, diagnósticos ni recomendaciones de dosis -- eso lo debe resolver un profesional de la salud. ' +
  'Si me dices el nombre de un producto, con gusto te digo si tenemos disponibilidad, precio o en qué sucursal encontrarlo.';

const GREETING_REPLY =
  '¡Hola! Soy el asistente de inventario de EcoFarma. Puedo ayudarte a consultar disponibilidad, precio o sucursal de un producto -- ¿cuál buscas?';

const SAFETY_FALLBACK_REPLY =
  'Prefiero no responder eso directamente -- te recomiendo confirmarlo con nuestro farmacéuta en sucursal.';

/// Se agrega SIEMPRE (nunca queda a criterio del LLM) cuando el cliente
/// pregunto por una categoria/sintoma (ej. "para los pies", "para
/// hongos") y se le muestran productos -- pedido explicito del usuario
/// 2026-07-29: "no debe formular... siempre le decimos al usuario que
/// esto no es una formulacion, son los productos que tenemos".
const CATEGORY_SEARCH_DISCLAIMER =
  '\n\nEsto no es una formulación médica -- son los productos que tenemos disponibles para esa categoría. ' +
  'Si necesitas una formulación o recomendación de tratamiento, consulta a tu médico.';

/// 2026-08-09: WooCommerce (~42,000 productos, ecofarma.co real) paso a ser
/// la fuente PRIMARIA de nombre/precio/disponibilidad del chatbot -- pedido
/// explicito del usuario, antes buscaba primero en Distrimonaco (~7,000) y
/// solo cruzaba WooCommerce como verificacion secundaria. Distrimonaco ahora
/// es el enriquecimiento: si el SKU tambien existe ahi (activo, no oculto),
/// se completa con stock fisico por sucursal, si requiere receta y
/// alternativas por principio activo -- ninguno de esos tres datos existe en
/// WooCommerce.
///
/// 2026-08-09 (2da vuelta): `id` (el id numerico real del producto en
/// WooCommerce) se agrega para que el widget pueda agregarlo directo al
/// carrito NATIVO de WooCommerce (ver public/widget/chatbot.js,
/// addToWooCommerceCart) -- ya no existe un carrito propio del chat
/// (ChatCartService/OrderRequest, eliminados). `canOrder` queda como dato
/// informativo (si hay o no cruce con Distrimonaco, para stock fisico/
/// receta/alternativas) pero YA NO decide si se puede comprar: con el
/// carrito nativo, cualquier producto con `id` de WooCommerce se puede
/// agregar, tenga o no contraparte en Distrimonaco.
interface ProductFact {
  id: number;
  sku: string;
  name: string;
  price: number | null;
  permalink: string;
  imageUrl: string | null;
  visibleOnline: boolean;
  inStockOnline: boolean;
  canOrder: boolean;
  /// null = el SKU no esta en el catalogo interno de Distrimonaco, asi que
  /// no se pudo confirmar -- el prompt debe pedir que se confirme en vez de
  /// asumir que no requiere receta.
  requiresPrescription: boolean | null;
  labName: string | null;
  stockByBranch: Array<{ branch: string; quantity: number }>;
  alternatives: Array<{
    sku: string;
    name: string;
    price: number | null;
    requiresPrescription: boolean;
    stockByBranch: Array<{ branch: string; quantity: number }>;
  }>;
}

export interface ProductTableRow {
  id: number;
  sku: string;
  name: string;
  labName: string | null;
  price: number | null;
  stock: number;
  requiresPrescription: boolean | null;
  imageUrl: string;
  permalink: string;
  /// Informativo (hay o no cruce con Distrimonaco) -- ya NO decide si se
  /// puede agregar al carrito, ver comentario de ProductFact.
  canOrder: boolean;
}

/// Orquesta el pipeline de 3 pasos del plan (kind-giggling-cerf.md):
/// extractChatIntent (LLM) -> lookup determinista en InventoryService ->
/// composeChatReply (LLM). El LLM nunca toca Prisma directamente y nunca
/// es la fuente de verdad de stock/precio -- solo clasifica y redacta.
@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_SERVICE) private readonly llm: LlmService,
    private readonly inventory: InventoryService,
    private readonly woocommerce: WoocommerceCatalogService,
  ) {}

  async handleMessage(params: { conversationId?: string; message: string; ipHash: string }) {
    const session = await this.getOrCreateSession(params.conversationId, params.ipHash);

    const previousMessages = await this.prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TURNS,
    });
    const history = previousMessages.reverse().map((m) => ({ role: m.role, content: m.content }));

    await this.prisma.chatMessage.create({
      data: { sessionId: session.id, role: ChatMessageRole.USER, content: params.message },
    });

    const intent = await this.llm.extractChatIntent({ message: params.message, history });

    let reply: string;
    let products: ProductTableRow[] | undefined;
    if (intent.intent === 'MEDICAL_OFF_TOPIC') {
      // Corte determinista, sin llamar a composeChatReply -- ni el costo
      // ni el riesgo de una segunda llamada a IA se justifican cuando la
      // respuesta correcta es siempre la misma (ver plan: "ahorra costo y
      // elimina el riesgo").
      reply = MEDICAL_OFF_TOPIC_REPLY;
    } else if (intent.intent === 'OTHER') {
      reply = GREETING_REPLY;
    } else {
      const facts = await this.gatherFacts(intent);
      const composed = await this.llm.composeChatReply({ message: params.message, facts });
      reply = this.applySafetyGuard(composed.reply);
      // Cualquier producto encontrado se manda como datos estructurados
      // (1-2 -> tarjetas con imagen, 3+ -> tabla, ver renderProductsCards/
      // renderProductsTable en el widget) en vez de solo texto (ver
      // checkin con el usuario). Sale directo de `facts` (lookup
      // determinista), NUNCA de lo que redacto el LLM -- mismo principio
      // de todo el pipeline: el LLM no es fuente de verdad de precio/stock.
      if (facts.products.length >= 1) {
        products = this.buildProductsTable(facts.products);
      }
      // Determinista, no queda a criterio del LLM (ver comentario de
      // CATEGORY_SEARCH_DISCLAIMER). Dos señales, cualquiera basta: el
      // clasificador de intencion dijo que la pregunta es por
      // categoria/sintoma (intent.isCategoryQuery, ej. "gripa" que
      // matchea por texto literal sin pasar por el diccionario) O la
      // busqueda calzo por el diccionario de sinonimos (wasCategoryMatch,
      // ej. "hongos" -> Clotrimazol). Solo aplica si ademas se encontro
      // algo que mostrar.
      if ((intent.isCategoryQuery || facts.wasCategoryMatch) && facts.products.length > 0) {
        reply += CATEGORY_SEARCH_DISCLAIMER;
      }
    }

    await this.prisma.chatMessage.create({
      data: { sessionId: session.id, role: ChatMessageRole.ASSISTANT, content: reply, intentJson: intent },
    });
    await this.prisma.chatSession.update({ where: { id: session.id }, data: { lastMessageAt: new Date() } });

    return { conversationId: session.id, reply, products };
  }

  private async getOrCreateSession(conversationId: string | undefined, ipHash: string) {
    if (conversationId) {
      const existing = await this.prisma.chatSession.findUnique({ where: { id: conversationId } });
      if (existing) return existing;
    }
    return this.prisma.chatSession.create({ data: { ipHash } });
  }

  private async gatherFacts(intent: ChatIntentOutput) {
    const term = intent.productQuery?.trim();
    if (!term) return { query: null, correctedFrom: null, products: [], wasCategoryMatch: false };

    // La expansion de sinonimos/categoria (ej. "hongos" -> "clotrimazol")
    // sigue viviendo en InventoryService -- es independiente de que tabla se
    // busque. isCategoryQuery del LLM y wasCategoryMatch del diccionario
    // siguen usandose para el aviso de "no es una formulacion medica" (ver
    // CATEGORY_SEARCH_DISCLAIMER en handleMessage) -- ya NO capan cuantos
    // resultados se muestran (ver SEARCH_RESULTS_LIMIT).
    const relatedTerms = await this.inventory.resolveSynonyms(term);
    const wasCategoryMatch = relatedTerms.length > 0;

    // Busqueda PRIMARIA contra WooCommerce (~42,000 productos reales de la
    // tienda) -- ver comentario de ProductFact.
    let matches = await this.woocommerce.searchByTerms([term, ...relatedTerms], SEARCH_RESULTS_LIMIT);

    // Correccion por IA: SOLO cuando la busqueda literal (termino + sinonimos
    // del diccionario) no encontro nada -- pedido explicito del usuario
    // 2026-08-09 ("busque condones y no encontro, en realidad si tenemos").
    // El LLM nunca decide que hay en stock, solo propone terminos
    // alternativos para reintentar la MISMA busqueda deterministica --
    // mismo principio de todo el pipeline. Si el termino corregido tampoco
    // encuentra nada, se deja vacio (no se inventa un resultado).
    let correctedFrom: string | null = null;
    if (matches.length === 0) {
      const suggestion = await this.llm.suggestAlternativeSearchTerms({ query: term });
      if (suggestion.alternativeTerms.length > 0) {
        matches = await this.woocommerce.searchByTerms(suggestion.alternativeTerms, SEARCH_RESULTS_LIMIT);
        if (matches.length > 0) correctedFrom = term;
      }
    }

    const branchFilter = intent.branchQuery?.trim().toLowerCase();

    // Cruce por SKU exacto contra Distrimonaco, un lookup por match (a lo
    // sumo `take` <= 5, mismo orden de magnitud que antes). isActive/
    // hiddenFromCatalog se revisan a mano: findBySku no los filtra (a
    // diferencia de InventoryService.searchProducts, pensado para busqueda
    // directa, no para listar).
    const enriched = await Promise.all(
      matches.map(async (match) => {
        const raw = await this.inventory.findBySku(match.sku);
        const crossRef = raw && raw.isActive && !raw.hiddenFromCatalog ? raw : null;
        return { match, crossRef };
      }),
    );

    // Alternativas necesitan activeIngredient (solo Distrimonaco lo tiene),
    // asi que solo se calculan cuando hay cruce -- y solo si hace falta
    // (pedido explicito de alternativas, o el producto no esta disponible
    // para comprar en linea ahora mismo).
    const altsByProduct = await Promise.all(
      enriched.map(async ({ match, crossRef }) => {
        if (!crossRef) return [];
        const needsAlternatives = intent.intent === 'ALTERNATIVES' || match.stockStatus !== 'instock';
        if (!needsAlternatives) return [];
        return this.inventory.findAlternatives(crossRef.id, 3);
      }),
    );

    // Un solo lote (nunca una consulta por alternativa) para completar
    // precio/estado real de WooCommerce de TODAS las alternativas de TODOS
    // los productos a la vez -- mismo precio unico de verdad que el
    // producto principal, nunca el de Distrimonaco.
    const altSkus = altsByProduct.flat().map((a) => a.sku);
    const altsOnline = await this.woocommerce.findBySkus(altSkus);

    const products_ = enriched.map(({ match, crossRef }, idx) => {
      let stockByBranch: Array<{ branch: string; quantity: number }> = [];
      if (crossRef) {
        let stockRows = crossRef.stock;
        if (branchFilter) {
          const filtered = stockRows.filter((s) => s.branch.name.toLowerCase().includes(branchFilter));
          // Si el nombre de sucursal que dijo el cliente no matchea nada
          // (typo, sucursal que no existe), mejor mostrar todas las
          // sucursales que fingir que no hay stock en ninguna.
          if (filtered.length > 0) stockRows = filtered;
        }
        stockByBranch = stockRows.map((s) => ({ branch: s.branch.name, quantity: s.quantity }));
      }

      return {
        id: match.id,
        sku: match.sku,
        name: match.name,
        price: match.price,
        permalink: match.permalink,
        imageUrl: match.image,
        visibleOnline: match.catalogVisibility === 'visible',
        inStockOnline: match.stockStatus === 'instock',
        canOrder: !!crossRef,
        requiresPrescription: crossRef ? crossRef.requiresPrescription : null,
        labName: crossRef?.labName ?? null,
        stockByBranch,
        alternatives: altsByProduct[idx].map((a) => {
          const online = altsOnline.get(a.sku);
          return {
            sku: a.sku,
            name: a.name,
            price: online?.price ?? null,
            requiresPrescription: a.requiresPrescription,
            stockByBranch: a.stock.map((s) => ({ branch: s.branch.name, quantity: s.quantity })),
          };
        }),
      };
    });

    return { query: term, correctedFrom, branchQuery: intent.branchQuery, products: products_, wasCategoryMatch };
  }

  /// El precio siempre sale de WooCommerce (p.price, fuente unica -- ver
  /// comentario de ProductFact), nunca de Distrimonaco. `stock` es la
  /// cantidad fisica total (Distrimonaco) -- solo informativa (stock por
  /// sucursal para retiro fisico/receta), no limita si se puede agregar al
  /// carrito nativo de WooCommerce (eso solo depende de `id`).
  private buildProductsTable(products: ProductFact[]): ProductTableRow[] {
    return products.map((p) => {
      const totalStock = p.stockByBranch.reduce((sum, s) => sum + s.quantity, 0);
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        labName: p.labName,
        price: p.price,
        stock: totalStock,
        requiresPrescription: p.requiresPrescription,
        imageUrl: p.imageUrl ?? DEFAULT_PRODUCT_IMAGE_URL,
        permalink: p.permalink,
        canOrder: p.canOrder,
      };
    });
  }

  /// Ultima linea de defensa antes de mostrarle algo al cliente: las
  /// mismas reglas deterministas que ya usa el pipeline editorial
  /// (compliance-rules.ts) -- si el LLM redacto algo que se lee como
  /// dosificacion/incitacion a compra/recomendacion terapeutica pese a
  /// las instrucciones del prompt, se descarta y se manda un mensaje fijo
  /// en vez de arriesgarse a mostrarlo.
  private applySafetyGuard(reply: string): string {
    const violations = checkRegexRules('', reply);
    if (violations.length > 0) {
      this.logger.warn(`Respuesta del chatbot bloqueada por reglas deterministas: ${violations.map((v) => v.rule).join(', ')}`);
      return SAFETY_FALLBACK_REPLY;
    }
    return reply;
  }
}
