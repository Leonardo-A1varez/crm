import { describe, expect, it } from "vitest";
import {
  CAMPOS_AUDIENCIA,
  DEFINICION_CAMPO_AUDIENCIA,
  esCampoAudiencia,
} from "@/lib/difusion/audiencia";
import { comparadoresDe } from "@/lib/ui/condiciones";
import { CURRENT_STAGE } from "@/types/domain";
import { camposAudiencia } from "./campos-audiencia";

describe("camposAudiencia", () => {
  it("ofrece exactamente los campos que la base sabe resolver, en el mismo orden", () => {
    expect(camposAudiencia().map((c) => c.id)).toEqual([...CAMPOS_AUDIENCIA]);
  });

  it("cada campo toma tipo y comparadores de la definición que usa el resolver", () => {
    for (const campo of camposAudiencia()) {
      if (!esCampoAudiencia(campo.id)) throw new Error(`campo fuera del backend: ${campo.id}`);
      const def = DEFINICION_CAMPO_AUDIENCIA[campo.id];
      expect(campo.tipo).toBe(def.tipo);
      expect(comparadoresDe(campo)).toEqual(def.comparadores);
    }
  });

  it("no renombra comparadores que el campo no ofrece", () => {
    for (const campo of camposAudiencia()) {
      for (const comparador of Object.keys(campo.etiquetas ?? {})) {
        expect(comparadoresDe(campo)).toContain(comparador);
      }
    }
  });

  it("las listas que son datos salen de los catálogos, y las del dominio de sus enums", () => {
    const etiquetas = [{ valor: "e1", etiqueta: "Pide factura", color: "#f59e0b" }];
    const vendedores = [{ valor: "v1", etiqueta: "Ana" }];
    const campanias = [{ valor: "d1", etiqueta: "Agosto" }];
    const porId = new Map(
      camposAudiencia({ etiquetas, vendedores, campanias }).map((c) => [c.id, c]),
    );
    expect(porId.get("etiqueta")?.opciones).toEqual(etiquetas);
    expect(porId.get("vendedor")?.opciones).toEqual(vendedores);
    expect(porId.get("campania_previa")?.opciones).toEqual(campanias);
    expect(porId.get("etapa")?.opciones?.map((o) => o.valor)).toEqual([...CURRENT_STAGE]);
  });

  it("toda multilista trae opciones aunque el catálogo venga vacío", () => {
    for (const campo of camposAudiencia()) {
      if (campo.tipo === "multilista" || campo.tipo === "lista") {
        expect(campo.opciones).toBeDefined();
      }
    }
  });
});
