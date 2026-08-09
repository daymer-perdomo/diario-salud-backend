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

interface ProductFact {
  sku: string;
  name: string;
  labName: string | null;
  requiresPrescription: boolean;
  imageUrl: string | null;
  stockByBranch: Array<{ branch: string; quantity: number; price: number }>;
  /// Estado en la tienda WooCommerce real (ecofarma.co), cruzado por SKU
  /// contra la copia que sube el snippet de disponibilidad cada 15 min
  /// (ver WoocommerceCatalogService.findAvailabilityBySkus). `undefined`
  /// si ese SKU todavia no aparece en esa copia -- nunca se inventa el
  /// dato. Puede diferir de stockByBranch: un producto con stock fisico
  /// puede estar oculto/agotado en la tienda en linea (marcado desde el
  /// panel o directo en WordPress) y viceversa.
  onlineStore?: { visibleOnline: boolean; inStockOnline: boolean };
}

export interface ProductTableRow {
  sku: string;
  name: string;
  labName: string | null;
  price: number | null;
  stock: number;
  requiresPrescription: boolean;
  imageUrl: string;
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
    if (!term) return { query: null, products: [], wasCategoryMatch: false };

    // isCategoryQuery del LLM tambien limita a 3 (ademas del limite que ya
    // aplica InventoryService cuando calza por el diccionario de
    // sinonimos) -- mismo pedido del usuario 2026-07-29 de nunca mostrar
    // mas de 3 en una busqueda por categoria/sintoma, sin importar por
    // cual de las dos señales se detecto.
    const { products, wasCategoryMatch } = await this.inventory.searchProducts(term, intent.isCategoryQuery ? 3 : 5);
    const branchFilter = intent.branchQuery?.trim().toLowerCase();

    // Un solo lookup por lote (nunca uno por producto) contra la copia
    // local del catalogo de WooCommerce -- ver comentario de
    // ProductFact.onlineStore.
    const onlineAvailability = await this.woocommerce.findAvailabilityBySkus(products.map((p) => p.sku));

    const products_ = await Promise.all(
      products.map(async (product) => {
        let stockRows = product.stock;
        if (branchFilter) {
          const filtered = stockRows.filter((s) => s.branch.name.toLowerCase().includes(branchFilter));
          // Si el nombre de sucursal que dijo el cliente no matchea nada
          // (typo, sucursal que no existe), mejor mostrar todas las
          // sucursales que fingir que no hay stock en ninguna.
          if (filtered.length > 0) stockRows = filtered;
        }

        const totalStock = product.stock.reduce((sum, s) => sum + s.quantity, 0);
        const needsAlternatives = intent.intent === 'ALTERNATIVES' || totalStock === 0;
        const alternatives = needsAlternatives ? await this.inventory.findAlternatives(product.id, 3) : [];
        const online = onlineAvailability.get(product.sku);

        return {
          sku: product.sku,
          name: product.name,
          labName: product.labName,
          activeIngredient: product.activeIngredient,
          category: product.category,
          requiresPrescription: product.requiresPrescription,
          imageUrl: product.imageUrl,
          stockByBranch: stockRows.map((s) => ({ branch: s.branch.name, quantity: s.quantity, price: Number(s.price) })),
          ...(online ? { onlineStore: { visibleOnline: online.visibleOnline, inStockOnline: online.inStockOnline } } : {}),
          alternatives: alternatives.map((a) => ({
            sku: a.sku,
            name: a.name,
            requiresPrescription: a.requiresPrescription,
            stockByBranch: a.stock.map((s) => ({ branch: s.branch.name, quantity: s.quantity, price: Number(s.price) })),
          })),
        };
      }),
    );

    return { query: term, branchQuery: intent.branchQuery, products: products_, wasCategoryMatch };
  }

  /// Toma la PRIMERA fila de stockByBranch para precio/cantidad -- hoy
  /// solo existe una sucursal por producto (ver DistrimonacoSyncService),
  /// asi que esto es exacto. El dia que haya mas de una sucursal real por
  /// producto, esta funcion necesita una columna de sucursal ademas --
  /// deliberadamente no se construye esa UI todavia sin datos reales para
  /// probarla.
  private buildProductsTable(products: ProductFact[]): ProductTableRow[] {
    return products.map((p) => {
      const totalStock = p.stockByBranch.reduce((sum, s) => sum + s.quantity, 0);
      return {
        sku: p.sku,
        name: p.name,
        labName: p.labName,
        price: p.stockByBranch[0]?.price ?? null,
        stock: totalStock,
        requiresPrescription: p.requiresPrescription,
        imageUrl: p.imageUrl ?? DEFAULT_PRODUCT_IMAGE_URL,
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
