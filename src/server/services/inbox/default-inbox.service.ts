import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { pesoMotivo, triage } from "@/lib/triage";
import type { EntradaTriage } from "@/lib/triage";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { LlmUsageRepository } from "@/server/repositories/llm-usage.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { ProductsRepository } from "@/server/repositories/productos.repo";
import type { TagsRepository } from "@/server/repositories/tags.repo";
import type { HandoffService } from "@/server/services/handoff.service";
import type { MetaApiService } from "@/server/services/meta-api.service";
import { WORKFLOW_LLM } from "@/types/domain";
import type { Canal } from "@/types/domain";
import type { Conversacion, LeadSession, Mensaje, Producto, Tag, UUID } from "@/types/entities";
import type { GastoSesion, SesionesPrevias } from "@/types/inbox";
import type {
  CloseSessionServiceInput,
  ConversationView,
  EditarCampoTwinServiceInput,
  InboxItem,
  InboxService,
  SendMessageServiceInput,
  ToggleHandoffServiceInput,
} from "./inbox.service";

// Cap thread: sesiones cortas (5-15 msgs); 200 cubre outliers sin paginar.
const CONVERSATION_MESSAGES_LIMIT = 200;

// Para contar lo que quedó sin responder alcanza con la cola del hilo: solo se
// miran los mensajes posteriores a la última respuesta nuestra.
const TRIAGE_MESSAGES_LIMIT = 50;

/**
 * Mensajes entrantes posteriores a la última respuesta nuestra.
 *
 * `sistema` se descarta a propósito aunque sea `out`: "sesión reasignada" no
 * es contestarle al cliente, y contarlo como respuesta apagaría el triage de
 * una conversación que sigue esperando.
 */
function calcularSinResponder(mensajes: Mensaje[]): {
  sinResponder: number;
  esperandoDesde: Date | null;
} {
  const pendientes: Mensaje[] = [];
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i];
    if (!m) continue;
    if (m.direction === "out" && m.sender !== "sistema") break;
    if (m.direction === "in") pendientes.push(m);
  }
  const primero = pendientes[pendientes.length - 1];
  return { sinResponder: pendientes.length, esperandoDesde: primero?.created_at ?? null };
}

/** El triage mira solo la sesión, así que contar no obliga a leer hilos. */
function entradaTriage(session: LeadSession): EntradaTriage {
  return {
    stage: session.current_stage,
    iaPausada: session.ia_pausada,
    bloqueador: session.bloqueador,
    comprobantePagoUrl: session.comprobante_pago_url,
  };
}

export interface DefaultInboxServiceDeps {
  leads: LeadsRepository;
  sessions: LeadSessionRepository;
  convs: ConversationsRepository;
  messages: MessagesRepository;
  metaApi: MetaApiService;
  handoff: HandoffService;
  /** Para resolver `producto_cotizado_id` al producto del catálogo del Twin. */
  productos: ProductsRepository;
  tags: TagsRepository;
  /** Gasto del modelo por sesión: el "cuánto va costando" del panel del Twin. */
  llmUsage: LlmUsageRepository;
}

export class DefaultInboxService implements InboxService {
  constructor(private readonly deps: DefaultInboxServiceDeps) {}

  async contarRequierenAtencion(): Promise<number> {
    const activeSessions = await this.deps.sessions.listActive();
    return activeSessions.filter((s) => triage(entradaTriage(s)).motivo !== null).length;
  }

  async listActiveLeads(): Promise<InboxItem[]> {
    const activeSessions = await this.deps.sessions.listActive();

    const items: InboxItem[] = [];
    for (const session of activeSessions) {
      const lead = await this.deps.leads.findById(session.lead_id);
      if (!lead) continue;

      const convs = await this.deps.convs.findByLeadId(session.lead_id);
      const canales: Canal[] = Array.from(new Set(convs.map((c) => c.canal)));

      let lastMsg: Mensaje | null = null;
      let canalActivo: Canal | null = null;
      for (const conv of convs) {
        const msgs = await this.deps.messages.listByConversacion(conv.id, { limit: 1 });
        const candidate = msgs[0];
        if (!candidate) continue;
        if (!lastMsg || candidate.created_at.getTime() > lastMsg.created_at.getTime()) {
          lastMsg = candidate;
          // El canal del último mensaje, no `canales[0]`: `canales` es un set
          // sin orden significativo y la bandeja lo mostraba como si lo fuera.
          canalActivo = conv.canal;
        }
      }

      const ultimaActividad =
        lastMsg?.created_at ?? convs[0]?.ultima_actividad_at ?? session.started_at;

      const thread = await this.deps.messages.listBySessionId(session.id, {
        limit: TRIAGE_MESSAGES_LIMIT,
      });
      const { sinResponder, esperandoDesde } = calcularSinResponder(thread);
      const { motivo } = triage(entradaTriage(session));

      items.push({
        leadId: lead.id,
        sessionId: session.id,
        nombre: lead.nombre,
        currentStage: session.current_stage,
        iaPausada: session.ia_pausada,
        ultimaActividad,
        ultimoMensaje: lastMsg
          ? {
              body: lastMsg.contenido ?? "",
              direction: lastMsg.direction,
              createdAt: lastMsg.created_at,
            }
          : null,
        canales,
        canalActivo: canalActivo ?? canales[0] ?? null,
        sinResponder,
        esperandoDesde,
        urgencia: session.urgencia,
        motivo,
      });
    }

    // Triage primero y recencia después: una conversación escalada hace 3 horas
    // importa más que un "gracias" de hace 2 minutos. Dentro de cada motivo se
    // mantiene el orden cronológico de siempre.
    items.sort(
      (a, b) =>
        pesoMotivo(a.motivo) - pesoMotivo(b.motivo) ||
        b.ultimaActividad.getTime() - a.ultimaActividad.getTime(),
    );
    return items;
  }

  async getConversation(leadId: UUID): Promise<ConversationView> {
    const lead = await this.deps.leads.findById(leadId);
    if (!lead) {
      throw new NotFoundError(`lead no encontrado: ${leadId}`, "lead", leadId);
    }

    const session = await this.deps.sessions.findActiveByLeadId(leadId);
    const convs = await this.deps.convs.findByLeadId(leadId);
    const canales: Canal[] = Array.from(new Set(convs.map((c) => c.canal)));

    let masReciente: Conversacion | null = null;
    for (const conv of convs) {
      if (
        !masReciente ||
        conv.ultima_actividad_at.getTime() > masReciente.ultima_actividad_at.getTime()
      ) {
        masReciente = conv;
      }
    }
    const canalActivo: Canal = masReciente?.canal ?? lead.canal_origen;

    const messages = session
      ? await this.deps.messages.listBySessionId(session.id, {
          limit: CONVERSATION_MESSAGES_LIMIT,
        })
      : [];

    const producto = await this.resolverProducto(session);
    const tags = await this.deps.tags.listByLead(leadId);
    const sesionesPrevias = await this.contarSesionesPrevias(leadId, session);
    const gastoIa = await this.resolverGastoIa(session);

    return {
      lead,
      session,
      messages,
      canales,
      canalActivo,
      producto,
      // Solo lo que el chip necesita: `AssignedTag` arrastra `assigned_by` y
      // `source`, que son de la capa de repos y no cruzan a components.
      tags: tags.map(
        (t): Tag => ({
          id: t.id,
          nombre: t.nombre,
          color: t.color,
          descripcion: t.descripcion,
        }),
      ),
      sesionesPrevias,
      gastoIa,
    };
  }

  /**
   * Cuánto costó esta conversación, o por qué no se puede decir.
   *
   * Las filas de `llm_usage` se suman por sesión: ahí está el gasto del agente,
   * el del clasificador de intents, el del extractor del Twin y el del
   * resumidor, que son las llamadas que un turno dispara. (El detector batch de
   * intents no entra: corre sobre muchas sesiones a la vez y no le pertenece a
   * ninguna, así que su fila va sin `lead_session_id`.)
   *
   * El preview de la consola sí queda afuera y a mano: replaya una sesión real
   * para probar una config candidata, así que sus filas llevan el id de esta
   * sesión aunque no le hayan mandado ni un mensaje al cliente. Sumarlo haría
   * que un lead se volviera "caro" porque un admin estuvo probando prompts.
   * Sigue contando en Métricas, con su propia franja.
   *
   * Cuando no hay ninguna fila hay que elegir entre dos respuestas opuestas, y
   * la frontera la marca la primera llamada anotada de la historia: si la
   * sesión empezó después, el registro ya estaba andando y el cero es real —la
   * conversación se resolvió con reglas, o la atendió una persona—; si empezó
   * antes, lo único honesto es decir que no hay dato. Con la tabla vacía no hay
   * frontera y todo cae en "sin registro", que es exactamente lo que se sabe.
   *
   * El caso de borde de la purga: a los 29 días el cron borra las sesiones
   * cerradas y las filas de gasto quedan con `lead_session_id` en NULL. Esa
   * conversación ya no se puede abrir, así que nadie ve el gasto huérfano acá
   * —sigue contando en Métricas, que es donde importa que no se pierda.
   */
  private async resolverGastoIa(session: LeadSession | null): Promise<GastoSesion | null> {
    if (!session) return null;

    const [resumen, primerRegistro] = await Promise.all([
      this.deps.llmUsage.resumenPorLeadSession(session.id, {
        excluirWorkflows: [WORKFLOW_LLM.agentePreview],
      }),
      this.deps.llmUsage.primerRegistroAt(),
    ]);

    if (resumen.llamadas > 0) {
      return { estado: "medido", usd: resumen.usd, llamadas: resumen.llamadas };
    }
    if (primerRegistro && session.started_at.getTime() >= primerRegistro.getTime()) {
      return { estado: "sin_gasto" };
    }
    return { estado: "sin_registro" };
  }

  /**
   * El producto que la sesión cotizó. Devuelve `null` en vez de romper si el
   * id apunta a una fila que ya no está: el catálogo se puede editar y el Twin
   * de una sesión vieja no puede dejar de abrir por eso.
   */
  private async resolverProducto(session: LeadSession | null): Promise<Producto | null> {
    if (!session?.producto_cotizado_id) return null;
    return this.deps.productos.findById(session.producto_cotizado_id);
  }

  /**
   * Sesiones anteriores del lead. La abierta se excluye: el bloque cuenta lo
   * que pasó antes de esta conversación, no la que se está mirando.
   */
  private async contarSesionesPrevias(
    leadId: UUID,
    actual: LeadSession | null,
  ): Promise<SesionesPrevias> {
    const todas = await this.deps.sessions.listByLeadId(leadId);
    const previas = todas.filter((s) => s.id !== actual?.id);
    return {
      total: previas.length,
      conCompra: previas.filter((s) => s.resultado === "exito").length,
    };
  }

  async sendMessage(input: SendMessageServiceInput): Promise<Mensaje> {
    const session = await this.requireActiveSession(input.sessionId);
    if (session.lead_id !== input.leadId) {
      throw new ValidationError(
        `sesión ${input.sessionId} no pertenece al lead ${input.leadId}`,
        "session_lead_mismatch",
      );
    }

    const convs = await this.deps.convs.findByLeadId(input.leadId);
    const conv = convs.find((c) => c.canal === input.canal);
    if (!conv) {
      throw new NotFoundError(
        `lead ${input.leadId} sin conversación en canal ${input.canal}`,
        "conversacion",
        input.canal,
      );
    }

    return this.deps.metaApi.sendOutbound({
      conversacionId: conv.id,
      leadSessionId: session.id,
      canal: input.canal,
      to: conv.canal_thread_id,
      contenido: input.body,
      sender: "humano",
      senderUserId: input.userId ?? undefined,
    });
  }

  async toggleHandoff(input: ToggleHandoffServiceInput): Promise<LeadSession> {
    return input.action === "pause"
      ? this.deps.handoff.pause(input.sessionId, "handoff manual vendedor")
      : this.deps.handoff.resume(input.sessionId);
  }

  async editarCampoTwin(input: EditarCampoTwinServiceInput): Promise<LeadSession> {
    // Reusa la guarda de sesión activa: una ficha cerrada es historial y
    // reescribirla cambiaría el pasado que se le mostró a alguien.
    await this.requireActiveSession(input.sessionId);
    return this.deps.sessions.editarCampoTwin(
      input.sessionId,
      input.campo,
      input.valor,
      input.userId,
    );
  }

  async closeSession(input: CloseSessionServiceInput): Promise<LeadSession> {
    return this.deps.sessions.close(input.sessionId, {
      resultado: input.resultado,
      motivo_perdida: input.motivoPerdida ?? null,
    });
  }

  private async requireActiveSession(sessionId: UUID): Promise<LeadSession> {
    const session = await this.deps.sessions.findById(sessionId);
    if (!session) {
      throw new NotFoundError(`sesión no encontrada: ${sessionId}`, "lead_session", sessionId);
    }
    if (session.resultado !== null) {
      throw new ConflictError(`sesión cerrada: ${sessionId}`, "session_closed");
    }
    return session;
  }
}
