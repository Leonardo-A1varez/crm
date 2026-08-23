import { describe, expect, it } from "vitest";
import { evaluarCondicion } from "@/lib/workflows/condiciones";

const contexto = { lead: { etapa: "cotizado", nombre: "Ana" }, sesion: { respondio: false } };

describe("evaluarCondicion", () => {
  it("compara igualdad por campo de la lista blanca", () => {
    expect(
      evaluarCondicion({ campo: "lead.etapa", operador: "es", valor: "cotizado" }, contexto),
    ).toBe(true);
    expect(
      evaluarCondicion({ campo: "lead.etapa", operador: "es", valor: "perdido" }, contexto),
    ).toBe(false);
  });

  it("no_es es la negacion exacta de es", () => {
    expect(
      evaluarCondicion({ campo: "lead.etapa", operador: "no_es", valor: "perdido" }, contexto),
    ).toBe(true);
  });

  it("contiene compara texto sin distinguir mayusculas", () => {
    expect(
      evaluarCondicion({ campo: "lead.nombre", operador: "contiene", valor: "AN" }, contexto),
    ).toBe(true);
  });

  it("un campo ausente del contexto es false, no una excepcion", () => {
    // Un flujo no se cae porque un dato todavia no exista: la rama falso es
    // una respuesta valida y el canvas siempre la tiene conectada.
    expect(evaluarCondicion({ campo: "lead.etapa", operador: "es", valor: "x" }, {})).toBe(false);
  });

  it("es_verdadero lee booleanos", () => {
    expect(
      evaluarCondicion(
        { campo: "sesion.respondio", operador: "es_verdadero", valor: null },
        contexto,
      ),
    ).toBe(false);
  });
});
