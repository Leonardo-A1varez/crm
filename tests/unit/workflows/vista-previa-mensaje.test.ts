import { describe, expect, it } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { interpolarVariables } from "@/lib/workflows/variables";
import { makeVistaPreviaMensajeService } from "@/server/services/workflows/vista-previa.service";

/**
 * La vista previa de «Enviar mensaje» contra un lead real: los datos con que el
 * motor resolvería las variables (la misma carga, `cargarDatosInterpolacion`) y
 * el último mensaje entrante de su conversación, que decide la ventana de 24 h.
 */

const LEAD = {
  id: "11111111-1111-4111-8111-111111111111",
  nombre: "Juan",
  telefono: "+54911",
  canal_origen: "wa",
  email: null,
};
const SESION = {
  id: "22222222-2222-4222-8222-222222222222",
  lead_id: LEAD.id,
  current_stage: "cotizado",
  vendedor_asignado_id: "33333333-3333-4333-8333-333333333333",
};
const VENDEDOR = { id: SESION.vendedor_asignado_id, nombre: "María", email: "m@x.com" };
const ENTRANTE = new Date("2026-09-25T10:00:00Z");

function servicio(opciones: { sesion?: boolean; conversacion?: boolean } = {}) {
  const { sesion = true, conversacion = true } = opciones;
  return makeVistaPreviaMensajeService({
    leads: { findById: async (id) => (id === LEAD.id ? LEAD : null) },
    sessions: {
      findActiveByLeadId: async () => (sesion ? SESION : null),
      findById: async (id) => (id === SESION.id ? SESION : null),
    },
    users: { findById: async (id) => (id === VENDEDOR.id ? VENDEDOR : null) },
    conversaciones: {
      findActivaByLead: async () =>
        conversacion ? { id: "c1", canal: "wa" as const, ultimo_entrante_at: ENTRANTE } : null,
    },
  });
}

describe("vista previa de «Enviar mensaje»", () => {
  it("devuelve los datos con que el motor resolvería las variables", async () => {
    const r = await servicio().leer(LEAD.id);
    const { texto } = interpolarVariables(
      "Hola {{lead.nombre}}, te escribe {{vendedor.nombre}} ({{sesion.current_stage}})",
      r.datos,
    );
    expect(texto).toBe("Hola Juan, te escribe María (cotizado)");
  });

  it("trae el último mensaje entrante y el canal de la conversación activa", async () => {
    const r = await servicio().leer(LEAD.id);
    expect(r.ventana).toEqual({ canal: "wa", ultimoEntranteAt: ENTRANTE.toISOString() });
  });

  it("sin conversación no hay ventana que medir: lo dice con null", async () => {
    const r = await servicio({ conversacion: false }).leer(LEAD.id);
    expect(r.ventana).toBeNull();
  });

  it("sin sesión activa, las variables de la sesión y del vendedor salen vacías, como en el motor", async () => {
    const r = await servicio({ sesion: false }).leer(LEAD.id);
    expect(interpolarVariables("{{vendedor.nombre}}|{{lead.nombre}}", r.datos).texto).toBe("|Juan");
  });

  it("un lead que no existe es NotFoundError", async () => {
    await expect(servicio().leer("99999999-9999-4999-8999-999999999999")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
