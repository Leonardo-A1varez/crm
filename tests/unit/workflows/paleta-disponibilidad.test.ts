import { describe, expect, it } from "vitest";
import { categoriasDePaleta } from "@/app/(panel)/workflows/[id]/_lib/presentacion-nodos";
import { NO_DISPONIBLES, disponibilidadDeTipo } from "@/lib/workflows/disponibilidad";
import type { NodoTipo } from "@/types/workflows";

function bloques(disparador?: string) {
  return categoriasDePaleta(disparador).flatMap((c) => c.bloques);
}

describe("la paleta del editor y lo que el motor ejecuta", () => {
  it("un bloque que el motor no ejecuta sale atenuado con su motivo", () => {
    for (const b of bloques()) {
      const d = disponibilidadDeTipo(b.tipo as NodoTipo);
      expect(b.motivoNoAplica, b.tipo).toBe(d.disponible ? undefined : d.motivo);
    }
  });

  it("los ejecutables no se atenúan sin un disparador puesto", () => {
    const ejecutables = bloques().filter((b) => !Object.hasOwn(NO_DISPONIBLES, b.tipo));
    expect(ejecutables.length).toBeGreaterThan(0);
    expect(ejecutables.every((b) => b.motivoNoAplica === undefined)).toBe(true);
  });

  it("con un disparador puesto, los otros disparadores se atenúan sin pisar el motivo de los que no corren", () => {
    const triggers = categoriasDePaleta("Lead creado").find((c) => c.id === "triggers")!.bloques;
    for (const b of triggers) {
      const d = disponibilidadDeTipo(b.tipo as NodoTipo);
      if (d.disponible) expect(b.motivoNoAplica, b.tipo).toContain("Lead creado");
      else expect(b.motivoNoAplica, b.tipo).toBe(d.motivo);
    }
  });

  it("devuelve la misma referencia mientras no cambie el disparador", () => {
    expect(categoriasDePaleta()).toBe(categoriasDePaleta());
  });
});
