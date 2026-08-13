import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { MAX_DATOS_EXTRA } from "@/lib/datos-extra";
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
import { InMemorySessionRecordatoriosRepository } from "@/server/repositories/session-recordatorios.repo";
import { reposAuditoria } from "../mocks/inbox-auditoria";
import { depsRecordatorios } from "../mocks/inbox-recordatorios";
import type {
  CancelarAvisoRecordatorioFn,
  ProgramarAvisoRecordatorioFn,
} from "@/server/services/inbox/inbox.service";
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
  let recordatorios: InMemorySessionRecordatoriosRepository;
  let programarAvisoSpy: Mock<ProgramarAvisoRecordatorioFn>;
  let cancelarAvisoSpy: Mock<CancelarAvisoRecordatorioFn>;
  let client: MetaApiClient;
  let sendTextSpy: Mock<(input: MetaSendTextInput) => Promise<MetaSendResult>>;
  let svc: DefaultInboxService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    convs = new InMemoryConversationsRepository();
    messages = new InMemoryMessagesRepository();
    tags = new InMemoryTagsRepository();
    recordatorios = new InMemorySessionRecordatoriosRepository();
    programarAvisoSpy = vi.fn(async () => {});
    cancelarAvisoSpy = vi.fn(async () => {});
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
      ...reposAuditoria(),
      ...depsRecordatorios(recordatorios),
      programarAviso: programarAvisoSpy,
      cancelarAviso: cancelarAvisoSpy,
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

    test("si Meta falla, propaga y deja el saliente marcado como fallido", async () => {
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

      // El saliente se reserva ANTES de llamar a Meta; un error genérico lo deja
      // visible en el hilo como fallido en vez de desaparecer sin rastro.
      const thread = await messages.listBySessionId(session.id);
      expect(thread).toHaveLength(1);
      expect(thread[0]?.meta_message_id).toBeNull();
      expect(thread[0]?.estado_entrega).toBe("fallido");
      expect(thread[0]?.error_entrega).toContain("meta caída");
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
    const ganado = (sessionId: UUID) =>
      ({ sessionId, resultado: "exito", motivoPerdida: null, userId: null }) as const;

    test("ganado cierra en la etapa cerrado y setea closed_at", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id, { current_stage: "negociando" });

      const closed = await svc.closeSession(ganado(session.id));

      expect(closed.resultado).toBe("exito");
      expect(closed.closed_at).toBeInstanceOf(Date);
      expect(closed.motivo_perdida).toBeNull();
      // El cruce que resuelve este flujo: ganar es `cerrado`, el paso 6.
      expect(closed.current_stage).toBe("cerrado");
      expect(closed.etapa_alcanzada).toBe("cerrado");
    });

    test("perdido desvía la etapa y no baja lo alcanzado", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id, { current_stage: "negociando" });

      const closed = await svc.closeSession({
        sessionId: session.id,
        resultado: "perdido",
        motivoPerdida: "precio",
        userId: null,
      });

      expect(closed.resultado).toBe("perdido");
      expect(closed.motivo_perdida).toBe("precio");
      // `perdido` es desvío, no paso 7: el embudo queda congelado donde llegó.
      expect(closed.current_stage).toBe("perdido");
      expect(closed.etapa_alcanzada).toBe("negociando");
    });

    test("deja la decisión anotada como humana en la procedencia", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);
      const userId = crypto.randomUUID();

      const closed = await svc.closeSession({ ...ganado(session.id), userId });

      expect(closed.procedencia.current_stage?.por).toBe("humano");
      expect(closed.procedencia.current_stage?.user_id).toBe(userId);
    });

    // El motivo obligatorio no se sostiene solo en el schema de entrada: la
    // regla es del dominio y tiene que valer para cualquier caller.
    test("ValidationError cuando se pierde sin motivo", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);

      await expect(
        svc.closeSession({
          sessionId: session.id,
          resultado: "perdido",
          motivoPerdida: null,
          userId: null,
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      // Y no dejó la sesión a medio cerrar.
      const actual = await sessions.findById(session.id);
      expect(actual?.resultado).toBeNull();
      expect(actual?.current_stage).toBe("nuevo");
    });

    test("replay idéntico es no-op (idempotente)", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);

      const first = await svc.closeSession(ganado(session.id));
      const second = await svc.closeSession(ganado(session.id));

      expect(second.closed_at?.getTime()).toBe(first.closed_at?.getTime());
    });

    test("NotFoundError cuando sesión no existe", async () => {
      await expect(svc.closeSession(ganado(crypto.randomUUID()))).rejects.toBeInstanceOf(
        NotFoundError,
      );
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

  describe("agregarDato", () => {
    test("completa una columna de contacto que estaba vacía", async () => {
      const lead = await makeLead(leads);

      const actualizado = await svc.agregarDato({
        leadId: lead.id,
        tipo: "campo",
        campo: "email",
        valor: "  ramon@taller.com  ",
      });

      expect(actualizado.email).toBe("ramon@taller.com");
      expect((await leads.findById(lead.id))?.email).toBe("ramon@taller.com");
      // La columna no toca `datos_extra`: si lo hiciera habría dos emails.
      expect(actualizado.datos_extra).toEqual({});
    });

    test("un campo libre va a datos_extra con el nombre que escribió el vendedor", async () => {
      const lead = await makeLead(leads);

      const actualizado = await svc.agregarDato({
        leadId: lead.id,
        tipo: "libre",
        clave: "Cumpleaños",
        valor: "12/03",
      });

      expect(actualizado.datos_extra).toEqual({ Cumpleaños: "12/03" });
    });

    test("campos libres sucesivos se acumulan", async () => {
      const lead = await makeLead(leads);

      await svc.agregarDato({ leadId: lead.id, tipo: "libre", clave: "Patente", valor: "ABC123" });
      const actualizado = await svc.agregarDato({
        leadId: lead.id,
        tipo: "libre",
        clave: "Cumpleaños",
        valor: "12/03",
      });

      expect(actualizado.datos_extra).toEqual({ Patente: "ABC123", Cumpleaños: "12/03" });
    });

    test("volver a cargar una clave equivalente pisa el valor y no duplica la fila", async () => {
      const lead = await makeLead(leads);

      await svc.agregarDato({
        leadId: lead.id,
        tipo: "libre",
        clave: "Cumpleaños",
        valor: "12/03",
      });
      const actualizado = await svc.agregarDato({
        leadId: lead.id,
        tipo: "libre",
        clave: "cumpleanos",
        valor: "13/03",
      });

      expect(actualizado.datos_extra).toEqual({ Cumpleaños: "13/03" });
    });

    test("ValidationError al pasar el tope de campos libres", async () => {
      const lead = await makeLead(leads);
      for (let i = 0; i < MAX_DATOS_EXTRA; i++) {
        await svc.agregarDato({
          leadId: lead.id,
          tipo: "libre",
          clave: `Campo ${i}`,
          valor: String(i),
        });
      }

      await expect(
        svc.agregarDato({ leadId: lead.id, tipo: "libre", clave: "Uno más", valor: "x" }),
      ).rejects.toBeInstanceOf(ValidationError);

      // Pisar uno que ya está sigue funcionando con la ficha llena.
      const actualizado = await svc.agregarDato({
        leadId: lead.id,
        tipo: "libre",
        clave: "Campo 0",
        valor: "nuevo",
      });
      expect(actualizado.datos_extra["Campo 0"]).toBe("nuevo");
    });

    test("no exige sesión activa: el lead vive más que la sesión", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);
      await sessions.close(session.id, { resultado: "exito" });

      const actualizado = await svc.agregarDato({
        leadId: lead.id,
        tipo: "campo",
        campo: "direccion",
        valor: "Av. Siempre Viva 742",
      });

      expect(actualizado.direccion).toBe("Av. Siempre Viva 742");
    });

    test("NotFoundError cuando el lead no existe", async () => {
      await expect(
        svc.agregarDato({
          leadId: crypto.randomUUID(),
          tipo: "libre",
          clave: "Patente",
          valor: "ABC123",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("borrarDatoExtra", () => {
    test("saca el campo libre y deja los demás", async () => {
      const lead = await makeLead(leads);
      await svc.agregarDato({ leadId: lead.id, tipo: "libre", clave: "Patente", valor: "ABC123" });
      await svc.agregarDato({
        leadId: lead.id,
        tipo: "libre",
        clave: "Cumpleaños",
        valor: "12/03",
      });

      const actualizado = await svc.borrarDatoExtra({ leadId: lead.id, clave: "Cumpleaños" });

      expect(actualizado.datos_extra).toEqual({ Patente: "ABC123" });
      expect((await leads.findById(lead.id))?.datos_extra).toEqual({ Patente: "ABC123" });
    });

    test("encuentra la clave aunque el nombre venga escrito distinto", async () => {
      const lead = await makeLead(leads);
      await svc.agregarDato({
        leadId: lead.id,
        tipo: "libre",
        clave: "Cumpleaños",
        valor: "12/03",
      });

      const actualizado = await svc.borrarDatoExtra({ leadId: lead.id, clave: "  cumpleanos  " });

      expect(actualizado.datos_extra).toEqual({});
    });

    test("no toca las columnas de contacto ni cuando la clave se llama como una", async () => {
      const lead = await makeLead(leads);
      await svc.agregarDato({
        leadId: lead.id,
        tipo: "campo",
        campo: "email",
        valor: "ramon@taller.com",
      });
      await svc.agregarDato({
        leadId: lead.id,
        tipo: "campo",
        campo: "direccion",
        valor: "Av. Siempre Viva 742",
      });

      // Lo que llega desde el cliente es texto libre: aunque nombre una columna
      // real, el borrado solo puede escribir el jsonb.
      for (const clave of ["telefono", "Teléfono", "email", "Dirección", "nombre"]) {
        const actualizado = await svc.borrarDatoExtra({ leadId: lead.id, clave });
        expect(actualizado.telefono).toBe(lead.telefono);
        expect(actualizado.email).toBe("ramon@taller.com");
        expect(actualizado.direccion).toBe("Av. Siempre Viva 742");
        expect(actualizado.nombre).toBe(lead.nombre);
      }
    });

    test("borrar una clave que no está es no-op", async () => {
      const lead = await makeLead(leads);
      await svc.agregarDato({ leadId: lead.id, tipo: "libre", clave: "Patente", valor: "ABC123" });

      const actualizado = await svc.borrarDatoExtra({ leadId: lead.id, clave: "Cumpleaños" });

      expect(actualizado.datos_extra).toEqual({ Patente: "ABC123" });
    });

    test("borrar dos veces el mismo campo no falla", async () => {
      const lead = await makeLead(leads);
      await svc.agregarDato({ leadId: lead.id, tipo: "libre", clave: "Patente", valor: "ABC123" });

      await svc.borrarDatoExtra({ leadId: lead.id, clave: "Patente" });
      const actualizado = await svc.borrarDatoExtra({ leadId: lead.id, clave: "Patente" });

      expect(actualizado.datos_extra).toEqual({});
    });

    test("libera lugar bajo el tope de campos libres", async () => {
      const lead = await makeLead(leads);
      for (let i = 0; i < MAX_DATOS_EXTRA; i++) {
        await svc.agregarDato({
          leadId: lead.id,
          tipo: "libre",
          clave: `Campo ${i}`,
          valor: String(i),
        });
      }
      await expect(
        svc.agregarDato({ leadId: lead.id, tipo: "libre", clave: "Uno más", valor: "x" }),
      ).rejects.toBeInstanceOf(ValidationError);

      await svc.borrarDatoExtra({ leadId: lead.id, clave: "Campo 0" });
      const actualizado = await svc.agregarDato({
        leadId: lead.id,
        tipo: "libre",
        clave: "Uno más",
        valor: "x",
      });

      expect(actualizado.datos_extra["Uno más"]).toBe("x");
      expect(actualizado.datos_extra["Campo 0"]).toBeUndefined();
    });

    test("no exige sesión activa: el lead vive más que la sesión", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);
      await svc.agregarDato({ leadId: lead.id, tipo: "libre", clave: "Patente", valor: "ABC123" });
      await sessions.close(session.id, { resultado: "exito" });

      const actualizado = await svc.borrarDatoExtra({ leadId: lead.id, clave: "Patente" });

      expect(actualizado.datos_extra).toEqual({});
    });

    test("NotFoundError cuando el lead no existe", async () => {
      await expect(
        svc.borrarDatoExtra({ leadId: crypto.randomUUID(), clave: "Patente" }),
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
  describe("recordatorios de seguimiento", () => {
    const EN_DOS_DIAS = new Date(Date.now() + 48 * 60 * 60 * 1000);

    test("programar crea la cita y arranca el workflow con esa fecha", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);

      const r = await svc.programarRecordatorio({
        sessionId: session.id,
        recordarAt: EN_DOS_DIAS,
        nota: "dijo que lo pensaba",
        userId: vendedorId,
      });

      expect(r.estado).toBe("pendiente");
      expect(r.creado_por).toBe(vendedorId);
      // El workflow durable arranca con el id de la fila: sin esto el
      // `sleepUntil` no sabría a qué recordatorio volver.
      expect(programarAvisoSpy).toHaveBeenCalledWith({
        recordatorioId: r.id,
        leadSessionId: session.id,
        recordarAt: EN_DOS_DIAS,
      });
    });

    test("una sola cita por conversación: la segunda es ConflictError", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);
      await svc.programarRecordatorio({
        sessionId: session.id,
        recordarAt: EN_DOS_DIAS,
        nota: "",
        userId: vendedorId,
      });

      await expect(
        svc.programarRecordatorio({
          sessionId: session.id,
          recordarAt: EN_DOS_DIAS,
          nota: "otra",
          userId: vendedorId,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    test("no se programa sobre una sesión cerrada", async () => {
      // Una cita sobre una conversación que salió del inbox no la ve nadie, y
      // a los 29 días la purga se la lleva.
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);
      await sessions.resolver(session.id, { resultado: "exito" }, vendedorId);

      await expect(
        svc.programarRecordatorio({
          sessionId: session.id,
          recordarAt: EN_DOS_DIAS,
          nota: "",
          userId: vendedorId,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    test("una sesión cerrada no llega ni a arrancar el workflow", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);
      await sessions.resolver(session.id, { resultado: "exito" }, vendedorId);

      await expect(
        svc.programarRecordatorio({
          sessionId: session.id,
          recordarAt: EN_DOS_DIAS,
          nota: "",
          userId: vendedorId,
        }),
      ).rejects.toThrow();
      expect(programarAvisoSpy).not.toHaveBeenCalled();
    });

    test("cancelar apaga la cita y deja programar otra", async () => {
      const lead = await makeLead(leads);
      const session = await makeSession(sessions, lead.id);
      const r = await svc.programarRecordatorio({
        sessionId: session.id,
        recordarAt: EN_DOS_DIAS,
        nota: "",
        userId: vendedorId,
      });

      await svc.cancelarRecordatorio({ recordatorioId: r.id });

      expect((await recordatorios.findById(r.id))?.motivo_cancelacion).toBe("manual");
      expect(cancelarAvisoSpy).toHaveBeenCalledWith({
        recordatorioId: r.id,
        recordarAt: EN_DOS_DIAS,
      });
      await expect(
        svc.programarRecordatorio({
          sessionId: session.id,
          recordarAt: EN_DOS_DIAS,
          nota: "",
          userId: vendedorId,
        }),
      ).resolves.toBeDefined();
    });

    test("cancelar uno que ya no está vivo termina bien", async () => {
      // Otra pestaña pudo apagarlo, o el cliente pudo contestar en el medio.
      await expect(
        svc.cancelarRecordatorio({ recordatorioId: crypto.randomUUID() }),
      ).resolves.toBeUndefined();
    });

    describe("reprogramar", () => {
      const EN_UNA_SEMANA = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      test("mueve la fecha en la misma fila y arranca el workflow con la nueva", async () => {
        const lead = await makeLead(leads);
        const session = await makeSession(sessions, lead.id);
        const r = await svc.programarRecordatorio({
          sessionId: session.id,
          recordarAt: EN_DOS_DIAS,
          nota: "dijo que lo pensaba",
          userId: vendedorId,
        });
        programarAvisoSpy.mockClear();

        const movido = await svc.reprogramarRecordatorio({
          recordatorioId: r.id,
          recordarAt: EN_UNA_SEMANA,
        });

        // El mismo id: para el vendedor es la misma cita, movida.
        expect(movido.id).toBe(r.id);
        expect(movido.recordar_at).toEqual(EN_UNA_SEMANA);
        // Y la nota sobrevive: mover la fecha no es reescribir el motivo.
        expect(movido.nota).toBe("dijo que lo pensaba");
        expect(programarAvisoSpy).toHaveBeenCalledWith({
          recordatorioId: r.id,
          leadSessionId: session.id,
          recordarAt: EN_UNA_SEMANA,
        });
        expect(cancelarAvisoSpy).toHaveBeenCalledWith({
          recordatorioId: r.id,
          recordarAt: EN_DOS_DIAS,
        });
      });

      test("no deja una segunda cita viva sobre la conversación", async () => {
        const lead = await makeLead(leads);
        const session = await makeSession(sessions, lead.id);
        const r = await svc.programarRecordatorio({
          sessionId: session.id,
          recordarAt: EN_DOS_DIAS,
          nota: "",
          userId: vendedorId,
        });

        await svc.reprogramarRecordatorio({
          recordatorioId: r.id,
          recordarAt: EN_UNA_SEMANA,
        });

        // El índice único parcial de la tabla dice que hay una sola: si
        // reprogramar cancelara y creara, acá habría otra fila y otro id.
        expect((await recordatorios.findVivoBySessionId(session.id))?.id).toBe(r.id);
      });

      test("uno cancelado no se puede mover: ConflictError, no un revivido", async () => {
        const lead = await makeLead(leads);
        const session = await makeSession(sessions, lead.id);
        const r = await svc.programarRecordatorio({
          sessionId: session.id,
          recordarAt: EN_DOS_DIAS,
          nota: "",
          userId: vendedorId,
        });
        await svc.cancelarRecordatorio({ recordatorioId: r.id });

        await expect(
          svc.reprogramarRecordatorio({ recordatorioId: r.id, recordarAt: EN_UNA_SEMANA }),
        ).rejects.toBeInstanceOf(ConflictError);
      });

      test("una fila que no existe es NotFoundError", async () => {
        await expect(
          svc.reprogramarRecordatorio({
            recordatorioId: crypto.randomUUID(),
            recordarAt: EN_UNA_SEMANA,
          }),
        ).rejects.toBeInstanceOf(NotFoundError);
      });

      test("sesión cerrada: no se mueve una cita que nadie va a ver", async () => {
        const lead = await makeLead(leads);
        const session = await makeSession(sessions, lead.id);
        const r = await svc.programarRecordatorio({
          sessionId: session.id,
          recordarAt: EN_DOS_DIAS,
          nota: "",
          userId: vendedorId,
        });
        await sessions.resolver(session.id, { resultado: "exito" }, vendedorId);

        await expect(
          svc.reprogramarRecordatorio({ recordatorioId: r.id, recordarAt: EN_UNA_SEMANA }),
        ).rejects.toBeInstanceOf(ConflictError);
      });

      /** Un recordatorio vivo con nota, listo para moverse. */
      async function conNota(nota: string) {
        const lead = await makeLead(leads);
        const session = await makeSession(sessions, lead.id);
        const r = await svc.programarRecordatorio({
          sessionId: session.id,
          recordarAt: EN_DOS_DIAS,
          nota,
          userId: vendedorId,
        });
        return { session, r };
      }

      test("la nota se corrige en el mismo paso que la fecha", async () => {
        const { r } = await conNota("dijo que lo pensaba");

        const movido = await svc.reprogramarRecordatorio({
          recordatorioId: r.id,
          recordarAt: EN_UNA_SEMANA,
          nota: "dijo que lo pensaba, llamar al taller antes",
        });

        expect(movido.nota).toBe("dijo que lo pensaba, llamar al taller antes");
        expect(movido.recordar_at).toEqual(EN_UNA_SEMANA);
      });

      test("la nota vacía NO borra la anterior: el descuido no puede costar el motivo", async () => {
        const { r } = await conNota("dijo que lo pensaba");

        const movido = await svc.reprogramarRecordatorio({
          recordatorioId: r.id,
          recordarAt: EN_UNA_SEMANA,
          nota: "",
        });

        expect(movido.nota).toBe("dijo que lo pensaba");
      });

      test("una nota de solo espacios tampoco borra", async () => {
        const { r } = await conNota("dijo que lo pensaba");

        const movido = await svc.reprogramarRecordatorio({
          recordatorioId: r.id,
          recordarAt: EN_UNA_SEMANA,
          nota: "   ",
        });

        expect(movido.nota).toBe("dijo que lo pensaba");
      });

      test("sin mandar nota, la anterior queda intacta", async () => {
        const { r } = await conNota("dijo que lo pensaba");

        const movido = await svc.reprogramarRecordatorio({
          recordatorioId: r.id,
          recordarAt: EN_UNA_SEMANA,
        });

        expect(movido.nota).toBe("dijo que lo pensaba");
      });

      test("`null` sí la borra: es el único camino, y es explícito", async () => {
        const { r } = await conNota("dijo que lo pensaba");

        const movido = await svc.reprogramarRecordatorio({
          recordatorioId: r.id,
          recordarAt: EN_UNA_SEMANA,
          nota: null,
        });

        expect(movido.nota).toBe("");
      });

      test("se le puede poner nota a uno que no tenía", async () => {
        const { r } = await conNota("");

        const movido = await svc.reprogramarRecordatorio({
          recordatorioId: r.id,
          recordarAt: EN_UNA_SEMANA,
          nota: "pidió que lo llame el lunes",
        });

        expect(movido.nota).toBe("pidió que lo llame el lunes");
      });

      test("si falla no arranca ningún workflow", async () => {
        programarAvisoSpy.mockClear();
        await expect(
          svc.reprogramarRecordatorio({
            recordatorioId: crypto.randomUUID(),
            recordarAt: EN_UNA_SEMANA,
          }),
        ).rejects.toBeInstanceOf(NotFoundError);
        expect(programarAvisoSpy).not.toHaveBeenCalled();
      });
    });
  });
});
