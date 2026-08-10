import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryLlmUsageRepository } from "@/server/repositories/llm-usage.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
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

/** El vendedor autenticado que manda desde el panel. Va a `sender_user_id`. */
const vendedorId: UUID = "00000000-0000-0000-0000-0000000000a1";

describe("DefaultInboxService write path", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let convs: InMemoryConversationsRepository;
  let messages: InMemoryMessagesRepository;
  let tags: InMemoryTagsRepository;
  let client: MetaApiClient;
  let sendTextSpy: Mock<(input: MetaSendTextInput) => Promise<MetaSendResult>>;
  let svc: DefaultInboxService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    convs = new InMemoryConversationsRepository();
    messages = new InMemoryMessagesRepository();
    tags = new InMemoryTagsRepository();
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
      productos: new InMemoryProductsRepository(),
      tags,
      llmUsage: new InMemoryLlmUsageRepository(),
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
        userId: vendedorId,
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
      // El envío manual tiene que dejar quién lo mandó: es la única fuente del
      // corte por vendedor en Métricas. Se comprueba sobre la fila persistida y
      // no sobre lo devuelto, que es lo que la tabla va a leer después.
      expect(thread[0]?.sender_user_id).toBe(vendedorId);
    });

    test("sin usuario autenticado el mensaje queda sin atribuir, no falla", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);
      await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: lead.telefono });

      const msg = await svc.sendMessage({
        leadId: lead.id,
        sessionId: session.id,
        canal: "wa",
        body: "hola",
        userId: null,
      });

      expect(msg.sender).toBe("humano");
      expect(msg.sender_user_id).toBeNull();
    });

    test("NotFoundError cuando sesión no existe", async () => {
      const lead = await makeLead(leads);
      await expect(
        svc.sendMessage({
          leadId: lead.id,
          sessionId: crypto.randomUUID(),
          canal: "wa",
          body: "hola",
          userId: vendedorId,
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
        svc.sendMessage({
          leadId: lead.id,
          sessionId: session.id,
          canal: "wa",
          body: "hola",
          userId: vendedorId,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(sendTextSpy).not.toHaveBeenCalled();
    });

    test("ValidationError cuando sesión no pertenece al lead", async () => {
      const leadA = await makeLead(leads);
      const leadB = await makeLead(leads);
      const sessionB = await makeSession(sessions, leadB.id);
      await convs.create({ lead_id: leadA.id, canal: "wa", canal_thread_id: leadA.telefono });

      await expect(
        svc.sendMessage({
          leadId: leadA.id,
          sessionId: sessionB.id,
          canal: "wa",
          body: "hola",
          userId: vendedorId,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(sendTextSpy).not.toHaveBeenCalled();
    });

    test("NotFoundError cuando el lead no tiene conversación en el canal", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);
      await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: lead.telefono });

      await expect(
        svc.sendMessage({
          leadId: lead.id,
          sessionId: session.id,
          canal: "ig",
          body: "hola",
          userId: vendedorId,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(sendTextSpy).not.toHaveBeenCalled();
    });

    test("si Meta falla, propaga y NO persiste mensaje", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);
      await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: lead.telefono });
      sendTextSpy.mockRejectedValueOnce(new Error("meta caída"));

      await expect(
        svc.sendMessage({
          leadId: lead.id,
          sessionId: session.id,
          canal: "wa",
          body: "hola",
          userId: vendedorId,
        }),
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

  describe("renombrarLead", () => {
    test("guarda el nombre trimeado", async () => {
      const lead = await makeLead(leads, { nombre: "" });

      const actualizado = await svc.renombrarLead({ leadId: lead.id, nombre: "  Ramón Díaz  " });

      expect(actualizado.nombre).toBe("Ramón Díaz");
      expect((await leads.findById(lead.id))?.nombre).toBe("Ramón Díaz");
    });

    test("acepta vacío: devolver el lead a «sin identificar» es válido", async () => {
      const lead = await makeLead(leads, { nombre: "Ramón" });

      const actualizado = await svc.renombrarLead({ leadId: lead.id, nombre: "   " });

      expect(actualizado.nombre).toBe("");
    });

    test("no exige sesión activa: el lead vive más que la sesión", async () => {
      const lead = await makeLead(leads, { nombre: "" });
      const session = await makeSession(sessions, lead.id);
      await sessions.close(session.id, { resultado: "exito" });

      const actualizado = await svc.renombrarLead({ leadId: lead.id, nombre: "Ramón" });

      expect(actualizado.nombre).toBe("Ramón");
    });

    test("NotFoundError cuando el lead no existe", async () => {
      await expect(
        svc.renombrarLead({ leadId: crypto.randomUUID(), nombre: "Ramón" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("etiquetas del lead", () => {
    test("asignar deja source manual y quién la puso", async () => {
      const lead = await makeLead(leads);
      const tag = await tags.create({ nombre: "mayorista", color: "#38BDF8", descripcion: null });

      await svc.asignarEtiqueta({ leadId: lead.id, tagId: tag.id, userId: vendedorId });

      const puestas = await tags.listByLead(lead.id);
      expect(puestas).toHaveLength(1);
      expect(puestas[0]).toMatchObject({
        id: tag.id,
        nombre: "mayorista",
        source: "manual",
        assigned_by: vendedorId,
      });
    });

    test("asignar dos veces no pisa quién la había puesto", async () => {
      const lead = await makeLead(leads);
      const tag = await tags.create({ nombre: "mayorista", color: "#38BDF8", descripcion: null });
      await svc.asignarEtiqueta({ leadId: lead.id, tagId: tag.id, userId: vendedorId });

      await svc.asignarEtiqueta({ leadId: lead.id, tagId: tag.id, userId: null });

      const puestas = await tags.listByLead(lead.id);
      expect(puestas).toHaveLength(1);
      expect(puestas[0]?.assigned_by).toBe(vendedorId);
    });

    test("NotFoundError cuando el tag no existe", async () => {
      const lead = await makeLead(leads);

      await expect(
        svc.asignarEtiqueta({ leadId: lead.id, tagId: crypto.randomUUID(), userId: vendedorId }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    test("NotFoundError cuando el lead no existe", async () => {
      const tag = await tags.create({ nombre: "mayorista", color: "#38BDF8", descripcion: null });

      await expect(
        svc.asignarEtiqueta({ leadId: crypto.randomUUID(), tagId: tag.id, userId: vendedorId }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    test("quitar saca la etiqueta del lead pero no del catálogo", async () => {
      const lead = await makeLead(leads);
      const tag = await tags.create({ nombre: "mayorista", color: "#38BDF8", descripcion: null });
      await svc.asignarEtiqueta({ leadId: lead.id, tagId: tag.id, userId: vendedorId });

      await svc.quitarEtiqueta({ leadId: lead.id, tagId: tag.id });

      expect(await tags.listByLead(lead.id)).toHaveLength(0);
      expect(await tags.findById(tag.id)).not.toBeNull();
    });

    test("quitar una que no estaba es no-op", async () => {
      const lead = await makeLead(leads);
      const tag = await tags.create({ nombre: "mayorista", color: "#38BDF8", descripcion: null });

      await expect(svc.quitarEtiqueta({ leadId: lead.id, tagId: tag.id })).resolves.toBeUndefined();
    });

    test("crear al vuelo la crea, la asigna y le pone color propio", async () => {
      const lead = await makeLead(leads);

      const tag = await svc.crearYAsignarEtiqueta({
        leadId: lead.id,
        nombre: "  flota municipal  ",
        userId: vendedorId,
      });

      expect(tag.nombre).toBe("flota municipal");
      // El default de la tabla deja todos los chips grises; el punto de una
      // etiqueta es distinguirse de un vistazo.
      expect(tag.color).not.toBe("#888888");
      expect(tag.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      const puestas = await tags.listByLead(lead.id);
      expect(puestas.map((t) => t.nombre)).toEqual(["flota municipal"]);
      expect(puestas[0]?.assigned_by).toBe(vendedorId);
    });

    test("el color de una etiqueta creada al vuelo depende solo del nombre", async () => {
      const primerLead = await makeLead(leads);
      const otroLead = await makeLead(leads);
      const primera = await svc.crearYAsignarEtiqueta({
        leadId: primerLead.id,
        nombre: "flota municipal",
        userId: vendedorId,
      });
      await svc.quitarEtiqueta({ leadId: primerLead.id, tagId: primera.id });

      const segunda = await svc.crearYAsignarEtiqueta({
        leadId: otroLead.id,
        nombre: "flota municipal",
        userId: vendedorId,
      });

      expect(segunda.color).toBe(primera.color);
    });

    test("crear un nombre que ya existe reusa el tag en vez de duplicarlo", async () => {
      const lead = await makeLead(leads);
      const existente = await tags.create({
        nombre: "mayorista",
        color: "#38BDF8",
        descripcion: null,
      });

      const tag = await svc.crearYAsignarEtiqueta({
        leadId: lead.id,
        nombre: "mayorista",
        userId: vendedorId,
      });

      expect(tag.id).toBe(existente.id);
      expect(await tags.list()).toHaveLength(1);
      expect(await tags.listByLead(lead.id)).toHaveLength(1);
    });

    test("NotFoundError al crear sobre un lead que no existe", async () => {
      await expect(
        svc.crearYAsignarEtiqueta({
          leadId: crypto.randomUUID(),
          nombre: "flota",
          userId: vendedorId,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
