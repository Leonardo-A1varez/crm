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
});
