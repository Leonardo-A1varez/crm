import { NotFoundError } from "@/lib/errors";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import type { AgentConfigProvider } from "@/server/services/agente/config-provider";
import type { AgentLLM, AgentTools } from "@/server/services/ai-agent.service";
import type { CatalogMatcherService } from "@/server/services/catalog-matcher.service";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { AgenteConfigValores } from "@/types/agente";
import type { Mensaje, UUID } from "@/types/entities";

/**
 * Preview de una config candidata (Task 11, spec §7): corre el agente con
 * valores que TODAVÍA no se guardaron, contra el historial real de una
 * sesión cerrada, y devuelve la respuesta candidata junto a la que el
 * agente dio de verdad en esa sesión.
 *
 * No pasa por `DefaultAiAgentService.respond()` a propósito: ese método
 * rechaza sesiones cerradas (`resultado !== null`) con `ConflictError`, y
 * las sesiones que tiene sentido previsualizar son justamente esas — ya
 * terminaron, con una respuesta real para comparar. Tampoco corre el rule
 * engine: el preview prueba la CONFIG (modelo, prompt, estilo), no las
 * reglas, así que ir directo a `AgentLLM.generate()` es lo correcto, no un
 * atajo.
 */
export interface PrevisualizarInput {
  valores: AgenteConfigValores;
  leadSessionId: UUID;
}

export interface PrevisualizarResult {
  respuesta: string;
  /** Null si la sesión no tiene ninguna respuesta saliente de la IA registrada. */
  respuestaOriginal: string | null;
}

export interface AgentePreviewService {
  previsualizar(input: PrevisualizarInput): Promise<PrevisualizarResult>;
}

// Piso de historial a leer para ubicar la última respuesta saliente,
// independiente de `ventana_contexto_mensajes` de la config candidata (tope
// 40 en el schema): la respuesta real puede quedar antes de esa ventana.
const MIN_HISTORIAL = 50;

export class DefaultAgentePreviewService implements AgentePreviewService {
  constructor(
    private readonly sessions: LeadSessionRepository,
    private readonly messages: MessagesRepository,
    private readonly catalog: CatalogMatcherService,
    // Fábrica, no instancia: la config candidata cambia en cada llamada, así
    // que el `AgentLLM` (con su `StaticAgentConfigProvider`) se arma acá
    // adentro, no una sola vez al bootstrapear el service.
    private readonly makeLlm: (configProvider: AgentConfigProvider) => AgentLLM,
  ) {}

  async previsualizar(input: PrevisualizarInput): Promise<PrevisualizarResult> {
    const session = await this.sessions.findById(input.leadSessionId);
    if (!session) {
      throw new NotFoundError(
        `sesión no encontrada: ${input.leadSessionId}`,
        "lead_session",
        input.leadSessionId,
      );
    }

    const historial = await this.messages.listBySessionId(session.id, {
      limit: Math.max(MIN_HISTORIAL, input.valores.ventana_contexto_mensajes),
    });

    const conversationTurn = formatearTurno(
      historial,
      session.context_summary,
      input.valores.ventana_contexto_mensajes,
    );
    const respuestaOriginal = ultimaRespuestaSaliente(historial);

    const tools: AgentTools = {
      // Lectura real de catálogo (sin side effects): así el preview mide lo
      // mismo que produción mediría si la IA decide buscar un repuesto, en
      // vez de una respuesta simulada que le restaría fidelidad al preview.
      buscar_repuesto: (args) => this.catalog.buscar(args),
    };

    const llm = this.makeLlm(new StaticAgentConfigProvider(input.valores));
    const result = await llm.generate({
      session,
      conversationTurn,
      // El preview no vuelve a correr el clasificador de intent: sería una
      // segunda llamada LLM sin registrar en el cost tracker, el mismo
      // agujero de gasto que el brief pide evitar para el turno principal.
      // La clasificación solo viaja como contexto informativo del prompt
      // (no cambia modelo ni instrucciones, eso lo decide `configProvider`),
      // así que un valor neutro no le resta fidelidad a lo que se prueba.
      classification: { intent_nombre: null, confidence: 0 },
      tools,
    });

    return { respuesta: result.text, respuestaOriginal };
  }
}

/** Mismo criterio que `buildConversationTurn` en `on-message-received.ts`. */
function formatearTurno(
  mensajes: Mensaje[],
  contextSummary: string | null,
  ventana: number,
): string[] {
  const recientes = mensajes.slice(-ventana).map((m) => `${m.sender}: ${m.contenido ?? ""}`);
  if (contextSummary) return [`[Resumen previo]: ${contextSummary}`, ...recientes];
  return recientes;
}

/** Último saliente de la IA (no de un humano en handoff), de más nuevo a más viejo. */
function ultimaRespuestaSaliente(mensajes: Mensaje[]): string | null {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i];
    if (m !== undefined && m.direction === "out" && m.sender === "ia") return m.contenido;
  }
  return null;
}
