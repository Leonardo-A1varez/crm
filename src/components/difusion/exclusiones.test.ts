import { describe, expect, it } from "vitest";
import { MOTIVO_EXCLUSION, esMotivoEximible, type MotivoExclusion } from "@/lib/difusion/modelo";
import { EXCLUSION, exclusionesVisibles } from "./exclusiones";
import type { Exclusion } from "./tipos";

function exclusion(motivo: MotivoExclusion, cantidad: number, aplicada = true): Exclusion {
  return { motivo, cantidad, aplicada, eximible: esMotivoEximible(motivo) };
}

describe("EXCLUSION", () => {
  it("describe los diez motivos del planificador, cada uno con qué pasa si no se excluye", () => {
    for (const motivo of MOTIVO_EXCLUSION) {
      expect(EXCLUSION[motivo].etiqueta.trim()).not.toBe("");
      expect(EXCLUSION[motivo].consecuencia.trim()).not.toBe("");
    }
  });

  it("los códigos de Meta son los de la tabla del PRD (§4.4)", () => {
    expect(EXCLUSION.baja_meta.codigo).toBe("131050");
    expect(EXCLUSION.saturado_meta.codigo).toBe("131049");
  });
});

describe("exclusionesVisibles", () => {
  it("las eximibles se ven siempre; las obligatorias sólo si excluyen a alguien", () => {
    const todas = MOTIVO_EXCLUSION.map((m) => exclusion(m, m === "baja_propia" ? 3 : 0));
    expect(exclusionesVisibles(todas).map((e) => e.motivo)).toEqual([
      "baja_propia",
      "cap_frecuencia",
      "en_negociacion",
    ]);
  });

  it("una eximida que excluiría a alguien se sigue viendo, y conserva la precedencia", () => {
    const todas = [
      exclusion("en_negociacion", 4, false),
      exclusion("duplicado_telefono", 2),
      exclusion("cap_frecuencia", 0),
    ];
    expect(exclusionesVisibles(todas).map((e) => e.motivo)).toEqual([
      "duplicado_telefono",
      "cap_frecuencia",
      "en_negociacion",
    ]);
  });
});
