import { conDatoExtra, excedeTope, MAX_DATOS_EXTRA, sinDatoExtra } from "@/lib/datos-extra";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { calcularSinResponder } from "@/lib/sin-responder";
import { pesoMotivo, triage } from "@/lib/triage";
import { canalesDelLead } from "@/lib/ui/canal";
import { nombreDeRegla } from "@/lib/ui/regla";
import { entranteDeClave } from "@/server/services/meta-api.service";
import type { EntradaTriage } from "@/lib/triage";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { IntentsRepository } from "@/server/repositories/intents.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { LlmUsageRepository } from "@/server/repositories/llm-usage.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { ProductsRepository } from "@/server/repositories/productos.repo";
import type { RuleExecutionsRepository } from "@/server/repositories/rule-executions.repo";
import type { RulesRepository } from "@/server/repositories/rules.repo";
import type { SessionRecordatoriosRepository } from "@/server/repositories/session-recordatorios.repo";
import type { TagsRepository } from "@/server/repositories/tags.repo";
import type { ToolExecutionsRepository } from "@/server/repositories/tool-executions.repo";
import type { TurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
import type { HandoffService } from "@/server/services/handoff.service";
import type { MetaApiService } from "@/server/services/meta-api.service";
import { WORKFLOW_LLM } from "@/types/domain";
import type { Canal } from "@/types/domain";
import type {
  Conversacion,
  Lead,
  LeadSession,
  Mensaje,
  Producto,
  RuleExecution,
  SessionRecordatorio,
  Tag,
  TurnClassification,
  UUID,
} from "@/types/entities";
import type {
  AuditoriaTurno,
  DecisionTurno,
  GastoSesion,
  GastoTurno,
  SesionesPrevias,
} from "@/types/inbox";
import type { EtiquetaOpcion } from "@/types/leads";
import type {
  AgregarDatoLeadServiceInput,
  BorrarDatoExtraServiceInput,
  CancelarRecordatorioServiceInput,
  CloseSessionServiceInput,
  ConversationView,
  CrearEtiquetaServiceInput,
  EditarCampoTwinServiceInput,
  EtiquetaLeadServiceInput,
  InboxItem,
  InboxService,
  MoverEtapaServiceInput,
  ProgramarAvisoRecordatorioFn,
  ProgramarRecordatorioServiceInput,
  RenombrarLeadServiceInput,
  ReprogramarRecordatorioServiceInput,
  SendMessageServiceInput,
  ToggleHandoffServiceInput,
} from "./inbox.service";

// Cap thread: sesiones cortas (5-15 msgs); 200 cubre outliers sin paginar.
const CONVERSATION_MESSAGES_LIMIT = 200;

// Para contar lo que quedó sin responder alcanza con la cola del hilo: solo se
// miran los mensajes posteriores a la última respuesta nuestra.
const TRIAGE_MESSAGES_LIMIT = 50;

/**
 * Colores para las etiquetas creadas al vuelo desde el Twin.
 *
 * El default de la tabla es `#888888` y deja todos los chips grises, que es
 * justo lo que una etiqueta no tiene que ser: se pone para distinguir de un
 * vistazo. Se elige por el nombre y no al azar para que la misma etiqueta
 * salga siempre del mismo color, incluso si se borra y se vuelve a crear.
 */
const COLORES_ETIQUETA = [
  "#FFAF3A",
  "#34D399",
  "#7FB3F5",
  "#E879F9",
  "#FB923C",
  "#38BDF8",
] as const;

function colorParaEtiqueta(nombre: string): string {
  let acumulado = 0;
  for (const char of nombre) acumulado = (acumulado + (char.codePointAt(0) ?? 0)) % 4096;
  return COLORES_ETIQUETA[acumulado % COLORES_ETIQUETA.length] ?? COLORES_ETIQUETA[0];
}

/**
 * El triage mira solo la sesión y el recordatorio ya vencido de esa sesión, así
 * que contar no obliga a leer hilos: son dos queries para toda la bandeja.
 */
function entradaTriage(
  session: LeadSession,
  recordatorios: Map<UUID, SessionRecordatorio>,
): EntradaTriage {
  const recordatorio = recordatorios.get(session.id);
  return {
    stage: session.current_stage,
    iaPausada: session.ia_pausada,
    bloqueador: session.bloqueador,
    comprobantePagoUrl: session.comprobante_pago_url,
    recordatorio: recordatorio ? { nota: recordatorio.nota } : null,
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
  // Las cuatro tablas de auditoría del turno, más las dos que le ponen nombre a
  // lo que decidió. Solo las lee `getAuditoriaTurno`, bajo demanda: no
  // participan de `getConversation` ni de `listActiveLeads`.
  ruleExecutions: RuleExecutionsRepository;
  turnClassifications: TurnClassificationsRepository;
  toolExecutions: ToolExecutionsRepository;
  rules: RulesRepository;
  intents: IntentsRepository;
  /** Recordatorios de seguimiento: el chip del Inbox y el bloque del Twin. */
  recordatorios: SessionRecordatoriosRepository;
  /** Arranca el workflow durable. Ver `ProgramarAvisoRecordatorioFn`. */
  programarAviso: ProgramarAvisoRecordatorioFn;
  /** Inyectable para poder testear el vencimiento sin esperar dos días. */
  now?: () => Date;
}

/** Turno sin ancla: el saliente no se puede atar a ningún mensaje entrante. */
const SIN_ANCLA: AuditoriaTurno = { estado: "sin_registro", motivo: "sin_ancla" };

export class DefaultInboxService implements InboxService {
  constructor(private readonly deps: DefaultInboxServiceDeps) {}

  async listEtiquetas(): Promise<EtiquetaOpcion[]> {
    const catalogo = await this.deps.tags.list();
    return catalogo
      .map((t) => ({ id: t.id, nombre: t.nombre, color: t.color }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }

  async contarRequierenAtencion(): Promise<number> {
    const [activeSessions, recordatorios] = await Promise.all([
      this.deps.sessions.listActive(),
      this.recordatoriosVencidos(),
    ]);
    return activeSessions.filter((s) => triage(entradaTriage(s, recordatorios)).motivo !== null)
      .length;
  }

  /**
   * Los seguimientos que ya tienen que verse, indexados por sesión.
   *
   * Una query para toda la bandeja, no una por lead: el badge del SideNav se
   * pinta en las 7 pantallas del panel y no puede costar N consultas.
   */
  private async recordatoriosVencidos(): Promise<Map<UUID, SessionRecordatorio>> {
    const now = (this.deps.now ?? (() => new Date()))();
    const filas = await this.deps.recordatorios.listPorAvisar(now);
    return new Map(filas.map((r) => [r.lead_session_id, r]));
  }

  async listActiveLeads(): Promise<InboxItem[]> {
    const activeSessions = await this.deps.sessions.listActive();
    const recordatorios = await this.recordatoriosVencidos();

    const items: InboxItem[] = [];
    for (const session of activeSessions) {
      const lead = await this.deps.leads.findById(session.lead_id);
      if (!lead) continue;

      const convs = await this.deps.convs.findByLeadId(session.lead_id);
      const conConversacion: Canal[] = Array.from(new Set(convs.map((c) => c.canal)));
      // Los canales del lead salen de la entidad y no solo de las
      // conversaciones abiertas: un lead con WhatsApp e Instagram vinculados
      // mostraba los dos en el header de la conversación y uno solo en la fila,
      // porque cada pantalla derivaba la lista por su cuenta.
      const canales: Canal[] = canalesDelLead(lead, conConversacion);

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
      const { motivo } = triage(entradaTriage(session, recordatorios));

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
        // El fallback sigue mirando solo las conversaciones y no `canales`:
        // "activo" es por dónde se le responde, y para eso hace falta un hilo.
        // Un canal vinculado sin conversación no es un destino de respuesta.
        canalActivo: canalActivo ?? conConversacion[0] ?? null,
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
    const [tags, tagsDisponibles] = await Promise.all([
      this.deps.tags.listByLead(leadId),
      this.deps.tags.list(),
    ]);
    const sesionesPrevias = await this.contarSesionesPrevias(leadId, session);
    const gastoIa = await this.resolverGastoIa(session);
    // El vivo, no el vencido: el Twin muestra igual el que todavía no llegó
    // ("faltan 2 días") para que se pueda cancelar antes de que moleste.
    const recordatorio = session
      ? await this.deps.recordatorios.findVivoBySessionId(session.id)
      : null;

    return {
      lead,
      session,
      messages,
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
      tagsDisponibles: [...tagsDisponibles].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
      sesionesPrevias,
      gastoIa,
      recordatorio,
    };
  }

  async programarRecordatorio(
    input: ProgramarRecordatorioServiceInput,
  ): Promise<SessionRecordatorio> {
    // Misma guarda que `editarCampoTwin`: una sesión cerrada sale del Inbox, y
    // un recordatorio sobre ella no lo vería nunca nadie.
    await this.requireActiveSession(input.sessionId);

    // El índice único parcial de la tabla es el que cierra la carrera de dos
    // pestañas; esta guarda existe para dar el mensaje que el vendedor entiende
    // en vez del texto crudo de una violación de unicidad.
    const vivo = await this.deps.recordatorios.findVivoBySessionId(input.sessionId);
    if (vivo) {
      throw new ConflictError(
        "Esta conversación ya tiene un recordatorio. Cancelalo antes de poner otro.",
        "recordatorio_duplicado",
      );
    }

    const recordatorio = await this.deps.recordatorios.create({
      lead_session_id: input.sessionId,
      recordar_at: input.recordarAt,
      nota: input.nota,
      creado_por: input.userId,
    });

    // La fila primero y el workflow después: si esto reventara, la fila queda
    // `pendiente` y `listPorAvisar` la levanta igual cuando venza. Se pierde la
    // puntualidad del sello, no el aviso — que es el único modo de falla que no
    // se puede aceptar acá.
    await this.deps.programarAviso({
      recordatorioId: recordatorio.id,
      leadSessionId: input.sessionId,
      recordarAt: input.recordarAt,
    });

    return recordatorio;
  }

  async reprogramarRecordatorio(
    input: ReprogramarRecordatorioServiceInput,
  ): Promise<SessionRecordatorio> {
    // La sesión sale de la fila y no del cliente: el que identifica la cita es
    // el id del recordatorio, y aceptar un `sessionId` del formulario sería
    // dejar que decida contra qué conversación se chequea el estado.
    const actual = await this.deps.recordatorios.findById(input.recordatorioId);
    if (!actual) {
      throw new NotFoundError(
        `recordatorio no encontrado: ${input.recordatorioId}`,
        "session_recordatorio",
        input.recordatorioId,
      );
    }

    // Misma guarda que al programar: mover una cita sobre una conversación
    // cerrada la deja donde nadie la va a ver.
    await this.requireActiveSession(actual.lead_session_id);

    const movido = await this.deps.recordatorios.reprogramar(
      input.recordatorioId,
      input.recordarAt,
    );
    if (!movido) {
      throw new ConflictError(
        "Este recordatorio ya no está activo. Actualizá la conversación.",
        "recordatorio_no_vivo",
      );
    }

    // Workflow nuevo con la fecha nueva. El viejo sigue durmiendo hasta su
    // fecha y ahí sale por `sin-efecto`: la fila ya no tiene la fecha con la
    // que él arrancó. Dos ejecuciones vivas un rato, un solo aviso.
    await this.deps.programarAviso({
      recordatorioId: movido.id,
      leadSessionId: movido.lead_session_id,
      recordarAt: movido.recordar_at,
    });

    return movido;
  }

  async cancelarRecordatorio(input: CancelarRecordatorioServiceInput): Promise<void> {
    // Sin `requireActiveSession` y sin error cuando ya no está vivo: apagar un
    // recordatorio siempre tiene que poder terminar bien. El workflow que sigue
    // durmiendo se despierta, encuentra la fila cancelada y no hace nada.
    await this.deps.recordatorios.cancelar(input.recordatorioId, "manual");
  }

  /**
   * Por qué el agente contestó lo que contestó, para un mensaje saliente.
   *
   * **Cómo se encuentra el turno.** Las cuatro tablas de auditoría cuelgan del
   * mensaje **entrante** que disparó el turno, no de la respuesta: es el ancla
   * que eligió el pipeline y es la correcta —un turno tiene un disparador y
   * puede no tener respuesta—. Pero quien pregunta señala la respuesta. El
   * puente es `mensajes.idempotency_key`, que en los salientes del pipeline
   * vale `out:<meta_message_id del entrante>` (ver `claveSaliente`). No hay
   * columna que ate una cosa con la otra, y ésta es la única evidencia
   * persistida del vínculo.
   *
   * **Qué no se audita.** Los salientes del vendedor no pasan por acá: no hay
   * decisión del agente que explicar, y su clave viene en `null` de todas
   * formas. Tampoco los turnos en los que el agente decidió no responder —el
   * escalado, el descuento excedido—: sin saliente no hay burbuja desde donde
   * preguntar.
   *
   * **Las herramientas se atan por ventana y no por id.** `tool_executions`
   * tiene columna `mensaje_id` y el agente la escribe siempre en `null` desde
   * Slice 1. Ver `listBySessionEntre` para por qué la ventana identifica el
   * turno igual.
   */
  async getAuditoriaTurno(mensajeId: UUID): Promise<AuditoriaTurno> {
    const saliente = await this.deps.messages.findById(mensajeId);
    if (!saliente || saliente.direction !== "out" || saliente.sender !== "ia") return SIN_ANCLA;

    const metaEntrante = entranteDeClave(saliente.idempotency_key);
    if (metaEntrante === null) return SIN_ANCLA;

    const entrante = await this.deps.messages.findByMetaMessageId(metaEntrante);
    if (!entrante) return SIN_ANCLA;

    const [ejecucion, clasificacion, llamadas, herramientas] = await Promise.all([
      this.deps.ruleExecutions.findByMensajeId(entrante.id),
      this.deps.turnClassifications.findByMensajeId(entrante.id),
      this.deps.llmUsage.listByMensajeId(entrante.id),
      this.deps.toolExecutions.listBySessionEntre(
        saliente.lead_session_id,
        entrante.created_at,
        saliente.created_at,
      ),
    ]);

    const decision = await this.resolverDecisionTurno(ejecucion, clasificacion);

    // Las cuatro tablas mudas significan lo mismo que un gasto sin filas: el
    // turno es anterior a que esto se midiera. Decirlo una sola vez es más
    // honesto que dibujar tres secciones vacías que se leen como ceros.
    if (decision.tipo === "sin_registro" && llamadas.length === 0 && herramientas.length === 0) {
      return { estado: "sin_registro", motivo: "sin_medicion" };
    }

    const gasto: GastoTurno =
      llamadas.length === 0
        ? { estado: "sin_registro" }
        : {
            estado: "medido",
            usd: llamadas.reduce((total, l) => total + l.costo_usd, 0),
            llamadas: llamadas.map((l) => ({
              workflow: l.workflow,
              modelo: l.modelo,
              inputTokens: l.input_tokens,
              outputTokens: l.output_tokens,
              usd: l.costo_usd,
            })),
          };

    return {
      estado: "medido",
      decision,
      // Ni `args` ni `result`: son el jsonb crudo de la llamada y de la
      // respuesta del catálogo, y lo que la pregunta necesita es qué se llamó,
      // si funcionó y cuánto tardó.
      herramientas: herramientas.map((h) => ({
        nombre: h.tool_name,
        error: h.error,
        duracionMs: h.duration_ms,
      })),
      gasto,
      turnoAt: entrante.created_at,
    };
  }

  /**
   * Regla o LLM, con nombre. Las dos tablas son excluyentes por construcción
   * —el pipeline escribe `rule_executions` cuando `source` es `rule` y
   * `turn_classifications` cuando es `llm`—, así que el orden acá no arbitra
   * un empate: solo fija cuál se mira primero.
   */
  private async resolverDecisionTurno(
    ejecucion: RuleExecution | null,
    clasificacion: TurnClassification | null,
  ): Promise<DecisionTurno> {
    if (ejecucion) {
      const [regla, intent] = await Promise.all([
        this.deps.rules.findById(ejecucion.regla_id),
        this.deps.intents.findById(ejecucion.matched_intent_id),
      ]);
      return {
        tipo: "regla",
        // `regla_id` es CASCADE: borrar la regla se lleva su auditoría, así que
        // el `null` acá no es "la borraron" sino que no se pudo leer.
        nombre: regla ? nombreDeRegla(regla.respuesta_contenido) : "regla no disponible",
        intent: intent?.nombre ?? null,
      };
    }
    if (clasificacion) {
      return {
        tipo: "llm",
        intent: clasificacion.intent_nombre,
        confianza: clasificacion.confidence,
      };
    }
    return { tipo: "sin_registro" };
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

  async moverEtapa(input: MoverEtapaServiceInput): Promise<LeadSession> {
    // Misma guarda que `editarCampoTwin`: una sesión cerrada es historial y su
    // etapa final ya cuenta en las métricas del embudo.
    await this.requireActiveSession(input.sessionId);
    return this.deps.sessions.moverEtapa(input.sessionId, input.etapa, input.userId);
  }

  async renombrarLead(input: RenombrarLeadServiceInput): Promise<Lead> {
    await this.requireLead(input.leadId);
    return this.deps.leads.update(input.leadId, { nombre: input.nombre.trim() });
  }

  async agregarDato(input: AgregarDatoLeadServiceInput): Promise<Lead> {
    const lead = await this.requireLead(input.leadId);
    const valor = input.valor.trim();

    if (input.tipo === "campo") {
      return this.deps.leads.update(input.leadId, { [input.campo]: valor });
    }

    const clave = input.clave.trim();
    // El tope se mira acá y no en el schema: depende de cuántos campos tiene
    // ya *este* lead, que la validación de entrada no puede saber.
    if (excedeTope(lead.datos_extra, clave)) {
      throw new ValidationError(
        `El lead ya tiene ${MAX_DATOS_EXTRA} campos extra. Borrá uno antes de agregar otro.`,
        "datos_extra_tope",
      );
    }
    return this.deps.leads.update(input.leadId, {
      datos_extra: conDatoExtra(lead.datos_extra, clave, valor),
    });
  }

  async borrarDatoExtra(input: BorrarDatoExtraServiceInput): Promise<Lead> {
    const lead = await this.requireLead(input.leadId);
    // El patch se arma como el jsonb entero menos esa clave: no hay camino por
    // el que la clave que llegó termine nombrando una columna de `leads`.
    const restantes = sinDatoExtra(lead.datos_extra, input.clave.trim());

    // Nada que sacar —la fila ya se había borrado en otra pestaña, o el doble
    // click mandó dos veces—. Ni error ni UPDATE: el estado ya es el pedido.
    if (Object.keys(restantes).length === Object.keys(lead.datos_extra).length) return lead;

    return this.deps.leads.update(input.leadId, { datos_extra: restantes });
  }

  async asignarEtiqueta(input: EtiquetaLeadServiceInput): Promise<void> {
    await this.requireLead(input.leadId);
    const tag = await this.deps.tags.findById(input.tagId);
    if (!tag) {
      throw new NotFoundError(`tag no encontrado: ${input.tagId}`, "tag", input.tagId);
    }
    await this.deps.tags.assignToLead(input.leadId, tag.id, "manual", input.userId ?? null);
  }

  async quitarEtiqueta(input: EtiquetaLeadServiceInput): Promise<void> {
    await this.deps.tags.removeFromLead(input.leadId, input.tagId);
  }

  async crearYAsignarEtiqueta(input: CrearEtiquetaServiceInput): Promise<Tag> {
    await this.requireLead(input.leadId);
    const nombre = input.nombre.trim();

    // El duplicado exacto no es un error para quien lo escribió: quería esa
    // etiqueta en este lead y ya existe. Se reusa en vez de reventar; el
    // ConflictError del INSERT queda para las carreras entre dos pestañas.
    const existente = await this.deps.tags.findByNombre(nombre);
    const tag =
      existente ??
      (await this.deps.tags.create({
        nombre,
        color: colorParaEtiqueta(nombre),
        descripcion: null,
      }));

    await this.deps.tags.assignToLead(input.leadId, tag.id, "manual", input.userId);
    return tag;
  }

  async closeSession(input: CloseSessionServiceInput): Promise<LeadSession> {
    // Sin `requireActiveSession`, a diferencia de `moverEtapa`: cerrar es el
    // acto que convierte la sesión en historial, y su replay idéntico tiene que
    // seguir siendo no-op. Quien decide sobre una sesión ya cerrada lo resuelve
    // el repo: mismo resultado y motivo devuelve la fila, distinto revienta.
    if (input.resultado === "exito") {
      return this.deps.sessions.resolver(input.sessionId, { resultado: "exito" }, input.userId);
    }

    // La segunda cerradura del motivo obligatorio. La primera es
    // `CloseSessionSchema`; esta cubre a cualquier caller que no pase por la
    // Server Action —un job, un test, el próximo endpoint— porque la regla es
    // del dominio y no del formulario.
    if (input.motivoPerdida === null) {
      throw new ValidationError(
        "Un cierre perdido necesita un motivo.",
        "motivo_perdida_requerido",
      );
    }

    return this.deps.sessions.resolver(
      input.sessionId,
      { resultado: "perdido", motivo: input.motivoPerdida },
      input.userId,
    );
  }

  private async requireLead(leadId: UUID): Promise<Lead> {
    const lead = await this.deps.leads.findById(leadId);
    if (!lead) {
      throw new NotFoundError(`lead no encontrado: ${leadId}`, "lead", leadId);
    }
    return lead;
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
