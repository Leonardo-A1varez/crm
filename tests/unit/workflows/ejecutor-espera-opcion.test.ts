import { describe, expect, it, vi } from "vitest";
import {
  CLAVE_ESPERA_OPCION,
  conOpcionElegida,
  esperaDeOpcionDe,
  marcarEsperaDeOpcion,
  ESPERA_DE_OPCION_RESUELTA,
} from "@/lib/workflows/respuesta-interactiva";
import { ejecutarSegmento, type PasoEjecutado } from "@/server/services/workflows/ejecutor.service";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import { puertoDeOpcion, type Grafo } from "@/types/workflows";

/**
 * El contrato del ejecutor con un nodo que manda opciones: la acción pide
 * esperar (`esperarRespuesta`) y el segmento corta reanudando en ESE nodo, con
 * el contexto que dejó la acción. La segunda pasada sale por la opción.
 */

const AHORA = new Date("2026-09-22T15:00:00Z");
const HASTA = new Date("2026-09-22T17:00:00Z");

const grafo: Grafo = {
  nodos: [
    { id: "t", tipo: "trigger_mensaje", config: {}, posicion: { x: 0, y: 0 } },
    { id: "b", tipo: "msg_botones", config: {}, posicion: { x: 0, y: 0 } },
    { id: "si", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 0 } },
    { id: "nada", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 0 } },
  ],
  aristas: [
    { desde: "t", hasta: "b", puerto: "salida" },
    { desde: "b", hasta: "si", puerto: puertoDeOpcion("si") },
    { desde: "b", hasta: "nada", puerto: "sin_respuesta" },
  ],
};

/** Una acción de botones mínima: la lógica de verdad está en `enviar-rico.ts`. */
const mandar = vi.fn();
const registro = crearRegistro({
  enviar_botones: async (nodo, entorno) => {
    const espera = esperaDeOpcionDe(entorno.contexto, nodo.id);
    if (espera) {
      return {
        puerto: espera.respuesta ? puertoDeOpcion(espera.respuesta.id) : "sin_respuesta",
        contexto: ESPERA_DE_OPCION_RESUELTA,
      };
    }
    mandar();
    return {
      puerto: "sin_respuesta",
      esperarRespuesta: { hasta: HASTA, respondeA: "wamid.OUT" },
      contexto: marcarEsperaDeOpcion(nodo.id, "wamid.OUT"),
      salida: { mensaje_id: "m1" },
    };
  },
});

function correr(desdeNodo: string, contexto: Record<string, unknown>, pasosPrevios = 0) {
  const onPaso = vi.fn(async (_p: PasoEjecutado) => {});
  return {
    onPaso,
    r: ejecutarSegmento(
      { grafo, desdeNodo, contexto, leadId: "l1", runId: "r1", pasosPrevios, maxPasos: 50 },
      { registro, ahora: () => AHORA, onPaso },
    ),
  };
}

describe("ejecutor — nodo que espera una opción", () => {
  it("corta después de mandar, reanudando en el mismo nodo con la espera en el contexto", async () => {
    mandar.mockClear();
    const { r, onPaso } = correr("t", { previo: 1 });
    expect(await r).toEqual({
      tipo: "espera",
      nodoId: "b",
      hasta: HASTA,
      reanudarEn: "b",
      contexto: { previo: 1, [CLAVE_ESPERA_OPCION]: { nodoId: "b", respondeA: "wamid.OUT" } },
      esperaOpcion: { respondeA: "wamid.OUT" },
    });
    expect(mandar).toHaveBeenCalledOnce();
    // El paso del envío deja el mensaje y hasta cuándo espera.
    expect(onPaso.mock.calls[1]![0]).toMatchObject({
      nodoId: "b",
      salida: {
        mensaje_id: "m1",
        hasta: HASTA.toISOString(),
        esperando: "respuesta_interactiva",
      },
    });
  });

  it("al reanudar con la opción elegida sale por su línea, sin volver a mandar", async () => {
    mandar.mockClear();
    const contexto = conOpcionElegida(marcarEsperaDeOpcion("b", "wamid.OUT"), {
      id: "si",
      titulo: "Sí",
    });
    const { r, onPaso } = correr("b", contexto, 2);
    expect(await r).toEqual({ tipo: "fin" });
    expect(mandar).not.toHaveBeenCalled();
    expect(onPaso.mock.calls.map((c) => c[0].nodoId)).toEqual(["b", "si"]);
  });

  it("al reanudar sin respuesta sale por «sin respuesta»", async () => {
    const { r, onPaso } = correr("b", marcarEsperaDeOpcion("b", "wamid.OUT"), 2);
    expect(await r).toEqual({ tipo: "fin" });
    expect(onPaso.mock.calls.map((c) => c[0].nodoId)).toEqual(["b", "nada"]);
  });
});
