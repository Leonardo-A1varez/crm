import { describe, expect, it } from "vitest";
import { DISPARADOR_DE_TIPO, ETIQUETA_NODO } from "@/lib/workflows/catalogo";
import { ESPEC_CONFIG_POR_TIPO } from "@/lib/workflows/config-nodos";
import { disponibilidadDeTipo } from "@/lib/workflows/disponibilidad";
import { CATEGORIAS_NODOS } from "@/lib/workflows/nodos-catalogo";
import { disparoCoincide } from "@/lib/workflows/recorrer";
import { categoriaDeTipo, NODO_TIPOS_DIFUSION, type Grafo } from "@/types/workflows";

/**
 * La categoría Difusión del editor (docs/prd-workflows.md §4.6) y el
 * disparador "Difusión respondida" (§4.1).
 */

function grafoCon(config: Record<string, unknown>): Grafo {
  return {
    nodos: [
      { id: "t", tipo: "trigger_difusion_respondida", config, posicion: { x: 0, y: 0 } },
      { id: "f", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 0 } },
    ],
    aristas: [{ desde: "t", hasta: "f", puerto: "salida" }],
  };
}

describe("disparador «Difusión respondida»", () => {
  it("escucha el evento difusion_respondida y se puede ejecutar", () => {
    expect(DISPARADOR_DE_TIPO.trigger_difusion_respondida).toBe("difusion_respondida");
    expect(disponibilidadDeTipo("trigger_difusion_respondida")).toEqual({ disponible: true });
  });

  it("sin campaña elegida arranca con la respuesta a cualquiera", () => {
    expect(disparoCoincide(grafoCon({}), "difusion_respondida", { difusionId: "d1" })).toBe(true);
  });

  it("con una campaña elegida sólo arranca con la respuesta a esa", () => {
    const g = grafoCon({ difusionId: "d1" });
    expect(disparoCoincide(g, "difusion_respondida", { difusionId: "d1" })).toBe(true);
    expect(disparoCoincide(g, "difusion_respondida", { difusionId: "d2" })).toBe(false);
    // Sin el dato no se sabe a cuál respondió: falla cerrado.
    expect(disparoCoincide(g, "difusion_respondida", {})).toBe(false);
  });

  it("no arranca con otro evento", () => {
    expect(disparoCoincide(grafoCon({}), "mensaje_recibido", { difusionId: "d1" })).toBe(false);
  });

  it("es un trigger y está en la paleta, en Inicio", () => {
    expect(categoriaDeTipo("trigger_difusion_respondida")).toBe("trigger");
    const triggers = CATEGORIAS_NODOS.find((c) => c.id === "triggers")!;
    expect(triggers.nodos.some((n) => n.tipo === "trigger_difusion_respondida")).toBe(true);
    expect(ETIQUETA_NODO.trigger_difusion_respondida).toBe("Difusión respondida");
  });
});

describe("bloques de Difusión", () => {
  it("son los cinco del PRD, en su propia categoría de la paleta", () => {
    const cat = CATEGORIAS_NODOS.find((c) => c.id === "difusion");
    expect(cat?.nodos.map((n) => n.tipo)).toEqual([...NODO_TIPOS_DIFUSION]);
    expect(NODO_TIPOS_DIFUSION.map((t) => ETIQUETA_NODO[t])).toEqual([
      "Definir audiencia",
      "Enviar difusión",
      "Excluir",
      "Esperar respuesta de difusión",
      "Dividir audiencia",
    ]);
    for (const t of NODO_TIPOS_DIFUSION) expect(categoriaDeTipo(t)).toBe("difusion");
  });

  it("ninguno corre: el motor ejecuta un flujo por lead y estos operan sobre un grupo", () => {
    for (const t of NODO_TIPOS_DIFUSION) {
      const d = disponibilidadDeTipo(t);
      expect(d.disponible).toBe(false);
      if (!d.disponible) expect(d.motivo.length).toBeGreaterThan(20);
    }
  });

  it("todos tienen schema de config", () => {
    for (const t of NODO_TIPOS_DIFUSION) expect(ESPEC_CONFIG_POR_TIPO[t]).toBeDefined();
  });
});
