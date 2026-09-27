import { describe, expect, it, vi } from "vitest";
import { ejecutarSegmento, type PasoEjecutado } from "@/server/services/workflows/ejecutor.service";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import type { Grafo } from "@/types/workflows";

/**
 * El contrato del ejecutor con "Delegar al agente": la acción pide esperar el
 * turno del agente (`esperarTurnoAgente`) y el segmento corta reanudando en ESE
 * nodo, con el contexto que dejó la acción. La pasada que decide sale por su
 * puerto.
 */

const AHORA = new Date("2026-09-26T10:00:00Z");
const HASTA = new Date("2026-09-27T10:00:00Z");

const grafo: Grafo = {
  nodos: [
    { id: "t", tipo: "trigger_lead_creado", config: {}, posicion: { x: 0, y: 0 } },
    { id: "d", tipo: "ia_delegar", config: {}, posicion: { x: 0, y: 0 } },
    { id: "ok", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 0 } },
  ],
  aristas: [
    { desde: "t", hasta: "d", puerto: "salida" },
    { desde: "d", hasta: "ok", puerto: "resuelto" },
  ],
};

function correr(salida: "esperar" | "resuelto") {
  const registro = crearRegistro({
    delegar_al_agente: async () =>
      salida === "esperar"
        ? {
            puerto: "sin_respuesta",
            esperarTurnoAgente: { hasta: HASTA },
            contexto: { marca: 1 },
            salida: { turnos: 0 },
          }
        : { puerto: "resuelto", salida: { motivo: "intent" } },
  });
  const onPaso = vi.fn(async (_p: PasoEjecutado) => {});
  return {
    onPaso,
    r: ejecutarSegmento(
      {
        grafo,
        desdeNodo: "t",
        contexto: { previo: 1 },
        leadId: "l1",
        runId: "r1",
        pasosPrevios: 0,
        maxPasos: 50,
      },
      { registro, ahora: () => AHORA, onPaso },
    ),
  };
}

describe("ejecutor — Delegar al agente", () => {
  it("corta reanudando en el mismo nodo, con el contexto de la acción y la marca de espera", async () => {
    const { r, onPaso } = correr("esperar");
    expect(await r).toEqual({
      tipo: "espera",
      nodoId: "d",
      hasta: HASTA,
      reanudarEn: "d",
      contexto: { previo: 1, marca: 1 },
      esperaTurnoAgente: true,
    });
    expect(onPaso.mock.calls[1]![0]).toMatchObject({
      nodoId: "d",
      salida: { turnos: 0, hasta: HASTA.toISOString(), esperando: "turno_agente" },
    });
  });

  it("la pasada que decide sigue por su salida", async () => {
    const { r, onPaso } = correr("resuelto");
    expect(await r).toEqual({ tipo: "fin" });
    expect(onPaso.mock.calls.map((c) => c[0].nodoId)).toEqual(["t", "d", "ok"]);
  });
});
