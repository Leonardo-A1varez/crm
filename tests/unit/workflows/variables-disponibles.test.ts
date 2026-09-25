import { describe, expect, it } from "vitest";
import { VARIABLES_DISPONIBLES } from "@/components/workflows/canvas/config/VariableSelector";
import { interpolarVariables } from "@/lib/workflows/variables";
import { cargarDatosInterpolacion } from "@/server/services/workflows/acciones/datos-interpolacion";
import { sesionSimulada } from "@/server/services/workflows/simulador.service";
import type { Lead, Usuario } from "@/types/entities";

/**
 * Las variables que ofrece el panel (`VariableSelector` y el autocompletado de
 * `TextareaConVariables`) contra lo que el motor resuelve de verdad.
 *
 * `interpolarVariables` no falla con una variable que no conoce: la reemplaza
 * por "" y sigue. Un mensaje armado con una variable que el motor no carga le
 * llega al cliente con un hueco ("Hola , tu  está lista"), sin un error en
 * ningún log. Este test arma los datos con `cargarDatosInterpolacion` —la
 * misma función que usa `enviar_mensaje` antes de mandar— a partir de un lead
 * con todos sus campos llenos, y exige que cada variable ofrecida salga con
 * valor.
 */

const AHORA = new Date("2026-09-13T12:00:00Z");

/** Todos los campos con valor: si una variable sale vacía, es porque el motor no la carga. */
const LEAD: Lead = {
  id: "lead-1",
  nombre: "Ana",
  nombre_perfil: "Ana P.",
  telefono: "+5491100000000",
  email: "ana@example.com",
  direccion: "Calle 1",
  datos_extra: {},
  vehiculo_marca: "Chevrolet",
  vehiculo_modelo: "Aveo",
  vehiculo_anio: 2015,
  vehiculo_motor: "1.6",
  empresa_id: null,
  canal_origen: "wa",
  meta_user_ids: {},
  created_at: AHORA,
  updated_at: AHORA,
};

const VENDEDOR: Usuario = {
  id: "ven-1",
  nombre: "Beto",
  email: "beto@crm.local",
  rol: "vendedor",
  activo: true,
  created_at: AHORA,
};

describe("variables del panel", () => {
  it("cada variable que ofrece el selector la resuelve el motor, sin dejar hueco", async () => {
    const sesion = {
      ...sesionSimulada(LEAD.id, AHORA),
      vendedor_asignado_id: VENDEDOR.id,
      asignado_at: AHORA,
    };
    const datos = await cargarDatosInterpolacion(
      {
        leads: { findById: async () => LEAD },
        sessions: { findById: async () => sesion },
        users: { findById: async (id) => (id === VENDEDOR.id ? VENDEDOR : null) },
      },
      { leadId: LEAD.id, leadSessionId: sesion.id, contexto: {} },
    );

    const huecos = VARIABLES_DISPONIBLES.filter((v) => {
      const r = interpolarVariables(`{{${v.key}}}`, datos);
      return r.warnings.length > 0 || r.texto === "";
    }).map((v) => v.key);

    expect(huecos).toEqual([]);
  });

  it("ofrece las que tienen dato en la base: email, etapa y el vendedor asignado", () => {
    expect(VARIABLES_DISPONIBLES.map((v) => v.key)).toEqual(
      expect.arrayContaining(["lead.email", "lead.etapa", "vendedor.nombre", "vendedor.email"]),
    );
  });

  it("sin vendedor asignado, las variables del vendedor salen vacías sin romper", async () => {
    const sesion = sesionSimulada(LEAD.id, AHORA);
    const datos = await cargarDatosInterpolacion(
      {
        leads: { findById: async () => LEAD },
        sessions: { findById: async () => sesion },
        users: {
          findById: async () => {
            throw new Error("no se busca un vendedor que no hay");
          },
        },
      },
      { leadId: LEAD.id, leadSessionId: sesion.id, contexto: {} },
    );
    expect(interpolarVariables("{{vendedor.nombre}}", datos).texto).toBe("");
    expect(interpolarVariables("{{lead.etapa}}", datos).texto).toBe("nuevo");
  });

  it("el selector ofrece al menos una variable", () => {
    // Sin esto, un selector vacío pasaría el test de arriba sin probar nada.
    expect(VARIABLES_DISPONIBLES.length).toBeGreaterThan(0);
  });
});
