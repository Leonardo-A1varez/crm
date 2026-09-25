import { describe, expect, it } from "vitest";
import {
  ESTADOS_WORKFLOW,
  ESTADO_WORKFLOW,
  SEMANTICA_PAUSA,
  derivarEstadoWorkflow,
  estaEnMarcha,
  tinte,
} from "@/lib/ui/workflow-estado";
import type { WorkflowEstado } from "@/types/entities";

/** Las cuatro entradas, con los valores del caso feliz por defecto. */
function entrada(over: Partial<Parameters<typeof derivarEstadoWorkflow>[0]> = {}) {
  return {
    activo: true,
    tieneVersionPublicada: true,
    tieneVersionBorrador: false,
    ultimoRunFallado: false,
    ...over,
  };
}

describe("derivarEstadoWorkflow", () => {
  it("sin versión publicada es 'borrador', sin importar nada más", () => {
    expect(
      derivarEstadoWorkflow(
        entrada({
          tieneVersionPublicada: false,
          ultimoRunFallado: true,
          tieneVersionBorrador: true,
        }),
      ),
    ).toBe("borrador");
    expect(derivarEstadoWorkflow(entrada({ activo: false, tieneVersionPublicada: false }))).toBe(
      "borrador",
    );
  });

  it("apagado es 'pausado', y tapa tanto el fallo viejo como el borrador pendiente", () => {
    expect(
      derivarEstadoWorkflow(
        entrada({ activo: false, ultimoRunFallado: true, tieneVersionBorrador: true }),
      ),
    ).toBe("pausado");
  });

  it("el último run fallado es 'con-errores'", () => {
    expect(derivarEstadoWorkflow(entrada({ ultimoRunFallado: true }))).toBe("con-errores");
  });

  it("una versión más nueva que la publicada es 'con-cambios'", () => {
    expect(derivarEstadoWorkflow(entrada({ tieneVersionBorrador: true }))).toBe("con-cambios");
  });

  /**
   * La precedencia que justifica que los cinco estados sean uno solo y no un
   * estado más un booleano: cuando los dos hechos son ciertos a la vez, el
   * badge lo gana el que es urgente. El borrador pendiente no se pierde — la
   * tarjeta lo sigue diciendo con palabras — pero no le roba la marca a algo
   * que está fallando.
   */
  it("'con-errores' le gana a 'con-cambios' cuando los dos son ciertos", () => {
    expect(
      derivarEstadoWorkflow(entrada({ ultimoRunFallado: true, tieneVersionBorrador: true })),
    ).toBe("con-errores");
  });

  it("publicado, prendido, al día y sin fallos es 'activo'", () => {
    expect(derivarEstadoWorkflow(entrada())).toBe("activo");
  });
});

describe("estaEnMarcha", () => {
  it("sólo 'borrador' y 'pausado' no pueden dispararse", () => {
    const enMarcha = ESTADOS_WORKFLOW.filter(estaEnMarcha);
    expect(enMarcha).toEqual(["activo", "con-cambios", "con-errores"]);
  });
});

describe("ESTADO_WORKFLOW", () => {
  it("los cinco estados tienen label, color como token y significado", () => {
    for (const estado of ESTADOS_WORKFLOW) {
      const d = ESTADO_WORKFLOW[estado];
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.significado.length).toBeGreaterThan(0);
      // Token del tema, nunca un color crudo: era `bg-emerald-500` y compañía.
      expect(d.color).toMatch(/^var\(--color-[a-z-]+\)$/);
    }
  });

  it("ningún par de estados comparte label ni color", () => {
    const labels = ESTADOS_WORKFLOW.map((e) => ESTADO_WORKFLOW[e].label);
    const colores = ESTADOS_WORKFLOW.map((e) => ESTADO_WORKFLOW[e].color);
    expect(new Set(labels).size).toBe(ESTADOS_WORKFLOW.length);
    expect(new Set(colores).size).toBe(ESTADOS_WORKFLOW.length);
  });

  /**
   * El detalle de producto que no se puede perder: pausar frena los disparos
   * nuevos y no toca lo que ya está corriendo. Tiene que estar DICHO, no
   * implícito, y el significado de `pausado` es uno de los tres lugares donde
   * se muestra.
   */
  it("el significado de 'pausado' dice qué pasa con las corridas en curso", () => {
    expect(ESTADO_WORKFLOW.pausado.significado).toBe(SEMANTICA_PAUSA.completa);
    expect(SEMANTICA_PAUSA.completa).toContain("No dispara corridas nuevas");
    expect(SEMANTICA_PAUSA.completa).toContain("siguen hasta terminar");
  });
});

describe("tinte", () => {
  it("compone sobre el propio color y no sobre una superficie fija", () => {
    expect(tinte("var(--color-ok)", 12)).toBe(
      "color-mix(in srgb, var(--color-ok) 12%, transparent)",
    );
  });
});

describe("WORKFLOW_ESTADOS", () => {
  it("son cinco y están en orden de ciclo de vida", () => {
    const esperado: WorkflowEstado[] = [
      "borrador",
      "activo",
      "con-cambios",
      "pausado",
      "con-errores",
    ];
    expect([...ESTADOS_WORKFLOW]).toEqual(esperado);
  });
});
