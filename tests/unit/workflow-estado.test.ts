import { describe, expect, it } from "vitest";
import { calcularEstadoWorkflow } from "@/lib/ui/workflow-estado";

describe("calcularEstadoWorkflow", () => {
  it("sin version publicada es 'borrador', sin importar activo ni fallos", () => {
    expect(
      calcularEstadoWorkflow({
        activo: true,
        tieneVersionPublicada: false,
        ultimoRunFallado: true,
      }),
    ).toBe("borrador");
    expect(
      calcularEstadoWorkflow({
        activo: false,
        tieneVersionPublicada: false,
        ultimoRunFallado: false,
      }),
    ).toBe("borrador");
  });

  it("con version publicada y apagado es 'pausado', aunque el último run haya fallado", () => {
    expect(
      calcularEstadoWorkflow({
        activo: false,
        tieneVersionPublicada: true,
        ultimoRunFallado: true,
      }),
    ).toBe("pausado");
  });

  it("con version publicada, prendido y el último run fallado es 'error'", () => {
    expect(
      calcularEstadoWorkflow({
        activo: true,
        tieneVersionPublicada: true,
        ultimoRunFallado: true,
      }),
    ).toBe("error");
  });

  it("con version publicada, prendido y sin fallo reciente es 'activo'", () => {
    expect(
      calcularEstadoWorkflow({
        activo: true,
        tieneVersionPublicada: true,
        ultimoRunFallado: false,
      }),
    ).toBe("activo");
  });
});
