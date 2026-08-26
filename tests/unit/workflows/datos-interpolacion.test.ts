import { describe, it, expect, vi } from "vitest";
import { cargarDatosInterpolacion } from "@/server/services/workflows/acciones/datos-interpolacion";

describe("cargarDatosInterpolacion", () => {
  it("carga lead y sesion desde datos disponibles", async () => {
    const deps = {
      leads: {
        findById: vi.fn().mockResolvedValue({
          id: "lead-1",
          nombre: "Juan",
          telefono: "+123",
          canal_origen: "whatsapp",
        }),
      },
      sessions: {
        findById: vi.fn().mockResolvedValue({
          id: "session-1",
          current_stage: "cotizacion",
          resultado: "pendiente",
        }),
      },
      users: {
        findById: vi.fn(),
      },
    };

    const entorno = {
      leadId: "lead-1",
      leadSessionId: "session-1",
      contexto: { producto: "filtro" },
    };

    const resultado = await cargarDatosInterpolacion(deps, entorno);

    expect(resultado.lead?.nombre).toBe("Juan");
    expect(resultado.lead?.telefono).toBe("+123");
    expect(resultado.sesion?.current_stage).toBe("cotizacion");
    expect(resultado.contexto?.producto).toBe("filtro");
  });

  it("maneja sesion faltante", async () => {
    const deps = {
      leads: {
        findById: vi.fn().mockResolvedValue({
          id: "lead-1",
          nombre: "Juan",
          telefono: "+123",
          canal_origen: "whatsapp",
        }),
      },
      sessions: { findById: vi.fn().mockResolvedValue(null) },
      users: { findById: vi.fn() },
    };

    const entorno = {
      leadId: "lead-1",
      leadSessionId: null,
      contexto: {},
    };

    const resultado = await cargarDatosInterpolacion(deps, entorno);

    expect(resultado.lead?.nombre).toBe("Juan");
    expect(resultado.sesion).toBeUndefined();
  });
});
