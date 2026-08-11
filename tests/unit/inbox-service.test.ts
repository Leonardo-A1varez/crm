import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import {
  InMemoryMessagesRepository,
  type MensajeInsert,
} from "@/server/repositories/messages.repo";
import { InMemoryLlmUsageRepository } from "@/server/repositories/llm-usage.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultInboxService } from "@/server/services/inbox/default-inbox.service";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { WORKFLOW_LLM } from "@/types/domain";
import type { Lead, LeadSession, UUID } from "@/types/entities";

// Read path no toca Meta; client jamás debería invocarse en esta suite.
function makeReadOnlyDeps(
  leads: InMemoryLeadsRepository,
  sessions: InMemoryLeadSessionRepository,
  convs: InMemoryConversationsRepository,
  messages: InMemoryMessagesRepository,
  productos: InMemoryProductsRepository = new InMemoryProductsRepository(),
  tags: InMemoryTagsRepository = new InMemoryTagsRepository(),
  llmUsage: InMemoryLlmUsageRepository = new InMemoryLlmUsageRepository(),
) {
  return {
    leads,
    sessions,
    convs,
    messages,
    metaApi: new DefaultMetaApiService(convs, messages, {
      sendText: async () => {
        throw new Error("sendText no debe invocarse en read path");
      },
    }),
    handoff: new DefaultHandoffService(sessions),
    productos,
    tags,
    llmUsage,
  };
}

async function makeLead(
  repo: InMemoryLeadsRepository,
  overrides: Partial<Lead> = {},
): Promise<Lead> {
  return repo.create({
    nombre: overrides.nombre ?? "Lead Test",
    telefono: overrides.telefono ?? `+595981${Math.floor(Math.random() * 1_000_000)}`,
    email: null,
    direccion: null,
    vehiculo_marca: "Toyota",
    vehiculo_modelo: "Corolla",
    vehiculo_anio: 2018,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: overrides.canal_origen ?? "wa",
    meta_user_ids: overrides.meta_user_ids ?? {},
  });
}

async function makeSession(
  repo: InMemoryLeadSessionRepository,
  leadId: UUID,
  overrides: Partial<LeadSession> = {},
): Promise<LeadSession> {
  return repo.create({
    lead_id: leadId,
    current_stage: overrides.current_stage ?? "nuevo",
    urgencia: overrides.urgencia ?? "media",
    consulta: overrides.consulta ?? "",
    producto_cotizado_id: null,
    codigo_interno: null,
    precio_cotizado: null,
    cantidad: null,
    bloqueador: null,
    comprobante_pago_url: null,
    metodo_pago: null,
    resultado: overrides.resultado ?? null,
    motivo_perdida: null,
    ia_pausada: overrides.ia_pausada ?? false,
  });
}

function msgInsert(
  conversacionId: UUID,
  sessionId: UUID,
  overrides: Partial<MensajeInsert> = {},
): MensajeInsert {
  return {
    conversacion_id: conversacionId,
    lead_session_id: sessionId,
    direction: "in",
    sender: "lead",
    sender_user_id: null,
    tipo: "text",
    contenido: "Hola",
    media_url: null,
    meta_message_id: null,
    idempotency_key: null,
    metadata: {},
    ...overrides,
  };
}

describe("DefaultInboxService.listActiveLeads", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let convs: InMemoryConversationsRepository;
  let messages: InMemoryMessagesRepository;
  let svc: DefaultInboxService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    convs = new InMemoryConversationsRepository();
    messages = new InMemoryMessagesRepository();
    svc = new DefaultInboxService(makeReadOnlyDeps(leads, sessions, convs, messages));
  });

  test("returns empty array when no active sessions", async () => {
    const out = await svc.listActiveLeads();
    expect(out).toEqual([]);
  });

  test("returns 1 item per active session, enriched with lead + last msg + canales", async () => {
    const lead = await makeLead(leads, { nombre: "Juan Pérez" });
    const session = await sessions.create({
      lead_id: lead.id,
      current_stage: "cotizado",
      urgencia: "alta",
      consulta: "filtro de aceite Corolla 2018",
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
    const conv = await convs.create({
      lead_id: lead.id,
      canal: "wa",
      canal_thread_id: "+595981000000",
    });
    const msg = await messages.create({
      conversacion_id: conv.id,
      lead_session_id: session.id,
      direction: "in",
      sender: "lead",
      sender_user_id: null,
      tipo: "text",
      contenido: "Hola, tienen el filtro?",
      media_url: null,
      meta_message_id: null,
      idempotency_key: null,
      metadata: {},
    });

    const out = await svc.listActiveLeads();
    expect(out).toHaveLength(1);
    const item = out[0]!;
    expect(item.leadId).toBe(lead.id);
    expect(item.sessionId).toBe(session.id);
    expect(item.nombre).toBe("Juan Pérez");
    expect(item.currentStage).toBe("cotizado");
    expect(item.iaPausada).toBe(false);
    expect(item.canales).toEqual(["wa"]);
    expect(item.ultimoMensaje?.body).toBe("Hola, tienen el filtro?");
    expect(item.ultimoMensaje?.direction).toBe("in");
    expect(item.ultimoMensaje?.createdAt.getTime()).toBe(msg.created_at.getTime());
  });

  test("sorts items by ultimaActividad DESC", async () => {
    const leadOld = await makeLead(leads, { nombre: "Old" });
    const leadNew = await makeLead(leads, { nombre: "New" });

    const sOld = await sessions.create({
      lead_id: leadOld.id,
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
    const cOld = await convs.create({
      lead_id: leadOld.id,
      canal: "wa",
      canal_thread_id: "old",
    });
    await messages.create({
      conversacion_id: cOld.id,
      lead_session_id: sOld.id,
      direction: "in",
      sender: "lead",
      sender_user_id: null,
      tipo: "text",
      contenido: "msg vieja",
      media_url: null,
      meta_message_id: null,
      idempotency_key: null,
      metadata: {},
    });
    await new Promise((r) => setTimeout(r, 5));

    const sNew = await sessions.create({
      lead_id: leadNew.id,
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
    const cNew = await convs.create({
      lead_id: leadNew.id,
      canal: "wa",
      canal_thread_id: "new",
    });
    await messages.create({
      conversacion_id: cNew.id,
      lead_session_id: sNew.id,
      direction: "in",
      sender: "lead",
      sender_user_id: null,
      tipo: "text",
      contenido: "msg nueva",
      media_url: null,
      meta_message_id: null,
      idempotency_key: null,
      metadata: {},
    });

    const out = await svc.listActiveLeads();
    expect(out.map((i) => i.nombre)).toEqual(["New", "Old"]);
  });

  test("merges canales when lead has multiple conversations", async () => {
    const lead = await makeLead(leads);
    const session = await sessions.create({
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
    await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });
    await convs.create({ lead_id: lead.id, canal: "ig", canal_thread_id: "ig-1" });

    const out = await svc.listActiveLeads();
    expect(out).toHaveLength(1);
    expect([...out[0]!.canales].sort()).toEqual(["ig", "wa"]);
    expect(out[0]!.sessionId).toBe(session.id);
  });

  // El bug que reportó el dueño: la fila mostraba un logo y el header dos,
  // porque la fila derivaba los canales de las conversaciones y el header de la
  // entidad. Un lead vinculado a Instagram sin hilo abierto ahí lo destapa.
  test("los canales incluyen los vinculados por meta_user_ids, sin conversación", async () => {
    const lead = await makeLead(leads, {
      canal_origen: "wa",
      meta_user_ids: { wa: "wa-1", ig: "ig-1" },
    });
    await makeSession(sessions, lead.id);
    await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });

    const out = await svc.listActiveLeads();

    expect(out[0]?.canales).toEqual(["wa", "ig"]);
    // Y el activo sigue saliendo del hilo, no de la lista de vinculados.
    expect(out[0]?.canalActivo).toBe("wa");
  });

  test("ultimoMensaje is null when lead has no messages", async () => {
    const lead = await makeLead(leads);
    await sessions.create({
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
    await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });

    const out = await svc.listActiveLeads();
    expect(out).toHaveLength(1);
    expect(out[0]!.ultimoMensaje).toBeNull();
  });

  test("skips sessions whose lead row was deleted (defensive)", async () => {
    const orphanLeadId = crypto.randomUUID();
    await sessions.create({
      lead_id: orphanLeadId,
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

    const out = await svc.listActiveLeads();
    expect(out).toEqual([]);
  });
});

describe("DefaultInboxService.getConversation", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let convs: InMemoryConversationsRepository;
  let messages: InMemoryMessagesRepository;
  let svc: DefaultInboxService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    convs = new InMemoryConversationsRepository();
    messages = new InMemoryMessagesRepository();
    svc = new DefaultInboxService(makeReadOnlyDeps(leads, sessions, convs, messages));
  });

  test("happy path: lead + sesión activa + mensajes ASC cross-conv + canalActivo por actividad", async () => {
    const lead = await makeLead(leads, { nombre: "Juan Pérez" });
    const session = await makeSession(sessions, lead.id, { current_stage: "cotizado" });
    const convWa = await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });
    await new Promise((r) => setTimeout(r, 5));
    const convIg = await convs.create({ lead_id: lead.id, canal: "ig", canal_thread_id: "ig-1" });

    const m1 = await messages.create(msgInsert(convWa.id, session.id, { contenido: "Hola" }));
    await new Promise((r) => setTimeout(r, 5));
    const m2 = await messages.create(
      msgInsert(convIg.id, session.id, {
        direction: "out",
        sender: "ia",
        contenido: "Hola! En qué te ayudo?",
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
    const m3 = await messages.create(
      msgInsert(convIg.id, session.id, { contenido: "Busco pastillas de freno" }),
    );

    const view = await svc.getConversation(lead.id);

    expect(view.lead.id).toBe(lead.id);
    expect(view.lead.nombre).toBe("Juan Pérez");
    expect(view.session?.id).toBe(session.id);
    expect(view.session?.current_stage).toBe("cotizado");
    expect(view.messages.map((m) => m.id)).toEqual([m1.id, m2.id, m3.id]);
    // convIg creada después → ultima_actividad_at más reciente → canal activo.
    expect(view.canalActivo).toBe("ig");
  });

  test("lead inexistente lanza NotFoundError", async () => {
    await expect(svc.getConversation(crypto.randomUUID())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("sin sesión activa: session null + messages vacío", async () => {
    const lead = await makeLead(leads);
    // Sesión cerrada (resultado seteado) NO cuenta como activa.
    await makeSession(sessions, lead.id, { resultado: "perdido" });
    await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });

    const view = await svc.getConversation(lead.id);

    expect(view.session).toBeNull();
    expect(view.messages).toEqual([]);
  });

  test("sin conversaciones: canalActivo cae a canal_origen", async () => {
    const lead = await makeLead(leads, { canal_origen: "fb" });
    await makeSession(sessions, lead.id);

    const view = await svc.getConversation(lead.id);

    expect(view.canalActivo).toBe("fb");
  });

  test("mensajes de otra sesión quedan excluidos", async () => {
    const lead = await makeLead(leads);
    const session = await makeSession(sessions, lead.id);
    const conv = await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });

    const otherLead = await makeLead(leads, { nombre: "Otro" });
    const otherSession = await makeSession(sessions, otherLead.id);
    const otherConv = await convs.create({
      lead_id: otherLead.id,
      canal: "wa",
      canal_thread_id: "wa-2",
    });

    const own = await messages.create(msgInsert(conv.id, session.id, { contenido: "propio" }));
    await messages.create(msgInsert(otherConv.id, otherSession.id, { contenido: "ajeno" }));

    const view = await svc.getConversation(lead.id);

    expect(view.messages.map((m) => m.id)).toEqual([own.id]);
  });
});

describe("DefaultInboxService.getConversation — datos del Lead Twin", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let convs: InMemoryConversationsRepository;
  let messages: InMemoryMessagesRepository;
  let productos: InMemoryProductsRepository;
  let tags: InMemoryTagsRepository;
  let svc: DefaultInboxService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    convs = new InMemoryConversationsRepository();
    messages = new InMemoryMessagesRepository();
    productos = new InMemoryProductsRepository();
    tags = new InMemoryTagsRepository();
    svc = new DefaultInboxService(
      makeReadOnlyDeps(leads, sessions, convs, messages, productos, tags),
    );
  });

  async function producto(stock: number) {
    return productos.create({
      codigo_interno: `PF-${stock}`,
      sku_proveedor: null,
      nombre: "Pastilla de freno delantera",
      descripcion: null,
      categoria: null,
      compatibilidad: [],
      precio: 120_000,
      stock,
      imagen_url: null,
      activo: true,
    });
  }

  test("resuelve producto_cotizado_id contra el catálogo", async () => {
    const lead = await makeLead(leads);
    const prod = await producto(4);
    await sessions.create({
      lead_id: lead.id,
      current_stage: "cotizado",
      urgencia: "media",
      consulta: "",
      producto_cotizado_id: prod.id,
      codigo_interno: prod.codigo_interno,
      precio_cotizado: prod.precio,
      cantidad: 1,
      bloqueador: null,
      comprobante_pago_url: null,
      metodo_pago: null,
      resultado: null,
      motivo_perdida: null,
      ia_pausada: false,
    });

    const view = await svc.getConversation(lead.id);

    expect(view.producto?.id).toBe(prod.id);
    expect(view.producto?.stock).toBe(4);
  });

  test("sin producto cotizado el Twin no inventa uno", async () => {
    const lead = await makeLead(leads);
    await makeSession(sessions, lead.id);

    const view = await svc.getConversation(lead.id);

    expect(view.producto).toBeNull();
  });

  test("un producto borrado del catálogo no rompe la ficha", async () => {
    const lead = await makeLead(leads);
    await sessions.create({
      lead_id: lead.id,
      current_stage: "cotizado",
      urgencia: "media",
      consulta: "",
      producto_cotizado_id: crypto.randomUUID(),
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

    const view = await svc.getConversation(lead.id);

    expect(view.producto).toBeNull();
  });

  test("trae los tags del lead", async () => {
    const lead = await makeLead(leads);
    await makeSession(sessions, lead.id);
    const tag = await tags.create({ nombre: "mayorista", color: "#38BDF8", descripcion: null });
    await tags.assignToLead(lead.id, tag.id, "manual", null);

    const view = await svc.getConversation(lead.id);

    expect(view.tags).toEqual([
      { id: tag.id, nombre: "mayorista", color: "#38BDF8", descripcion: null },
    ]);
  });

  test("trae el catálogo entero de tags, ordenado, para el selector", async () => {
    const lead = await makeLead(leads);
    await makeSession(sessions, lead.id);
    const puesta = await tags.create({ nombre: "mayorista", color: "#38BDF8", descripcion: null });
    await tags.create({ nombre: "flota", color: "#34D399", descripcion: null });
    await tags.assignToLead(lead.id, puesta.id, "manual", null);

    const view = await svc.getConversation(lead.id);

    // Incluye la que el lead ya tiene: el selector necesita el catálogo entero
    // para saber qué nombre existe y no ofrecer crearlo de nuevo.
    expect(view.tagsDisponibles.map((t) => t.nombre)).toEqual(["flota", "mayorista"]);
  });

  test("las sesiones previas no cuentan la abierta", async () => {
    const lead = await makeLead(leads);
    const vieja = await makeSession(sessions, lead.id);
    await sessions.close(vieja.id, { resultado: "exito" });
    const otra = await makeSession(sessions, lead.id);
    await sessions.close(otra.id, { resultado: "perdido", motivo_perdida: "precio" });
    await makeSession(sessions, lead.id);

    const view = await svc.getConversation(lead.id);

    expect(view.sesionesPrevias).toEqual({ total: 2, conCompra: 1 });
  });

  test("sin sesión abierta las cerradas siguen contando como previas", async () => {
    const lead = await makeLead(leads);
    const vieja = await makeSession(sessions, lead.id);
    await sessions.close(vieja.id, { resultado: "exito" });

    const view = await svc.getConversation(lead.id);

    expect(view.session).toBeNull();
    expect(view.sesionesPrevias).toEqual({ total: 1, conCompra: 1 });
  });
});

describe("DefaultInboxService.getConversation — gasto de IA de la conversación", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let convs: InMemoryConversationsRepository;
  let messages: InMemoryMessagesRepository;
  let llmUsage: InMemoryLlmUsageRepository;
  let svc: DefaultInboxService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    convs = new InMemoryConversationsRepository();
    messages = new InMemoryMessagesRepository();
    llmUsage = new InMemoryLlmUsageRepository();
    svc = new DefaultInboxService(
      makeReadOnlyDeps(
        leads,
        sessions,
        convs,
        messages,
        new InMemoryProductsRepository(),
        new InMemoryTagsRepository(),
        llmUsage,
      ),
    );
  });

  /** Una llamada al modelo anotada. `at` mueve la fila en el tiempo. */
  async function anotarGasto(
    sessionId: UUID | null,
    costoUsd: number,
    opts: { workflow?: string; at?: Date } = {},
  ) {
    return llmUsage.create({
      lead_session_id: sessionId,
      mensaje_id: null,
      modelo: "gpt-4o-mini",
      input_tokens: 1200,
      output_tokens: 300,
      costo_usd: costoUsd,
      workflow: opts.workflow ?? WORKFLOW_LLM.agente,
      ...(opts.at ? { created_at: opts.at } : {}),
    });
  }

  const HACE_UNA_HORA = () => new Date(Date.now() - 60 * 60 * 1000);
  const EN_UNA_HORA = () => new Date(Date.now() + 60 * 60 * 1000);

  test("suma las llamadas de la sesión: es el 'cuánto va gastando' del panel", async () => {
    const lead = await makeLead(leads);
    const session = await makeSession(sessions, lead.id);

    // Los tres tipos de llamada que dispara un turno real.
    await anotarGasto(session.id, 0.004, { workflow: WORKFLOW_LLM.agente });
    await anotarGasto(session.id, 0.0005, { workflow: WORKFLOW_LLM.clasificador });
    await anotarGasto(session.id, 0.0015, { workflow: WORKFLOW_LLM.extractorTwin });

    const view = await svc.getConversation(lead.id);

    expect(view.gastoIa).toEqual({ estado: "medido", usd: 0.006, llamadas: 3 });
  });

  test("no se le imputa el gasto de otra sesión ni el que no pertenece a ninguna", async () => {
    const lead = await makeLead(leads);
    const session = await makeSession(sessions, lead.id);
    const otroLead = await makeLead(leads, { nombre: "Otro" });
    const otraSesion = await makeSession(sessions, otroLead.id);

    await anotarGasto(session.id, 0.002);
    await anotarGasto(otraSesion.id, 9.99);
    // El detector batch corre sobre muchas sesiones y no pertenece a ninguna.
    await anotarGasto(null, 0.5, { workflow: WORKFLOW_LLM.detectorBatch });

    const view = await svc.getConversation(lead.id);

    expect(view.gastoIa).toEqual({ estado: "medido", usd: 0.002, llamadas: 1 });
  });

  test("las pruebas de la consola no encarecen al lead: el preview no se le imputa", async () => {
    const lead = await makeLead(leads);
    const session = await makeSession(sessions, lead.id);

    await anotarGasto(session.id, 0.003, { workflow: WORKFLOW_LLM.agente });
    // El preview replaya esta misma sesión para probar una config candidata:
    // lleva su id, pero no le mandó nada al cliente.
    await anotarGasto(session.id, 2.5, { workflow: WORKFLOW_LLM.agentePreview });

    const view = await svc.getConversation(lead.id);

    expect(view.gastoIa).toEqual({ estado: "medido", usd: 0.003, llamadas: 1 });
  });

  test("una sesión donde solo se probó la consola no tiene gasto propio", async () => {
    const lead = await makeLead(leads);
    // Ya hay registro andando desde antes: el cero de esta sesión es real.
    const otroLead = await makeLead(leads, { nombre: "Otro" });
    const otraSesion = await makeSession(sessions, otroLead.id);
    await anotarGasto(otraSesion.id, 0.01, { at: HACE_UNA_HORA() });

    const session = await makeSession(sessions, lead.id);
    await anotarGasto(session.id, 2.5, { workflow: WORKFLOW_LLM.agentePreview });

    const view = await svc.getConversation(lead.id);

    expect(view.gastoIa).toEqual({ estado: "sin_gasto" });
  });

  test("lo que manda es que haya filas, no que sumen algo: cero con llamadas sigue siendo medido", async () => {
    const lead = await makeLead(leads);
    const session = await makeSession(sessions, lead.id);
    await anotarGasto(session.id, 0);

    const view = await svc.getConversation(lead.id);

    expect(view.gastoIa).toEqual({ estado: "medido", usd: 0, llamadas: 1 });
  });

  test("sin llamadas pero con el registro ya andando, el cero es real", async () => {
    const lead = await makeLead(leads);
    // Otra conversación ya dejó gasto anotado antes de que esta empezara: el
    // registro estaba funcionando, así que que esta no tenga filas significa
    // que ningún turno suyo llamó al modelo.
    const otroLead = await makeLead(leads, { nombre: "Otro" });
    const otraSesion = await makeSession(sessions, otroLead.id);
    await anotarGasto(otraSesion.id, 0.01, { at: HACE_UNA_HORA() });

    await makeSession(sessions, lead.id);

    const view = await svc.getConversation(lead.id);

    expect(view.gastoIa).toEqual({ estado: "sin_gasto" });
  });

  test("una sesión anterior a la primera llamada anotada no dice cero: dice que no hay dato", async () => {
    const lead = await makeLead(leads);
    await makeSession(sessions, lead.id);
    // La primera fila de la tabla es posterior al inicio de esta sesión: es la
    // conversación vieja, de antes de que se instrumentara el gasto.
    const otroLead = await makeLead(leads, { nombre: "Otro" });
    const otraSesion = await makeSession(sessions, otroLead.id);
    await anotarGasto(otraSesion.id, 0.01, { at: EN_UNA_HORA() });

    const view = await svc.getConversation(lead.id);

    expect(view.gastoIa).toEqual({ estado: "sin_registro" });
  });

  test("con la tabla vacía nada se midió todavía, así que tampoco hay cero", async () => {
    const lead = await makeLead(leads);
    await makeSession(sessions, lead.id);

    const view = await svc.getConversation(lead.id);

    expect(view.gastoIa).toEqual({ estado: "sin_registro" });
  });

  test("sin sesión activa no hay a qué atribuirle gasto", async () => {
    const lead = await makeLead(leads);
    const cerrada = await makeSession(sessions, lead.id);
    await anotarGasto(cerrada.id, 0.01);
    await sessions.close(cerrada.id, { resultado: "exito" });

    const view = await svc.getConversation(lead.id);

    expect(view.session).toBeNull();
    expect(view.gastoIa).toBeNull();
  });
});

describe("DefaultInboxService.listActiveLeads edge cases (8.8)", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let convs: InMemoryConversationsRepository;
  let messages: InMemoryMessagesRepository;
  let svc: DefaultInboxService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    convs = new InMemoryConversationsRepository();
    messages = new InMemoryMessagesRepository();
    svc = new DefaultInboxService(makeReadOnlyDeps(leads, sessions, convs, messages));
  });

  test("lead sin conversaciones: ultimaActividad cae a started_at de la sesión", async () => {
    const lead = await makeLead(leads);
    const session = await makeSession(sessions, lead.id);

    const out = await svc.listActiveLeads();

    expect(out).toHaveLength(1);
    expect(out[0]?.ultimaActividad.getTime()).toBe(session.started_at.getTime());
    expect(out[0]?.ultimoMensaje).toBeNull();
    // Sin conversación abierta el lead igual tiene canal: entró por alguno, y
    // eso es lo que la fila del inbox tiene que poder decir.
    expect(out[0]?.canales).toEqual(["wa"]);
    // "Activo" es otra cosa: sin hilo no hay canal por el que responder.
    expect(out[0]?.canalActivo).toBeNull();
  });

  test("último mensaje gana cross-canal por timestamp, en ambos órdenes de iteración", async () => {
    const lead = await makeLead(leads);
    const session = await makeSession(sessions, lead.id);
    // 3 convs: el mensaje del medio primero, el más nuevo segundo, el más
    // viejo tercero → la comparación con lastMsg ya seteado ejercita
    // reemplazo (true) y descarte (false).
    const convWa = await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });
    const convIg = await convs.create({ lead_id: lead.id, canal: "ig", canal_thread_id: "ig-1" });
    const convFb = await convs.create({ lead_id: lead.id, canal: "fb", canal_thread_id: "fb-1" });

    await messages.create(msgInsert(convFb.id, session.id, { contenido: "viejo" }));
    await new Promise((r) => setTimeout(r, 5));
    await messages.create(msgInsert(convWa.id, session.id, { contenido: "medio" }));
    await new Promise((r) => setTimeout(r, 5));
    await messages.create(msgInsert(convIg.id, session.id, { contenido: "más nuevo" }));

    const out = await svc.listActiveLeads();

    expect(out[0]?.ultimoMensaje?.body).toBe("más nuevo");
  });

  test("mensaje con contenido null (media) produce body vacío", async () => {
    const lead = await makeLead(leads);
    const session = await makeSession(sessions, lead.id);
    const conv = await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });
    await messages.create(msgInsert(conv.id, session.id, { tipo: "image", contenido: null }));

    const out = await svc.listActiveLeads();

    expect(out[0]?.ultimoMensaje?.body).toBe("");
  });
});

describe("DefaultInboxService.listActiveLeads — triage (sub-proyecto D)", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let convs: InMemoryConversationsRepository;
  let messages: InMemoryMessagesRepository;
  let svc: DefaultInboxService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    convs = new InMemoryConversationsRepository();
    messages = new InMemoryMessagesRepository();
    svc = new DefaultInboxService(makeReadOnlyDeps(leads, sessions, convs, messages));
  });

  test("canalActivo es el canal del último mensaje, no el primero del set", async () => {
    const lead = await makeLead(leads, { canal_origen: "wa" });
    const session = await makeSession(sessions, lead.id);
    const convWa = await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });
    const convIg = await convs.create({ lead_id: lead.id, canal: "ig", canal_thread_id: "ig-1" });

    await messages.create(msgInsert(convWa.id, session.id, { contenido: "por whatsapp" }));
    await new Promise((r) => setTimeout(r, 5));
    await messages.create(msgInsert(convIg.id, session.id, { contenido: "ahora por instagram" }));

    const out = await svc.listActiveLeads();

    expect(out[0]?.canalActivo).toBe("ig");
  });

  test("sin mensajes, canalActivo cae al primer canal con conversación", async () => {
    const lead = await makeLead(leads);
    await makeSession(sessions, lead.id);
    await convs.create({ lead_id: lead.id, canal: "fb", canal_thread_id: "fb-1" });

    const out = await svc.listActiveLeads();

    expect(out[0]?.canalActivo).toBe("fb");
  });

  test("cuenta los entrantes posteriores a la última respuesta nuestra", async () => {
    const lead = await makeLead(leads);
    const session = await makeSession(sessions, lead.id);
    const conv = await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });

    await messages.create(msgInsert(conv.id, session.id, { contenido: "hola" }));
    await new Promise((r) => setTimeout(r, 5));
    await messages.create(
      msgInsert(conv.id, session.id, { direction: "out", sender: "ia", contenido: "hola!" }),
    );
    await new Promise((r) => setTimeout(r, 5));
    await messages.create(msgInsert(conv.id, session.id, { contenido: "tenés el filtro?" }));
    await new Promise((r) => setTimeout(r, 5));
    await messages.create(msgInsert(conv.id, session.id, { contenido: "hola?" }));

    const out = await svc.listActiveLeads();

    expect(out[0]?.sinResponder).toBe(2);
    expect(out[0]?.esperandoDesde).toBeInstanceOf(Date);
  });

  test("un mensaje de sistema no cuenta como respuesta al cliente", async () => {
    const lead = await makeLead(leads);
    const session = await makeSession(sessions, lead.id);
    const conv = await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });

    await messages.create(msgInsert(conv.id, session.id, { contenido: "necesito el precio" }));
    await new Promise((r) => setTimeout(r, 5));
    await messages.create(
      msgInsert(conv.id, session.id, {
        direction: "out",
        sender: "sistema",
        contenido: "sesión reasignada",
      }),
    );

    const out = await svc.listActiveLeads();

    expect(out[0]?.sinResponder).toBe(1);
  });

  test("respondido queda en 0 sin nada esperando", async () => {
    const lead = await makeLead(leads);
    const session = await makeSession(sessions, lead.id);
    const conv = await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });

    await messages.create(msgInsert(conv.id, session.id, { contenido: "hola" }));
    await new Promise((r) => setTimeout(r, 5));
    await messages.create(
      msgInsert(conv.id, session.id, { direction: "out", sender: "humano", contenido: "ahí va" }),
    );

    const out = await svc.listActiveLeads();

    expect(out[0]?.sinResponder).toBe(0);
    expect(out[0]?.esperandoDesde).toBeNull();
    expect(out[0]?.motivo).toBeNull();
  });

  test("la IA pausada manda la conversación al grupo que requiere atención", async () => {
    const lead = await makeLead(leads);
    await makeSession(sessions, lead.id, { ia_pausada: true });
    await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });

    const out = await svc.listActiveLeads();

    expect(out[0]?.motivo).toEqual({ tipo: "humano", texto: "La atiende un vendedor" });
  });

  test("contarRequierenAtencion cuenta solo las que tienen motivo", async () => {
    const escalado = await makeLead(leads, { nombre: "Escalado" });
    await makeSession(sessions, escalado.id, { current_stage: "requiere_humano" });
    const tranquilo = await makeLead(leads, { nombre: "Tranquilo" });
    await makeSession(sessions, tranquilo.id);

    expect(await svc.contarRequierenAtencion()).toBe(1);
  });

  test("las conversaciones con motivo encabezan la lista aunque sean menos recientes", async () => {
    const viejo = await makeLead(leads, { nombre: "Escalado" });
    const sesionVieja = await makeSession(sessions, viejo.id, { current_stage: "requiere_humano" });
    const convVieja = await convs.create({
      lead_id: viejo.id,
      canal: "wa",
      canal_thread_id: "wa-viejo",
    });
    await messages.create(msgInsert(convVieja.id, sesionVieja.id, { contenido: "ayuda" }));

    await new Promise((r) => setTimeout(r, 5));

    const nuevo = await makeLead(leads, { nombre: "Tranquilo" });
    const sesionNueva = await makeSession(sessions, nuevo.id);
    const convNueva = await convs.create({
      lead_id: nuevo.id,
      canal: "wa",
      canal_thread_id: "wa-nuevo",
    });
    await messages.create(
      msgInsert(convNueva.id, sesionNueva.id, {
        direction: "out",
        sender: "ia",
        contenido: "listo",
      }),
    );

    const out = await svc.listActiveLeads();

    expect(out.map((i) => i.nombre)).toEqual(["Escalado", "Tranquilo"]);
  });
});
