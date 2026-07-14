import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultInboxService } from "@/server/services/inbox/default-inbox.service";
import {
  DefaultMetaApiService,
  type MetaApiClient,
  type MetaSendResult,
  type MetaSendTextInput,
} from "@/server/services/meta-api.service";
import type { Lead, LeadSession, UUID } from "@/types/entities";

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

describe("DefaultInboxService write path", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let convs: InMemoryConversationsRepository;
  let messages: InMemoryMessagesRepository;
  let client: MetaApiClient;
  let sendTextSpy: Mock<(input: MetaSendTextInput) => Promise<MetaSendResult>>;
  let svc: DefaultInboxService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    convs = new InMemoryConversationsRepository();
    messages = new InMemoryMessagesRepository();
    sendTextSpy = vi.fn(async (_input: MetaSendTextInput) => ({
      meta_message_id: `wamid.${crypto.randomUUID()}`,
    }));
    client = { sendText: sendTextSpy };
    svc = new DefaultInboxService({
      leads,
      sessions,
      convs,
      messages,
      metaApi: new DefaultMetaApiService(convs, messages, client),
      handoff: new DefaultHandoffService(sessions),
    });
  });

  describe("sendMessage", () => {
    test("envía por Meta y persiste mensaje out sender humano", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);
      const conv = await convs.create({
        lead_id: lead.id,
        canal: "wa",
        canal_thread_id: lead.telefono,
      });

      const msg = await svc.sendMessage({
        leadId: lead.id,
        sessionId: session.id,
        canal: "wa",
        body: "Hola, le confirmo stock",
      });

      expect(msg.direction).toBe("out");
      expect(msg.sender).toBe("humano");
      expect(msg.contenido).toBe("Hola, le confirmo stock");
      expect(msg.conversacion_id).toBe(conv.id);
      expect(msg.lead_session_id).toBe(session.id);
      expect(sendTextSpy).toHaveBeenCalledExactlyOnceWith({
        canal: "wa",
        to: conv.canal_thread_id,
        text: "Hola, le confirmo stock",
      });

      const thread = await messages.listBySessionId(session.id);
      expect(thread).toHaveLength(1);
      expect(thread[0]?.id).toBe(msg.id);
    });

    test("NotFoundError cuando sesión no existe", async () => {
      const lead = await makeLead(leads);
      await expect(
        svc.sendMessage({
          leadId: lead.id,
          sessionId: crypto.randomUUID(),
          canal: "wa",
          body: "hola",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(sendTextSpy).not.toHaveBeenCalled();
    });

    test("ConflictError cuando sesión está cerrada", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);
      await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: lead.telefono });
      await sessions.close(session.id, { resultado: "exito" });

      await expect(
        svc.sendMessage({ leadId: lead.id, sessionId: session.id, canal: "wa", body: "hola" }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(sendTextSpy).not.toHaveBeenCalled();
    });

    test("ValidationError cuando sesión no pertenece al lead", async () => {
      const leadA = await makeLead(leads);
      const leadB = await makeLead(leads);
      const sessionB = await makeSession(sessions, leadB.id);
      await convs.create({ lead_id: leadA.id, canal: "wa", canal_thread_id: leadA.telefono });

      await expect(
        svc.sendMessage({ leadId: leadA.id, sessionId: sessionB.id, canal: "wa", body: "hola" }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(sendTextSpy).not.toHaveBeenCalled();
    });

    test("NotFoundError cuando el lead no tiene conversación en el canal", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);
      await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: lead.telefono });

      await expect(
        svc.sendMessage({ leadId: lead.id, sessionId: session.id, canal: "ig", body: "hola" }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(sendTextSpy).not.toHaveBeenCalled();
    });

    test("si Meta falla, propaga y NO persiste mensaje", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);
      await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: lead.telefono });
      sendTextSpy.mockRejectedValueOnce(new Error("meta caída"));

      await expect(
        svc.sendMessage({ leadId: lead.id, sessionId: session.id, canal: "wa", body: "hola" }),
      ).rejects.toThrow("meta caída");

      const thread = await messages.listBySessionId(session.id);
      expect(thread).toHaveLength(0);
    });
  });

  describe("toggleHandoff", () => {
    test("pause marca ia_pausada true", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);

      const updated = await svc.toggleHandoff({ sessionId: session.id, action: "pause" });

      expect(updated.ia_pausada).toBe(true);
      const persisted = await sessions.findById(session.id);
      expect(persisted?.ia_pausada).toBe(true);
    });

    test("resume marca ia_pausada false", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id, { ia_pausada: true });

      const updated = await svc.toggleHandoff({ sessionId: session.id, action: "resume" });

      expect(updated.ia_pausada).toBe(false);
    });

    test("ConflictError cuando sesión cerrada", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);
      await sessions.close(session.id, { resultado: "perdido", motivo_perdida: "precio" });

      await expect(
        svc.toggleHandoff({ sessionId: session.id, action: "pause" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("closeSession", () => {
    test("cierra con exito y setea closed_at", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);

      const closed = await svc.closeSession({ sessionId: session.id, resultado: "exito" });

      expect(closed.resultado).toBe("exito");
      expect(closed.closed_at).toBeInstanceOf(Date);
      expect(closed.motivo_perdida).toBeNull();
    });

    test("cierra perdido con motivo enum", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);

      const closed = await svc.closeSession({
        sessionId: session.id,
        resultado: "perdido",
        motivoPerdida: "precio",
      });

      expect(closed.resultado).toBe("perdido");
      expect(closed.motivo_perdida).toBe("precio");
    });

    test("replay idéntico es no-op (idempotente)", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);

      const first = await svc.closeSession({ sessionId: session.id, resultado: "exito" });
      const second = await svc.closeSession({ sessionId: session.id, resultado: "exito" });

      expect(second.closed_at?.getTime()).toBe(first.closed_at?.getTime());
    });

    test("NotFoundError cuando sesión no existe", async () => {
      await expect(
        svc.closeSession({ sessionId: crypto.randomUUID(), resultado: "exito" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
