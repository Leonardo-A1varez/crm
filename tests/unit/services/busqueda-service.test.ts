import { beforeEach, describe, expect, test } from "vitest";
import { cotasActividad } from "@/lib/actividad";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import {
  DefaultBusquedaService,
  LIMITE_RESULTADOS,
} from "@/server/services/busqueda/default-busqueda.service";
import type { LeadInsert, LeadListFilter } from "@/server/repositories/leads.repo";
import type { LeadSessionInsert } from "@/server/repositories/lead-session.repo";
import type { MensajeInsert } from "@/server/repositories/messages.repo";
import type { UUID } from "@/types/entities";

let tel = 0;
function baseLead(overrides: Partial<LeadInsert> = {}): LeadInsert {
  tel += 1;
  return {
    nombre: "Lead Test",
    nombre_perfil: null,
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

function baseSession(leadId: UUID, overrides: Partial<LeadSessionInsert> = {}): LeadSessionInsert {
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
    ...overrides,
  };
}

function baseMensaje(sessionId: UUID, contenido: string): MensajeInsert {
  return {
    conversacion_id: crypto.randomUUID(),
    lead_session_id: sessionId,
    direction: "in",
    sender: "lead",
    sender_user_id: null,
    tipo: "text",
    contenido,
    media_url: null,
    meta_message_id: null,
    idempotency_key: null,
    metadata: {},
  };
}

describe("DefaultBusquedaService", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let messages: InMemoryMessagesRepository;
  let tags: InMemoryTagsRepository;
  let svc: DefaultBusquedaService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    messages = new InMemoryMessagesRepository();
    tags = new InMemoryTagsRepository();
    svc = new DefaultBusquedaService({ leads, sessions, messages, tags });
  });

  describe("qué busca", () => {
    test("encuentra por el nombre de la casa", async () => {
      await leads.create(baseLead({ nombre: "Ferretería Colón" }));
      await leads.create(baseLead({ nombre: "Otro" }));

      const { resultados } = await svc.buscar({ q: "colón" });
      expect(resultados.map((r) => r.nombre)).toEqual(["Ferretería Colón"]);
      // Sin coincidencia de contenido no hay fragmento que mostrar.
      expect(resultados[0]?.fragmento).toBeNull();
      expect(resultados[0]?.mensajesCoincidentes).toBe(0);
    });

    test("encuentra por el nombre de perfil de WhatsApp", async () => {
      await leads.create(baseLead({ nombre: "", nombre_perfil: "Juanjo Repuestos" }));
      const { resultados } = await svc.buscar({ q: "juanjo" });
      expect(resultados).toHaveLength(1);
    });

    test("encuentra por teléfono", async () => {
      const lead = await leads.create(baseLead({ telefono: "+5493514445566" }));
      const { resultados } = await svc.buscar({ q: "4445566" });
      expect(resultados.map((r) => r.leadId)).toEqual([lead.id]);
    });

    test("encuentra por el contenido de un mensaje y devuelve el fragmento", async () => {
      const lead = await leads.create(baseLead({ nombre: "Sin relación" }));
      const sesion = await sessions.create(baseSession(lead.id));
      await messages.create(
        baseMensaje(sesion.id, "Hola, necesito pastillas de freno para el Corolla"),
      );

      const { resultados } = await svc.buscar({ q: "pastillas" });
      expect(resultados).toHaveLength(1);
      expect(resultados[0]?.leadId).toBe(lead.id);
      expect(resultados[0]?.fragmento?.texto).toContain("pastillas");
      expect(resultados[0]?.mensajesCoincidentes).toBe(1);
    });

    test("busca también en conversaciones CERRADAS, que es el punto del buscador", async () => {
      const lead = await leads.create(baseLead({ nombre: "Cliente viejo" }));
      const sesion = await sessions.create(baseSession(lead.id));
      await messages.create(baseMensaje(sesion.id, "me interesa el amortiguador trasero"));
      await sessions.close(sesion.id, { resultado: "perdido", motivo_perdida: "precio" });

      const { resultados } = await svc.buscar({ q: "amortiguador" });
      expect(resultados).toHaveLength(1);
      expect(resultados[0]?.sesionActiva).toBe(false);
      // Sin sesión abierta no hay etapa vigente.
      expect(resultados[0]?.currentStage).toBeNull();
    });

    test("un lead con dos mensajes coincidentes es UNA fila y cuenta los dos", async () => {
      const lead = await leads.create(baseLead({ nombre: "Repetido" }));
      const sesion = await sessions.create(baseSession(lead.id));
      await messages.create(baseMensaje(sesion.id, "freno delantero"));
      await new Promise((r) => setTimeout(r, 5));
      await messages.create(baseMensaje(sesion.id, "freno trasero también"));

      const { resultados } = await svc.buscar({ q: "freno" });
      expect(resultados).toHaveLength(1);
      expect(resultados[0]?.mensajesCoincidentes).toBe(2);
      // El fragmento es el del mensaje más reciente.
      expect(resultados[0]?.fragmento?.texto).toContain("trasero");
    });

    test("con menos de 3 caracteres NO toca los mensajes y lo avisa", async () => {
      const lead = await leads.create(baseLead({ nombre: "Sin relación" }));
      const sesion = await sessions.create(baseSession(lead.id));
      await messages.create(baseMensaje(sesion.id, "aa bb cc"));

      const pagina = await svc.buscar({ q: "aa" });
      expect(pagina.soloDatosDelLead).toBe(true);
      expect(pagina.resultados).toHaveLength(0);

      // Con 3 ya entra a mensajes.
      const conTres = await svc.buscar({ q: "aa " + "b" });
      expect(conTres.soloDatosDelLead).toBe(false);
    });

    test("con una sola letra no busca nada", async () => {
      await leads.create(baseLead({ nombre: "Aaaa" }));
      const pagina = await svc.buscar({ q: "a" });
      expect(pagina.resultados).toEqual([]);
      expect(pagina.truncado).toBe(false);
    });
  });

  describe("filtros", () => {
    test("canal deja solo los leads de ese canal de origen", async () => {
      await leads.create(baseLead({ nombre: "Freno wa", canal_origen: "wa" }));
      await leads.create(baseLead({ nombre: "Freno ig", canal_origen: "ig" }));

      const { resultados } = await svc.buscar({ q: "freno", canal: "ig" });
      expect(resultados.map((r) => r.nombre)).toEqual(["Freno ig"]);
    });

    test("sesión activa / cerrada parte el resultado en dos", async () => {
      const abierta = await leads.create(baseLead({ nombre: "Freno abierta" }));
      await sessions.create(baseSession(abierta.id));
      const cerrada = await leads.create(baseLead({ nombre: "Freno cerrada" }));
      const s = await sessions.create(baseSession(cerrada.id));
      await sessions.close(s.id, { resultado: "exito" });

      expect(
        (await svc.buscar({ q: "freno", sesion: "activa" })).resultados.map((r) => r.nombre),
      ).toEqual(["Freno abierta"]);
      expect(
        (await svc.buscar({ q: "freno", sesion: "cerrada" })).resultados.map((r) => r.nombre),
      ).toEqual(["Freno cerrada"]);
      expect((await svc.buscar({ q: "freno" })).resultados).toHaveLength(2);
    });

    test("etapa mira la sesión abierta y descarta a los que no tienen ninguna", async () => {
      const cotizado = await leads.create(baseLead({ nombre: "Freno cotizado" }));
      await sessions.create(baseSession(cotizado.id, { current_stage: "cotizado" }));
      const nuevo = await leads.create(baseLead({ nombre: "Freno nuevo" }));
      await sessions.create(baseSession(nuevo.id, { current_stage: "nuevo" }));
      await leads.create(baseLead({ nombre: "Freno sin sesión" }));

      const { resultados } = await svc.buscar({ q: "freno", etapa: "cotizado" });
      expect(resultados.map((r) => r.nombre)).toEqual(["Freno cotizado"]);
    });

    test("etiqueta filtra por el pivot, con una sola consulta", async () => {
      const conTag = await leads.create(baseLead({ nombre: "Freno urgente" }));
      await leads.create(baseLead({ nombre: "Freno común" }));
      const tag = await tags.create({ nombre: "Urgente", color: "#ff0000", descripcion: null });
      await tags.assignToLead(conTag.id, tag.id, "manual", null);

      const { resultados } = await svc.buscar({ q: "freno", etiquetaId: tag.id });
      expect(resultados.map((r) => r.nombre)).toEqual(["Freno urgente"]);
    });

    test("actividad no reimplementa el criterio: delega en cotasActividad", async () => {
      const ahora = new Date("2026-08-11T15:00:00Z");
      const vistos: LeadListFilter[] = [];
      const original = leads.list.bind(leads);
      leads.list = async (filter) => {
        if (filter) vistos.push(filter);
        return original(filter);
      };

      await svc.buscar({ q: "freno", actividad: "mas_30", ahora });
      // Exactamente las cotas de `cotasActividad`, no unas propias.
      expect(vistos[0]).toMatchObject(cotasActividad("mas_30", ahora));
      expect(vistos[0]?.actualizadoDesde).toBeUndefined();

      await svc.buscar({ q: "freno", actividad: "semana", ahora });
      expect(vistos[1]).toMatchObject(cotasActividad("semana", ahora));
    });

    test("actividad recorta de verdad el resultado", async () => {
      const ahora = new Date("2026-08-11T15:00:00Z");
      await leads.create(baseLead({ nombre: "Freno de hoy" }));

      // `mas_30` es una cota SUPERIOR: lo recién tocado queda afuera.
      const viejos = await svc.buscar({ q: "freno", actividad: "mas_30", ahora });
      expect(viejos.resultados).toHaveLength(0);

      // `semana` es una cota inferior de hace 7 días: lo mismo entra.
      const semana = await svc.buscar({ q: "freno", actividad: "semana", ahora });
      expect(semana.resultados).toHaveLength(1);
    });
  });

  describe("tope de resultados", () => {
    test("corta en el límite y avisa que quedaron afuera", async () => {
      for (let i = 0; i < LIMITE_RESULTADOS + 3; i += 1) {
        await leads.create(baseLead({ nombre: `Freno ${i}` }));
      }
      const pagina = await svc.buscar({ q: "freno" });
      expect(pagina.resultados).toHaveLength(LIMITE_RESULTADOS);
      expect(pagina.limite).toBe(LIMITE_RESULTADOS);
      expect(pagina.truncado).toBe(true);
    });

    test("dentro del límite no dice que hay más", async () => {
      await leads.create(baseLead({ nombre: "Freno uno" }));
      const pagina = await svc.buscar({ q: "freno" });
      expect(pagina.truncado).toBe(false);
    });
  });

  describe("cuántas consultas hace", () => {
    test("no hace una consulta por conversación (N+1) al resolver los mensajes", async () => {
      // 12 leads, cada uno con su sesión y su mensaje coincidente.
      for (let i = 0; i < 12; i += 1) {
        const lead = await leads.create(baseLead({ nombre: `Anónimo ${i}` }));
        const sesion = await sessions.create(baseSession(lead.id));
        await messages.create(baseMensaje(sesion.id, `necesito un radiador ${i}`));
      }

      const espias = {
        buscarContenido: 0,
        listByIds: 0,
        leadsList: 0,
        listActive: 0,
        listLeadIdsByTag: 0,
      };
      const original = {
        buscarContenido: messages.buscarContenido.bind(messages),
        listByIds: sessions.listByIds.bind(sessions),
        list: leads.list.bind(leads),
        listActive: sessions.listActive.bind(sessions),
        listLeadIdsByTag: tags.listLeadIdsByTag.bind(tags),
      };
      messages.buscarContenido = async (...args) => {
        espias.buscarContenido += 1;
        return original.buscarContenido(...args);
      };
      sessions.listByIds = async (...args) => {
        espias.listByIds += 1;
        return original.listByIds(...args);
      };
      leads.list = async (...args) => {
        espias.leadsList += 1;
        return original.list(...args);
      };
      sessions.listActive = async () => {
        espias.listActive += 1;
        return original.listActive();
      };
      tags.listLeadIdsByTag = async (...args) => {
        espias.listLeadIdsByTag += 1;
        return original.listLeadIdsByTag(...args);
      };

      const { resultados } = await svc.buscar({ q: "radiador" });
      expect(resultados).toHaveLength(12);

      // Cuatro lecturas, no doce: el mapeo sesión→lead y el badge de sesión
      // abierta se resuelven de una sola vez cada uno.
      expect(espias).toEqual({
        buscarContenido: 1,
        listByIds: 1,
        leadsList: 1,
        listActive: 1,
        listLeadIdsByTag: 0,
      });

      // Con el filtro de etiqueta puesto, una quinta y nada más.
      const tag = await tags.create({ nombre: "X", color: "#ffffff", descripcion: null });
      await svc.buscar({ q: "radiador", etiquetaId: tag.id });
      expect(espias.listLeadIdsByTag).toBe(1);
      expect(espias.leadsList).toBe(2);
    });
  });
});
