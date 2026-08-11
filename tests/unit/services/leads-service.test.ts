import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryMergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { DefaultLeadsService } from "@/server/services/leads/default-leads.service";
import type { LeadInsert } from "@/server/repositories/leads.repo";
import type { LeadSessionInsert } from "@/server/repositories/lead-session.repo";
import type { MensajeInsert } from "@/server/repositories/messages.repo";

let tel = 0;
function baseLead(overrides: Partial<LeadInsert> = {}): LeadInsert {
  tel += 1;
  return {
    nombre: "Lead Test",
    telefono: `+54911000${String(tel).padStart(4, "0")}`,
    email: null,
    direccion: null,
    vehiculo_marca: "Toyota",
    vehiculo_modelo: "Corolla",
    vehiculo_anio: 2018,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: "wa",
    meta_user_ids: { wa: `wa-${tel}` },
    ...overrides,
  };
}

function baseSession(leadId: string): LeadSessionInsert {
  return {
    lead_id: leadId,
    current_stage: "identificando",
    urgencia: "media",
    consulta: "busca pastillas",
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
  };
}

function baseMensaje(sessionId: string, overrides: Partial<MensajeInsert> = {}): MensajeInsert {
  return {
    conversacion_id: crypto.randomUUID(),
    lead_session_id: sessionId,
    direction: "in",
    sender: "lead",
    sender_user_id: null,
    tipo: "text",
    contenido: "hola",
    media_url: null,
    meta_message_id: null,
    idempotency_key: null,
    metadata: {},
    ...overrides,
  };
}

describe("DefaultLeadsService", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let candidates: InMemoryMergeCandidatesRepository;
  let tags: InMemoryTagsRepository;
  let messages: InMemoryMessagesRepository;
  let svc: DefaultLeadsService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    candidates = new InMemoryMergeCandidatesRepository();
    tags = new InMemoryTagsRepository();
    messages = new InMemoryMessagesRepository();
    svc = new DefaultLeadsService({ leads, sessions, candidates, tags, messages });
  });

  test("listLeads incluye TODOS los leads con badge sesionActiva, etapa y fechas", async () => {
    const conActiva = await leads.create(baseLead({ meta_user_ids: { wa: "w1", ig: "i1" } }));
    const sinActiva = await leads.create(baseLead({ canal_origen: "ig", meta_user_ids: {} }));
    await sessions.create(baseSession(conActiva.id));

    const page = await svc.listLeads();
    expect(page.items).toHaveLength(2);
    const item = page.items.find((i) => i.leadId === conActiva.id);
    expect(item?.sesionActiva).toBe(true);
    expect(item?.currentStage).toBe("identificando"); // etapa de la sesión abierta
    expect(item?.canalOrigen).toBe("wa");
    expect(item?.vehiculo).toBe("Toyota Corolla 2018");
    // El encabezado cuenta altas: `createdAt` viaja tal cual, sin derivar.
    expect(item?.createdAt).toEqual(conActiva.created_at);
    expect(item?.updatedAt).toEqual(conActiva.updated_at);
    const otro = page.items.find((i) => i.leadId === sinActiva.id);
    expect(otro?.sesionActiva).toBe(false);
    expect(otro?.currentStage).toBeNull(); // sin sesión abierta no hay etapa vigente
    expect(otro?.canalOrigen).toBe("ig");
  });

  test("listLeads: sesión cerrada no aporta etapa", async () => {
    const lead = await leads.create(baseLead());
    const s = await sessions.create(baseSession(lead.id));
    await sessions.close(s.id, { resultado: "exito" });

    const page = await svc.listLeads();
    expect(page.items[0]?.sesionActiva).toBe(false);
    expect(page.items[0]?.currentStage).toBeNull();
  });

  test("listLeads q delega al repo (trim + cap 100)", async () => {
    await leads.create(baseLead({ nombre: "Maria Fernanda" }));
    await leads.create(baseLead({ nombre: "Otro" }));
    const page = await svc.listLeads({ q: "  maria  " });
    expect(page.items).toHaveLength(1);
  });

  test("listLeads pendingPairs + soloDuplicados filtra a involucrados", async () => {
    const a = await leads.create(baseLead());
    const b = await leads.create(baseLead());
    await leads.create(baseLead()); // tercero, no involucrado
    await candidates.create({
      src_lead_id: a.id,
      dst_lead_id: b.id,
      similarity_score: 0.7,
      reasons: ["nombre_exacto"],
    });

    const page = await svc.listLeads({ soloDuplicados: true });
    expect(page.pendingPairs).toBe(1);
    expect(page.items.map((i) => i.leadId).sort()).toEqual([a.id, b.id].sort());
  });

  test("q busca por nombre de perfil, vehículo y código cotizado", async () => {
    const porPerfil = await leads.create(baseLead({ nombre: "", nombre_perfil: "Juanka 🔧" }));
    const porVehiculo = await leads.create(baseLead({ vehiculo_marca: "Peugeot" }));
    const porCodigo = await leads.create(baseLead());
    await sessions.create({ ...baseSession(porCodigo.id), codigo_interno: "FRE-1234" });
    await leads.create(baseLead({ nombre: "Nada Que Ver" }));

    expect((await svc.listLeads({ q: "juanka" })).items.map((i) => i.leadId)).toEqual([
      porPerfil.id,
    ]);
    expect((await svc.listLeads({ q: "peugeot" })).items.map((i) => i.leadId)).toEqual([
      porVehiculo.id,
    ]);
    // El código vive en `lead_session`: entra por ids, no por columnas de leads.
    expect((await svc.listLeads({ q: "fre-1234" })).items.map((i) => i.leadId)).toEqual([
      porCodigo.id,
    ]);
  });

  test("canal, etapa y sesión activa filtran sin pisarse", async () => {
    const wa = await leads.create(baseLead({ canal_origen: "wa" }));
    const ig = await leads.create(baseLead({ canal_origen: "ig", meta_user_ids: {} }));
    await sessions.create({ ...baseSession(wa.id), current_stage: "negociando" });
    await sessions.create({ ...baseSession(ig.id), current_stage: "cotizado" });
    const sinSesion = await leads.create(baseLead({ canal_origen: "wa", meta_user_ids: {} }));

    expect((await svc.listLeads({ canal: "ig" })).items.map((i) => i.leadId)).toEqual([ig.id]);
    expect((await svc.listLeads({ etapa: "negociando" })).items.map((i) => i.leadId)).toEqual([
      wa.id,
    ]);
    expect((await svc.listLeads({ conSesionActiva: false })).items.map((i) => i.leadId)).toEqual([
      sinSesion.id,
    ]);
    // Combinados: canal wa Y etapa cotizado no lo cumple nadie.
    expect((await svc.listLeads({ canal: "wa", etapa: "cotizado" })).items).toHaveLength(0);
  });

  test("resultado y motivo de pérdida miran el último cierre del lead", async () => {
    const perdido = await leads.create(baseLead());
    const ganado = await leads.create(baseLead());
    const s1 = await sessions.create(baseSession(perdido.id));
    await sessions.close(s1.id, { resultado: "perdido", motivo_perdida: "precio" });
    const s2 = await sessions.create(baseSession(ganado.id));
    await sessions.close(s2.id, { resultado: "exito" });

    const soloPerdidos = await svc.listLeads({ resultado: "perdido" });
    expect(soloPerdidos.items.map((i) => i.leadId)).toEqual([perdido.id]);
    expect(soloPerdidos.items[0]?.motivoPerdida).toBe("precio");
    expect((await svc.listLeads({ motivoPerdida: "stock" })).items).toHaveLength(0);
  });

  test("etiquetaId filtra con una sola consulta al pivot y el catálogo viaja con la página", async () => {
    const conTag = await leads.create(baseLead());
    await leads.create(baseLead());
    const vip = await tags.create({ nombre: "vip", color: "#ff0000", descripcion: null });
    await tags.create({ nombre: "frío", color: "#0000ff", descripcion: null });
    await tags.assignToLead(conTag.id, vip.id, "manual");

    const spy = vi.spyOn(tags, "listLeadIdsByTag");
    const page = await svc.listLeads({ etiquetaId: vip.id });
    expect(page.items.map((i) => i.leadId)).toEqual([conTag.id]);
    expect(spy).toHaveBeenCalledTimes(1);
    // El chip ofrece todo el catálogo, ordenado, aunque el filtro deje una sola.
    expect(page.etiquetas.map((e) => e.nombre)).toEqual(["frío", "vip"]);
  });

  test("actividad acota por updated_at contra el reloj inyectado", async () => {
    const ahora = new Date("2026-03-10T15:00:00Z");
    const DIA = 24 * 60 * 60 * 1000;
    // Solo `Date`: el repo sella `updated_at` con el reloj y esta es la forma de
    // fijar la escena sin escribir en su almacenamiento privado.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(ahora.getTime() - 45 * DIA));
      const viejo = await leads.create(baseLead());
      vi.setSystemTime(new Date(ahora.getTime() - 2 * DIA));
      const nuevo = await leads.create(baseLead());
      vi.setSystemTime(ahora);

      expect(
        (await svc.listLeads({ actividad: "semana", ahora })).items.map((i) => i.leadId),
      ).toEqual([nuevo.id]);
      expect(
        (await svc.listLeads({ actividad: "mas_30", ahora })).items.map((i) => i.leadId),
      ).toEqual([viejo.id]);
      expect((await svc.listLeads({ actividad: "hoy", ahora })).items).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("sinResponder deja los hilos con entrantes posteriores a nuestra respuesta", async () => {
    const esperando = await leads.create(baseLead());
    const respondido = await leads.create(baseLead());
    const sEsperando = await sessions.create(baseSession(esperando.id));
    const sRespondido = await sessions.create(baseSession(respondido.id));
    await messages.create(baseMensaje(sRespondido.id));
    await messages.create(baseMensaje(sRespondido.id, { direction: "out", sender: "ia" }));
    await messages.create(baseMensaje(sEsperando.id, { direction: "out", sender: "ia" }));
    await messages.create(baseMensaje(sEsperando.id));

    const spy = vi.spyOn(messages, "listBySessionIds");
    const page = await svc.listLeads({ sinResponder: true });
    expect(page.items.map((i) => i.leadId)).toEqual([esperando.id]);
    // Un solo pedido de hilos para toda la pantalla, no uno por lead.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("vehículo filtra, y las opciones salen de antes del filtro para poder cambiarlas", async () => {
    await leads.create(baseLead({ vehiculo_marca: "Toyota", vehiculo_modelo: "Corolla" }));
    await leads.create(baseLead({ vehiculo_marca: "Toyota", vehiculo_modelo: "Hilux" }));
    await leads.create(baseLead({ vehiculo_marca: "Ford", vehiculo_modelo: "Ranger" }));

    const page = await svc.listLeads({ vehiculoMarca: "Toyota", vehiculoModelo: "Hilux" });
    expect(page.items).toHaveLength(1);
    expect(page.marcas).toEqual(["Ford", "Toyota"]);
    // Los modelos sí se acotan a la marca elegida: "Ranger" no es un Toyota.
    expect(page.modelos).toEqual(["Corolla", "Hilux"]);
  });

  test("con TODOS los filtros puestos la pantalla no hace una consulta por lead", async () => {
    const lead = await leads.create(baseLead());
    const sesion = await sessions.create(baseSession(lead.id));
    await messages.create(baseMensaje(sesion.id));
    const tag = await tags.create({ nombre: "vip", color: "#ff0000", descripcion: null });
    await tags.assignToLead(lead.id, tag.id, "manual");

    const espias = [
      vi.spyOn(leads, "list"),
      vi.spyOn(leads, "findById"),
      vi.spyOn(sessions, "listActive"),
      vi.spyOn(sessions, "listCierres"),
      vi.spyOn(sessions, "listLeadIdsByCodigo"),
      vi.spyOn(sessions, "listByLeadId"),
      vi.spyOn(candidates, "list"),
      vi.spyOn(tags, "list"),
      vi.spyOn(tags, "listLeadIdsByTag"),
      vi.spyOn(messages, "listBySessionIds"),
      vi.spyOn(messages, "listBySessionId"),
    ];

    await svc.listLeads({
      q: "lead",
      soloDuplicados: false,
      canal: "wa",
      etapa: "identificando",
      etiquetaId: tag.id,
      conSesionActiva: true,
      resultado: undefined,
      motivoPerdida: undefined,
      actividad: "semana",
      sinResponder: true,
      vehiculoMarca: "Toyota",
      vehiculoModelo: "Corolla",
    });

    const total = espias.reduce((n, e) => n + e.mock.calls.length, 0);
    // 8 lecturas fijas: códigos + leads + sesiones activas + cierres + duplicados
    // + catálogo de etiquetas + pivot de la etiqueta + hilos en tanda. Ninguna
    // depende de cuántos leads hay: agregar filas no agrega consultas.
    expect(total).toBe(8);
    expect(leads.findById).not.toHaveBeenCalled();
    expect(sessions.listByLeadId).not.toHaveBeenCalled();
    expect(messages.listBySessionId).not.toHaveBeenCalled();
  });

  test("getLeadDetail arma ficha completa", async () => {
    const lead = await leads.create(baseLead());
    const other = await leads.create(baseLead({ nombre: "Duplicado Posible" }));
    const s1 = await sessions.create(baseSession(lead.id));
    await sessions.close(s1.id, { resultado: "perdido", motivo_perdida: "precio" });
    // Delay para evitar empate de started_at en el mismo milisegundo (mismo
    // patrón que el contract test de listByLeadId — T2).
    await new Promise((r) => setTimeout(r, 5));
    const s2 = await sessions.create(baseSession(lead.id)); // activa
    const tag = await tags.create({ nombre: "vip", color: "#ff0000", descripcion: null });
    await tags.assignToLead(lead.id, tag.id, "manual");
    const cand = await candidates.create({
      src_lead_id: lead.id,
      dst_lead_id: other.id,
      similarity_score: 1,
      reasons: ["manual"],
    });

    const d = await svc.getLeadDetail(lead.id);
    expect(d.lead.id).toBe(lead.id);
    expect(d.sesiones.map((s) => s.id)).toEqual([s2.id, s1.id]);
    expect(d.sesionActiva?.id).toBe(s2.id);
    expect(d.tags).toEqual([
      expect.objectContaining({ nombre: "vip", color: "#ff0000", source: "manual" }),
    ]);
    expect(d.duplicados).toHaveLength(1);
    expect(d.duplicados[0]?.candidateId).toBe(cand.id);
    expect(d.duplicados[0]?.otherLead.id).toBe(other.id);
  });

  test("getLeadDetail lead inexistente → NotFoundError", async () => {
    await expect(svc.getLeadDetail(crypto.randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });
});
