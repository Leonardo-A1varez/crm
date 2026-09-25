import { describe, expect, test, vi } from "vitest";
import { cargarDatosDelLeadParaDifusion } from "@/server/services/difusion/datos-lead";

const LEAD = "0b4a6f7e-1a2b-4c3d-8e9f-000000000010";

function deps() {
  return {
    leads: {
      findById: vi.fn(async () => ({ nombre: "Ana", nombre_perfil: "Anita" })),
    },
    vehiculos: {
      listByLeadId: vi.fn(async () => [
        { marca: "Kia", modelo: "Rio", anio: 2015, principal: false },
        { marca: "Chevrolet", modelo: "Aveo", anio: 2012, principal: true },
      ]),
    },
    sessions: {
      findActiveByLeadId: vi.fn(async () => ({ consulta: "radiador" })),
    },
  };
}

describe("cargarDatosDelLeadParaDifusion", () => {
  test("carga sólo lo que piden las variables", async () => {
    const d = deps();
    const datos = await cargarDatosDelLeadParaDifusion(d, LEAD, new Set(["nombre"]));
    expect(datos).toEqual({ lead: { nombre: "Ana", nombre_perfil: "Anita" } });
    expect(d.vehiculos.listByLeadId).not.toHaveBeenCalled();
    expect(d.sessions.findActiveByLeadId).not.toHaveBeenCalled();
  });

  test("el vehículo es el principal, y la consulta sale de la sesión activa", async () => {
    const datos = await cargarDatosDelLeadParaDifusion(
      deps(),
      LEAD,
      new Set(["vehiculo_modelo", "vehiculo_anio", "consulta"]),
    );
    expect(datos.lead).toMatchObject({
      vehiculo_marca: "Chevrolet",
      vehiculo_modelo: "Aveo",
      vehiculo_anio: "2012",
    });
    expect(datos.sesion).toEqual({ consulta: "radiador" });
  });

  test("sin vehículo ni sesión, esos datos quedan vacíos y los cubre el respaldo", async () => {
    const d = deps();
    d.vehiculos.listByLeadId.mockResolvedValue([]);
    d.sessions.findActiveByLeadId.mockResolvedValue(null as never);
    const datos = await cargarDatosDelLeadParaDifusion(
      d,
      LEAD,
      new Set(["vehiculo_marca", "consulta"]),
    );
    expect(datos.lead?.vehiculo_marca).toBeNull();
    expect(datos.sesion).toBeUndefined();
  });
});
