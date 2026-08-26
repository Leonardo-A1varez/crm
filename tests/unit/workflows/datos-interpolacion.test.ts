import { describe, it, expect, vi } from "vitest";
import { cargarDatosInterpolacion } from "@/server/services/workflows/acciones/datos-interpolacion";

describe("cargarDatosInterpolacion", () => {
  it("carga lead, sesion y vendedor", async () => {
    const deps = {
      leads: {
        findById: vi.fn().mockResolvedValue({
          id: "lead-1",
          nombre: "Juan",
          telefono: "+123",
          etapa: "nuevo",
          canal: "whatsapp",
          vendedor_id: "user-1",
        }),
      },
      sessions: {
        findById: vi.fn().mockResolvedValue({
          id: "session-1",
          auto_marca: "Toyota",
          auto_modelo: "Corolla",
          auto_anio: 2020,
          current_stage: "cotizacion",
        }),
      },
      users: {
        findById: vi.fn().mockResolvedValue({
          id: "user-1",
          nombre: "Vendedor 1",
          email: "v@test.com",
        }),
      },
    };

    const entorno = {
      leadId: "lead-1",
      leadSessionId: "session-1",
      contexto: { producto: "filtro" },
    };

    const resultado = await cargarDatosInterpolacion(deps, entorno);

    expect(resultado.lead?.nombre).toBe("Juan");
    expect(resultado.sesion?.auto_marca).toBe("Toyota");
    expect(resultado.vendedor?.nombre).toBe("Vendedor 1");
    expect(resultado.contexto?.producto).toBe("filtro");
  });

  it("maneja lead sin vendedor", async () => {
    const deps = {
      leads: {
        findById: vi.fn().mockResolvedValue({
          id: "lead-1",
          nombre: "Juan",
          vendedor_id: null,
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
    expect(resultado.vendedor).toBeUndefined();
    expect(deps.users.findById).not.toHaveBeenCalled();
  });
});
