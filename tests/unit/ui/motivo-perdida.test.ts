import { describe, expect, test } from "vitest";
import {
  CLAVE_MOTIVO_SUGERIDO,
  MOTIVO_LABEL,
  motivoPerdidaLabel,
  motivoSugerido,
} from "@/lib/ui/motivo-perdida";
import { MOTIVO_PERDIDA } from "@/types/domain";

describe("MOTIVO_LABEL", () => {
  test("nombra los cinco motivos del dominio y ninguno más", () => {
    expect(Object.keys(MOTIVO_LABEL).sort()).toEqual([...MOTIVO_PERDIDA].sort());
  });

  test("ningún rótulo queda vacío", () => {
    for (const m of MOTIVO_PERDIDA) expect(motivoPerdidaLabel(m).trim()).not.toBe("");
  });
});

describe("motivoSugerido", () => {
  test("devuelve el motivo que dejó propuesto el extractor", () => {
    expect(motivoSugerido({ [CLAVE_MOTIVO_SUGERIDO]: "precio" })).toBe("precio");
  });

  test("sin la clave no hay propuesta", () => {
    expect(motivoSugerido({})).toBeNull();
    expect(motivoSugerido({ otra_cosa: "precio" })).toBeNull();
  });

  // `extras` es jsonb que llenó un LLM: puede traer cualquier cosa y ninguna
  // sugerencia es mejor que una que el enum no reconoce.
  test("descarta lo que no es uno de los motivos del enum", () => {
    expect(motivoSugerido({ [CLAVE_MOTIVO_SUGERIDO]: "caro" })).toBeNull();
    expect(motivoSugerido({ [CLAVE_MOTIVO_SUGERIDO]: 42 })).toBeNull();
    expect(motivoSugerido({ [CLAVE_MOTIVO_SUGERIDO]: null })).toBeNull();
    expect(motivoSugerido({ [CLAVE_MOTIVO_SUGERIDO]: { motivo: "precio" } })).toBeNull();
  });
});
