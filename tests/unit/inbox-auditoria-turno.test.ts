import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryLlmUsageRepository } from "@/server/repositories/llm-usage.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemoryRuleExecutionsRepository } from "@/server/repositories/rule-executions.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { InMemorySessionRecordatoriosRepository } from "@/server/repositories/session-recordatorios.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { InMemoryToolExecutionsRepository } from "@/server/repositories/tool-executions.repo";
import { InMemoryTurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultInboxService } from "@/server/services/inbox/default-inbox.service";
import { claveSaliente, DefaultMetaApiService } from "@/server/services/meta-api.service";
import { WORKFLOW_LLM } from "@/types/domain";
import type { Conversacion, Lead, LeadSession, Mensaje, UUID } from "@/types/entities";

/** El `meta_message_id` del entrante que abre el turno bajo prueba. */
const WAMID = "wamid.entrante-1";

const T_ANTES = new Date("2026-08-10T09:59:00Z");
const T_ENTRANTE = new Date("2026-08-10T10:00:00Z");
const T_HERRAMIENTA = new Date("2026-08-10T10:00:01Z");
const T_SALIENTE = new Date("2026-08-10T10:00:02Z");
const T_DESPUES = new Date("2026-08-10T10:00:30Z");

describe("DefaultInboxService.getAuditoriaTurno", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let convs: InMemoryConversationsRepository;
  let messages: InMemoryMessagesRepository;
  let ruleExecutions: InMemoryRuleExecutionsRepository;
  let turnClassifications: InMemoryTurnClassificationsRepository;
  let toolExecutions: InMemoryToolExecutionsRepository;
  let llmUsage: InMemoryLlmUsageRepository;
  let rules: InMemoryRulesRepository;
  let intents: InMemoryIntentsRepository;
  let svc: DefaultInboxService;

  let lead: Lead;
  let session: LeadSession;
  let conv: Conversacion;
  let entrante: Mensaje;
  let saliente: Mensaje;

  async function crearMensaje(
    overrides: Partial<Parameters<InMemoryMessagesRepository["create"]>[0]>,
  ): Promise<Mensaje> {
    return messages.create({
      conversacion_id: conv.id,
      lead_session_id: session.id,
      direction: "in",
      sender: "lead",
      sender_user_id: null,
      tipo: "text",
      contenido: "texto",
      media_url: null,
      meta_message_id: null,
      idempotency_key: null,
      metadata: {},
      ...overrides,
    });
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    convs = new InMemoryConversationsRepository();
    messages = new InMemoryMessagesRepository();
    ruleExecutions = new InMemoryRuleExecutionsRepository();
    turnClassifications = new InMemoryTurnClassificationsRepository();
    toolExecutions = new InMemoryToolExecutionsRepository();
    llmUsage = new InMemoryLlmUsageRepository();
    rules = new InMemoryRulesRepository();
    intents = new InMemoryIntentsRepository();

    svc = new DefaultInboxService({
      leads,
      sessions,
      convs,
      messages,
      metaApi: new DefaultMetaApiService(convs, messages, {
        sendText: async () => {
          throw new Error("sendText no debe invocarse leyendo auditoría");
        },
      }),
      handoff: new DefaultHandoffService(sessions),
      productos: new InMemoryProductsRepository(),
      tags: new InMemoryTagsRepository(),
      llmUsage,
      ruleExecutions,
      turnClassifications,
      toolExecutions,
      rules,
      intents,
      recordatorios: new InMemorySessionRecordatoriosRepository(),
      programarAviso: async () => {},
    });

    vi.setSystemTime(T_ANTES);
    lead = await leads.create({
      nombre: "Lead Test",
      telefono: "+595981000111",
      email: null,
      direccion: null,
      vehiculo_marca: "Toyota",
      vehiculo_modelo: "Corolla",
      vehiculo_anio: 2018,
      vehiculo_motor: null,
      empresa_id: null,
      canal_origen: "wa",
      meta_user_ids: {},
    });
    session = await sessions.create({
      lead_id: lead.id,
      current_stage: "nuevo",
      urgencia: "media",
      consulta: "",
      producto_cotizado_id: null,
      codigo_interno: null,
      precio_cotizado: null,
      cantidad: null,
      bloqueador: null,
      comprobante_pago_url: null,
      metodo_pago: null,
      resultado: null,
      motivo_perdida: null,
      ia_pausada: false,
    });
    conv = await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: lead.telefono });

    vi.setSystemTime(T_ENTRANTE);
    entrante = await crearMensaje({ meta_message_id: WAMID, contenido: "¿tenés bujías?" });

    vi.setSystemTime(T_SALIENTE);
    saliente = await crearMensaje({
      direction: "out",
      sender: "ia",
      contenido: "Sí, tenemos.",
      meta_message_id: "wamid.saliente-1",
      idempotency_key: claveSaliente(WAMID),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("un turno que resolvió una regla dice cuál y con qué intent", async () => {
    const intent = await intents.create({
      nombre: "consulta_stock",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    const regla = await rules.create({
      intent_id: intent.id,
      condiciones_extra: null,
      respuesta_tipo: "text",
      respuesta_contenido: "Sí, tenemos.\nDecime el modelo.",
      prioridad: 10,
      activa: true,
    });
    await ruleExecutions.create({
      regla_id: regla.id,
      mensaje_id: entrante.id,
      matched_intent_id: intent.id,
    });

    const auditoria = await svc.getAuditoriaTurno(saliente.id);

    expect(auditoria.estado).toBe("medido");
    if (auditoria.estado !== "medido") return;
    expect(auditoria.decision).toEqual({
      tipo: "regla",
      nombre: "Sí, tenemos.",
      intent: "consulta_stock",
    });
    expect(auditoria.turnoAt).toEqual(T_ENTRANTE);
  });

  test("un turno que resolvió el LLM dice el intent y la confianza", async () => {
    await turnClassifications.create({
      mensaje_id: entrante.id,
      intent_id: null,
      intent_nombre: "consulta_precio",
      confidence: 0.82,
    });

    const auditoria = await svc.getAuditoriaTurno(saliente.id);

    expect(auditoria.estado).toBe("medido");
    if (auditoria.estado !== "medido") return;
    expect(auditoria.decision).toEqual({
      tipo: "llm",
      intent: "consulta_precio",
      confianza: 0.82,
    });
  });

  test("el intent nulo del clasificador viaja como nulo, no como texto inventado", async () => {
    await turnClassifications.create({
      mensaje_id: entrante.id,
      intent_id: null,
      intent_nombre: null,
      confidence: 0.31,
    });

    const auditoria = await svc.getAuditoriaTurno(saliente.id);

    expect(auditoria.estado).toBe("medido");
    if (auditoria.estado !== "medido") return;
    expect(auditoria.decision).toEqual({ tipo: "llm", intent: null, confianza: 0.31 });
  });

  test("el gasto se desglosa por llamada y suma el total del turno", async () => {
    await turnClassifications.create({
      mensaje_id: entrante.id,
      intent_id: null,
      intent_nombre: "consulta_precio",
      confidence: 0.9,
    });
    await llmUsage.create({
      lead_session_id: session.id,
      mensaje_id: entrante.id,
      modelo: "gpt-4o-mini",
      input_tokens: 100,
      output_tokens: 20,
      costo_usd: 0.0001,
      workflow: WORKFLOW_LLM.clasificador,
      created_at: T_ENTRANTE,
    });
    await llmUsage.create({
      lead_session_id: session.id,
      mensaje_id: entrante.id,
      modelo: "gpt-4o",
      input_tokens: 900,
      output_tokens: 120,
      costo_usd: 0.0009,
      workflow: WORKFLOW_LLM.agente,
      created_at: T_SALIENTE,
    });
    // Otro turno de la misma sesión: no tiene que sumar acá.
    await llmUsage.create({
      lead_session_id: session.id,
      mensaje_id: null,
      modelo: "gpt-4o-mini",
      input_tokens: 10,
      output_tokens: 5,
      costo_usd: 0.5,
      workflow: WORKFLOW_LLM.resumidor,
      created_at: T_DESPUES,
    });

    const auditoria = await svc.getAuditoriaTurno(saliente.id);

    expect(auditoria.estado).toBe("medido");
    if (auditoria.estado !== "medido" || auditoria.gasto.estado !== "medido") {
      expect.unreachable("el turno tiene filas de gasto");
      return;
    }
    expect(auditoria.gasto.usd).toBeCloseTo(0.001, 10);
    expect(auditoria.gasto.llamadas.map((l) => l.workflow)).toEqual([
      WORKFLOW_LLM.clasificador,
      WORKFLOW_LLM.agente,
    ]);
    expect(auditoria.gasto.llamadas[0]).toEqual({
      workflow: WORKFLOW_LLM.clasificador,
      modelo: "gpt-4o-mini",
      inputTokens: 100,
      outputTokens: 20,
      usd: 0.0001,
    });
  });

  test("sin filas de gasto el turno dice que no se midió, no que salió cero", async () => {
    await turnClassifications.create({
      mensaje_id: entrante.id,
      intent_id: null,
      intent_nombre: "consulta_precio",
      confidence: 0.9,
    });

    const auditoria = await svc.getAuditoriaTurno(saliente.id);

    expect(auditoria.estado).toBe("medido");
    if (auditoria.estado !== "medido") return;
    expect(auditoria.gasto).toEqual({ estado: "sin_registro" });
  });

  test("las herramientas son las de la ventana del turno, no las de toda la sesión", async () => {
    await turnClassifications.create({
      mensaje_id: entrante.id,
      intent_id: null,
      intent_nombre: "consulta_stock",
      confidence: 0.7,
    });

    vi.setSystemTime(T_ANTES);
    await toolExecutions.create({
      lead_session_id: session.id,
      mensaje_id: null,
      tool_name: "de_un_turno_anterior",
      args: {},
      result: null,
      error: null,
      duration_ms: 5,
    });
    vi.setSystemTime(T_HERRAMIENTA);
    await toolExecutions.create({
      lead_session_id: session.id,
      mensaje_id: null,
      tool_name: "buscar_repuesto",
      args: { query: "bujía" },
      result: null,
      error: "catálogo caído",
      duration_ms: 412,
    });
    vi.setSystemTime(T_DESPUES);
    await toolExecutions.create({
      lead_session_id: session.id,
      mensaje_id: null,
      tool_name: "de_un_turno_posterior",
      args: {},
      result: null,
      error: null,
      duration_ms: 7,
    });

    const auditoria = await svc.getAuditoriaTurno(saliente.id);

    expect(auditoria.estado).toBe("medido");
    if (auditoria.estado !== "medido") return;
    expect(auditoria.herramientas).toEqual([
      { nombre: "buscar_repuesto", error: "catálogo caído", duracionMs: 412 },
    ]);
  });

  test("un saliente del vendedor no tiene turno que auditar", async () => {
    vi.setSystemTime(T_SALIENTE);
    const delVendedor = await crearMensaje({
      direction: "out",
      sender: "humano",
      contenido: "Te confirmo yo",
      idempotency_key: null,
    });

    expect(await svc.getAuditoriaTurno(delVendedor.id)).toEqual({
      estado: "sin_registro",
      motivo: "sin_ancla",
    });
  });

  test("un saliente de la IA sin la clave `out:` no se puede atar a su entrante", async () => {
    vi.setSystemTime(T_SALIENTE);
    const viejo = await crearMensaje({
      direction: "out",
      sender: "ia",
      contenido: "Respuesta anterior a la convención",
      idempotency_key: null,
    });

    expect(await svc.getAuditoriaTurno(viejo.id)).toEqual({
      estado: "sin_registro",
      motivo: "sin_ancla",
    });
  });

  test("con el entrante borrado tampoco hay ancla", async () => {
    const huerfano = await crearMensaje({
      direction: "out",
      sender: "ia",
      contenido: "Respuesta sin disparador",
      idempotency_key: claveSaliente("wamid.que-ya-no-esta"),
    });

    expect(await svc.getAuditoriaTurno(huerfano.id)).toEqual({
      estado: "sin_registro",
      motivo: "sin_ancla",
    });
  });

  test("preguntar por un entrante no devuelve la auditoría de su turno", async () => {
    // La pregunta es sobre una respuesta. Aceptar el entrante abriría un
    // segundo camino a lo mismo y un segundo lugar donde mantener la regla.
    expect(await svc.getAuditoriaTurno(entrante.id)).toEqual({
      estado: "sin_registro",
      motivo: "sin_ancla",
    });
  });

  test("un mensaje que no existe no revienta", async () => {
    expect(await svc.getAuditoriaTurno("00000000-0000-4000-8000-000000000000")).toEqual({
      estado: "sin_registro",
      motivo: "sin_ancla",
    });
  });

  test("turno encontrado y cuatro tablas mudas: no se midió", async () => {
    expect(await svc.getAuditoriaTurno(saliente.id)).toEqual({
      estado: "sin_registro",
      motivo: "sin_medicion",
    });
  });

  test("gasto anotado sin clasificación: la decisión queda sin registro, el turno no", async () => {
    await llmUsage.create({
      lead_session_id: session.id,
      mensaje_id: entrante.id,
      modelo: "gpt-4o-mini",
      input_tokens: 100,
      output_tokens: 20,
      costo_usd: 0.0001,
      workflow: WORKFLOW_LLM.clasificador,
      created_at: T_ENTRANTE,
    });

    const auditoria = await svc.getAuditoriaTurno(saliente.id);

    expect(auditoria.estado).toBe("medido");
    if (auditoria.estado !== "medido") return;
    expect(auditoria.decision).toEqual({ tipo: "sin_registro" });
    expect(auditoria.gasto.estado).toBe("medido");
  });

  test("la regla borrada deja el turno legible en vez de romperlo", async () => {
    const intent = await intents.create({
      nombre: "consulta_stock",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    await ruleExecutions.create({
      regla_id: "00000000-0000-4000-8000-00000000dead" as UUID,
      mensaje_id: entrante.id,
      matched_intent_id: intent.id,
    });

    const auditoria = await svc.getAuditoriaTurno(saliente.id);

    expect(auditoria.estado).toBe("medido");
    if (auditoria.estado !== "medido" || auditoria.decision.tipo !== "regla") {
      expect.unreachable("la decisión es de regla");
      return;
    }
    expect(auditoria.decision.nombre).toBe("regla no disponible");
    expect(auditoria.decision.intent).toBe("consulta_stock");
  });
});
