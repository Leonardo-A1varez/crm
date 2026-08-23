import { describe, expect, it } from "vitest";
import { simular } from "@/server/services/workflows/simulador.service";
import type { Grafo } from "@/types/workflows";

/** Ciclo legitimo segun el validador: tiene una espera adentro. Y aun asi no termina nunca. */
const cicloInfinito: Grafo = {
  nodos: [
    { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
    { id: "env", tipo: "accion", config: { accion: "enviar_mensaje" }, posicion: { x: 0, y: 0 } },
    { id: "w", tipo: "espera", config: { minutos: 2880 }, posicion: { x: 0, y: 0 } },
  ],
  aristas: [
    { desde: "d", hasta: "env", puerto: "salida" },
    { desde: "env", hasta: "w", puerto: "salida" },
    { desde: "w", hasta: "env", puerto: "salida" },
  ],
};

describe("simular", () => {
  it("detecta el flujo que pasa el validador y no termina nunca", async () => {
    const r = await simular(cicloInfinito, {
      maxPasos: 50,
      desde: new Date("2026-01-01T00:00:00Z"),
    });
    expect(r.desenlace).toBe("tope");
    expect(r.pasos).toHaveLength(50);
    // Lo que el dueño necesita ver antes de prenderlo.
    expect(r.salientes).toBeGreaterThan(20);
  });

  it("el reloj virtual avanza con cada espera", async () => {
    const r = await simular(cicloInfinito, {
      maxPasos: 6,
      desde: new Date("2026-01-01T00:00:00Z"),
    });
    const relojes = r.pasos.map((p) => p.reloj.toISOString());
    expect(relojes[0]).toBe("2026-01-01T00:00:00.000Z");
    // Tras la primera espera de 2880 min (2 dias).
    expect(relojes.at(-1)).not.toBe(relojes[0]);
  });

  it("un flujo sano termina en fin", async () => {
    const sano: Grafo = {
      nodos: [
        { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
        { id: "f", tipo: "fin", config: {}, posicion: { x: 0, y: 0 } },
      ],
      aristas: [{ desde: "d", hasta: "f", puerto: "salida" }],
    };
    const r = await simular(sano, { maxPasos: 10, desde: new Date() });
    expect(r.desenlace).toBe("fin");
  });

  // MUST-FIX 2 (review de rama completa): una acción antes de la espera
  // escribe `sesion.tiene_cotizacion` en el contexto; la condición DESPUÉS
  // de la espera lo lee. Si el simulador re-pasa `opciones.contexto` original
  // en vez de `resultado.contexto` en cada vuelta del while, la condición ve
  // el contexto de ANTES de la acción -- distinto de lo que vería producción,
  // que sí persiste `resultado.contexto` en `runs.esperar()`
  // (workflow-segmento.ts:166). El branch tomado ("verdadero" vs "falso")
  // prueba que la simulación siguió el mismo camino que producción tomaría.
  it("una condición después de una espera ve el contexto que escribió la acción de antes", async () => {
    const conCotizacion: Grafo = {
      nodos: [
        { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
        {
          id: "cotizar",
          tipo: "accion",
          config: { accion: "cotizar", contexto: { sesion: { tiene_cotizacion: true } } },
          posicion: { x: 0, y: 0 },
        },
        { id: "w", tipo: "espera", config: { minutos: 60 }, posicion: { x: 0, y: 0 } },
        {
          id: "cond",
          tipo: "condicion",
          config: { campo: "sesion.tiene_cotizacion", operador: "es_verdadero", valor: null },
          posicion: { x: 0, y: 0 },
        },
        { id: "con", tipo: "fin", config: {}, posicion: { x: 0, y: 0 } },
        { id: "sin", tipo: "fin", config: {}, posicion: { x: 0, y: 0 } },
      ],
      aristas: [
        { desde: "d", hasta: "cotizar", puerto: "salida" },
        { desde: "cotizar", hasta: "w", puerto: "salida" },
        { desde: "w", hasta: "cond", puerto: "salida" },
        { desde: "cond", hasta: "con", puerto: "verdadero" },
        { desde: "cond", hasta: "sin", puerto: "falso" },
      ],
    };
    const r = await simular(conCotizacion, {
      maxPasos: 20,
      desde: new Date("2026-01-01T00:00:00Z"),
    });
    expect(r.desenlace).toBe("fin");
    const paso = r.pasos.find((p) => p.nodoId === "cond");
    expect(paso?.salida).toEqual({ cumple: true });
  });

  // Promoted from deferred minor (review de rama completa): un grafo de
  // borrador -- el estado más común mientras se arma en el canvas de W5 --
  // todavía no tiene disparador. El validador de W1 lo rechazaría, pero el
  // simulador corre ANTES de guardar, sobre borradores que el validador
  // nunca vio. Sin este chequeo, `desenlace: "fin"` con 0 pasos es
  // indistinguible de un flujo sano que corrió y terminó bien.
  it("un grafo sin disparador no reporta 'fin' -- desenlace distinto y honesto", async () => {
    const sinDisparador: Grafo = {
      nodos: [{ id: "f", tipo: "fin", config: {}, posicion: { x: 0, y: 0 } }],
      aristas: [],
    };
    const r = await simular(sinDisparador, { maxPasos: 10, desde: new Date() });
    expect(r.desenlace).not.toBe("fin");
    expect(r.desenlace).toBe("sin_disparador");
    expect(r.pasos).toHaveLength(0);
    expect(r.error).toBeTruthy();
  });
});
