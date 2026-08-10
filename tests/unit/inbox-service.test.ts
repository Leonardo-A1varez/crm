import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import {
  InMemoryMessagesRepository,
  type MensajeInsert,
} from "@/server/repositories/messages.repo";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultInboxService } from "@/server/services/inbox/default-inbox.service";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import type { Lead, LeadSession, UUID } from "@/types/entities";

// Read path no toca Meta; client jamás debería invocarse en esta suite.
function makeReadOnlyDeps(
  leads: InMemoryLeadsRepository,
  sessions: InMemoryLeadSessionRepository,
  convs: InMemoryConversationsRepository,
  messages: InMemoryMessagesRepository,
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
    expect([...view.canales].sort()).toEqual(["ig", "wa"]);
    // convIg creada después → ultima_actividad_at más reciente → canal activo.
    expect(view.canalActivo).toBe("ig");
  });

  test("lead inexistente lanza NotFoundError", async () => {
    await expect(svc.getConversation(crypto.randomUUID())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("sin sesión activa: session null + messages vacío + canales derivados", async () => {
    const lead = await makeLead(leads);
    // Sesión cerrada (resultado seteado) NO cuenta como activa.
    await makeSession(sessions, lead.id, { resultado: "perdido" });
    await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });

    const view = await svc.getConversation(lead.id);

    expect(view.session).toBeNull();
    expect(view.messages).toEqual([]);
    expect(view.canales).toEqual(["wa"]);
  });

  test("sin conversaciones: canales vacío + canalActivo cae a canal_origen", async () => {
    const lead = await makeLead(leads, { canal_origen: "fb" });
    await makeSession(sessions, lead.id);

    const view = await svc.getConversation(lead.id);

    expect(view.canales).toEqual([]);
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
    expect(out[0]?.canales).toEqual([]);
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
    expect(out[0]?.prioridad).toBe("baja");
    expect(out[0]?.motivo).toBeNull();
  });

  test("la IA pausada sube la prioridad aunque no haya nada sin responder", async () => {
    const lead = await makeLead(leads);
    await makeSession(sessions, lead.id, { ia_pausada: true });
    await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });

    const out = await svc.listActiveLeads();

    expect(out[0]?.prioridad).toBe("alta");
    expect(out[0]?.motivo).toBe("IA pausada, contesta un vendedor");
  });

  test("las prioridades altas encabezan la lista aunque sean menos recientes", async () => {
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
