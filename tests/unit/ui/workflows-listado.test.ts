import { describe, expect, it } from "vitest";
import {
  aFlujoEnLista,
  conteosPorEstado,
  flujosQueNecesitanConteoVivo,
  totalCorridas30d,
} from "@/app/(panel)/workflows/_lib/listado";
import { ESTADOS_WORKFLOW } from "@/lib/ui/workflow-estado";
import type { WorkflowEstado, WorkflowResumen } from "@/types/entities";

/**
 * La traducción entre `WorkflowResumen` (lo que devuelve el servicio) y
 * `FlujoEnLista` (lo que dibuja la pantalla).
 *
 * Lo que estos tests protegen es que los conteos de los chips se calculen sobre
 * la lista SIN filtrar y que las claves salgan de `ESTADOS_WORKFLOW`. Las dos
 * cosas ya se rompieron antes en este proyecto: cuando el estado pasó de cuatro
 * valores a cinco, una lista escrita a mano quedó ofreciendo un estado que ya
 * no existía y sin ofrecer el que se había agregado.
 */

const AHORA = new Date("2026-09-04T12:00:00Z").getTime();

function resumen(over: Partial<WorkflowResumen> & { estado: WorkflowEstado }): WorkflowResumen {
  return {
    workflow: {
      id: "11111111-1111-4111-8111-111111111111",
      nombre: "Seguimiento",
      descripcion: null,
      activo: true,
      created_at: new Date("2026-08-01T00:00:00Z"),
    },
    tieneVersionBorrador: false,
    versionPublicada: 1,
    resumenPasos: [],
    metricas: { totalRuns: 0, runsExitosos: 0, ultimoRun: null },
    ultimaEdicion: new Date("2026-08-01T00:00:00Z"),
    ...over,
  };
}

describe("aFlujoEnLista", () => {
  it("une los pasos con flechas y deja un texto legible cuando no hay ninguno", () => {
    const conPasos = aFlujoEnLista(
      resumen({ estado: "activo", resumenPasos: ["Mensaje recibido", "Enviar mensaje"] }),
      AHORA,
      0,
    );
    expect(conPasos.resumen).toBe("Mensaje recibido → Enviar mensaje");

    const sinPasos = aFlujoEnLista(resumen({ estado: "borrador" }), AHORA, 0);
    expect(sinPasos.resumen).toBe("Todavía no tiene pasos.");
  });

  /**
   * El componente exige el texto ya formateado, y no por gusto: la tarjeta
   * vieja llamaba a `Date.now()` dentro del render, así que el servidor podía
   * pintar "hace 3m" y el cliente "hace 4m" un segundo después.
   */
  it("resuelve la última ejecución como texto contra el ahora que se le pasa", () => {
    const flujo = aFlujoEnLista(
      resumen({
        estado: "activo",
        metricas: {
          totalRuns: 5,
          runsExitosos: 4,
          ultimoRun: { at: new Date(AHORA - 3 * 60_000), exito: true, duracionMs: 120 },
        },
      }),
      AHORA,
      0,
    );
    expect(flujo.ultimaEjecucion).toBe("hace 3m");
  });

  it("deja la última ejecución en null cuando el flujo nunca corrió", () => {
    expect(aFlujoEnLista(resumen({ estado: "borrador" }), AHORA, 0).ultimaEjecucion).toBeNull();
  });
});

describe("conteosPorEstado", () => {
  it("cuenta sobre la lista entera y trae una clave por cada estado más 'todos'", () => {
    const conteos = conteosPorEstado([
      resumen({ estado: "activo" }),
      resumen({ estado: "activo" }),
      resumen({ estado: "con-errores" }),
      resumen({ estado: "pausado" }),
    ]);

    expect(conteos.todos).toBe(4);
    expect(conteos.activo).toBe(2);
    expect(conteos["con-errores"]).toBe(1);
    expect(conteos.pausado).toBe(1);
    expect(conteos.borrador).toBe(0);
    expect(conteos["con-cambios"]).toBe(0);
  });

  /**
   * La regla que se rompió una vez: las claves se derivan de
   * `ESTADOS_WORKFLOW`, así que un sexto estado aparece solo en los chips en
   * vez de faltar en silencio.
   */
  it("no deja ningún estado sin clave, aunque no haya flujos", () => {
    const conteos = conteosPorEstado([]);
    for (const estado of ESTADOS_WORKFLOW) {
      expect(conteos[estado]).toBe(0);
    }
    expect(conteos.todos).toBe(0);
  });
});

describe("totalCorridas30d", () => {
  it("suma las corridas de todos los flujos", () => {
    const total = totalCorridas30d([
      resumen({ estado: "activo", metricas: { totalRuns: 12, runsExitosos: 10, ultimoRun: null } }),
      resumen({ estado: "pausado", metricas: { totalRuns: 3, runsExitosos: 3, ultimoRun: null } }),
    ]);
    expect(total).toBe(15);
  });
});

describe("flujosQueNecesitanConteoVivo", () => {
  /**
   * El conteo de corridas vivas cuesta dos consultas por flujo y la tarjeta lo
   * muestra en un solo lugar: la nota de la tarjeta pausada. Pedirlo para los
   * demás sería pagar por un dato que nadie lee.
   */
  it("pide el conteo sólo de los pausados", () => {
    const pausado = resumen({
      estado: "pausado",
      workflow: {
        id: "22222222-2222-4222-8222-222222222222",
        nombre: "Pausado",
        descripcion: null,
        activo: false,
        created_at: new Date("2026-08-01T00:00:00Z"),
      },
    });

    const ids = flujosQueNecesitanConteoVivo([
      resumen({ estado: "activo" }),
      pausado,
      resumen({ estado: "con-errores" }),
    ]);

    expect(ids).toEqual(["22222222-2222-4222-8222-222222222222"]);
  });
});
