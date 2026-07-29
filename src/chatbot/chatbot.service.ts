import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChatMessageRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_SERVICE, LlmService } from '../llm/llm.service.interface';
import { ChatIntentOutput } from '../llm/schemas/chat-intent.schema';
import { InventoryService } from '../inventory/inventory.service';
import { checkRegexRules } from '../compliance/compliance-rules';

const HISTORY_TURNS = 6;

const MEDICAL_OFF_TOPIC_REPLY =
  'No puedo dar consejo médico, diagnósticos ni recomendaciones de dosis -- eso lo debe resolver un profesional de la salud. ' +
  'Si me dices el nombre de un producto, con gusto te digo si tenemos disponibilidad, precio o en qué sucursal encontrarlo.';

const GREETING_REPLY =
  '¡Hola! Soy el asistente de inventario de EcoFarma. Puedo ayudarte a consultar disponibilidad, precio o sucursal de un producto -- ¿cuál buscas?';

const SAFETY_FALLBACK_REPLY =
  'Prefiero no responder eso directamente -- te recomiendo confirmarlo con nuestro farmacéuta en sucursal.';

interface ProductFact {
  sku: string;
  name: string;
  labName: string | null;
  requiresPrescription: boolean;
  stockByBranch: Array<{ branch: string; quantity: number; price: number }>;
}

export interface ProductTableRow {
  sku: string;
  name: string;
  labName: string | null;
  price: number | null;
  stock: number;
  requiresPrescription: boolean;
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
      // Mas de un producto encontrado -> se muestran en tabla en vez de
      // texto (ver checkin con el usuario). La tabla sale directo de
      // `facts` (lookup determinista), NUNCA de lo que redacto el LLM --
      // mismo principio de todo el pipeline: el LLM no es fuente de
      // verdad de precio/stock.
      if (facts.products.length > 1) {
        products = this.buildProductsTable(facts.products);
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
    if (!term) return { query: null, products: [] };

    const products = await this.inventory.searchProducts(term, 5);
    const branchFilter = intent.branchQuery?.trim().toLowerCase();

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

        return {
          sku: product.sku,
          name: product.name,
          labName: product.labName,
          activeIngredient: product.activeIngredient,
          category: product.category,
          requiresPrescription: product.requiresPrescription,
          stockByBranch: stockRows.map((s) => ({ branch: s.branch.name, quantity: s.quantity, price: Number(s.price) })),
          alternatives: alternatives.map((a) => ({
            sku: a.sku,
            name: a.name,
            requiresPrescription: a.requiresPrescription,
            stockByBranch: a.stock.map((s) => ({ branch: s.branch.name, quantity: s.quantity, price: Number(s.price) })),
          })),
        };
      }),
    );

    return { query: term, branchQuery: intent.branchQuery, products: products_ };
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
