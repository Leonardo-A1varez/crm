import { describe, expect, it, vi } from "vitest";
import { ejecutarSegmento, type PasoEjecutado } from "@/server/services/workflows/ejecutor.service";
import type { RegistroDeAcciones } from "@/server/services/workflows/acciones/registro";
import { puertoDeCaso, type Grafo, type Nodo, type NodoTipo } from "@/types/workflows";

/**
 * El motor con "Según el valor" e "Ir a": los dos son control de flujo que
 * resuelve el ejecutor, sin pasar por el registro de acciones.
 */

const AHORA = new Date("2026-09-26T12:00:00Z");

function nodo(id: string, tipo: NodoTipo, config: Record<string, unknown> = {}): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: 0 } };
}

function registroQueAnota(): RegistroDeAcciones & { corridos: string[] } {
  const corridos: string[] = [];
  return {
    corridos,
    soporta: () => true,
    async ejecutar(n) {
      corridos.push(n.id);
      return { puerto: "salida" };
    },
  };
}

function correr(
  grafo: Grafo,
  opciones: {
    contexto?: Record<string, unknown>;
    maxPasos?: number;
    cargar?: (c: { campos: ReadonlySet<string> }) => Promise<Record<string, unknown>>;
  } = {},
) {
  const registro = registroQueAnota();
  const pasos: PasoEjecutado[] = [];
  const resultado = ejecutarSegmento(
    {
      grafo,
      desdeNodo: grafo.nodos[0]!.id,
      contexto: opciones.contexto ?? {},
      leadId: "l1",
      leadSessionId: "s1",
      runId: "r1",
      pasosPrevios: 0,
      maxPasos: opciones.maxPasos ?? 50,
    },
    {
      registro,
      ahora: () => AHORA,
      onPaso: async (p) => {
        pasos.push(p);
      },
      ...(opciones.cargar
        ? { camposVivos: { cargar: opciones.cargar, zona: async () => "America/Guayaquil" } }
        : {}),
    },
  );
  return { resultado, registro, pasos };
}

const CASOS = [
  { id: "wa", valor: "wa" },
  { id: "ig", valor: "ig" },
];

function grafoSwitch(campo = "lead.canal", casos = CASOS): Grafo {
  return {
    nodos: [
      nodo("t", "trigger_mensaje"),
      nodo("s", "logica_switch", { campo, casos }),
      nodo("porWa", "msg_texto", { mensaje: "wa" }),
      nodo("porIg", "msg_texto", { mensaje: "ig" }),
      nodo("porOtro", "msg_texto", { mensaje: "otro" }),
      nodo("fin", "logica_detener"),
    ],
    aristas: [
      { desde: "t", hasta: "s", puerto: "salida" },
      { desde: "s", hasta: "porWa", puerto: puertoDeCaso(casos[0]!.id) },
      { desde: "s", hasta: "porIg", puerto: puertoDeCaso(casos[1]!.id) },
      { desde: "s", hasta: "porOtro", puerto: "otro" },
      { desde: "porWa", hasta: "fin", puerto: "salida" },
      { desde: "porIg", hasta: "fin", puerto: "salida" },
      { desde: "porOtro", hasta: "fin", puerto: "salida" },
    ],
  };
}

describe("Según el valor en el motor", () => {
  it("sigue por el caso cuyo valor coincide", async () => {
    const { resultado, registro, pasos } = correr(grafoSwitch(), {
      contexto: { lead: { canal: "ig" } },
    });
    expect(await resultado).toEqual({ tipo: "fin" });
    expect(registro.corridos).toEqual(["porIg"]);
    // El paso del switch dice qué caso tomó, para el historial.
    expect(pasos.find((p) => p.nodoId === "s")!.salida).toEqual({ caso: "ig", valor: "ig" });
  });

  it("sin coincidencia sigue por «Otro»", async () => {
    const { resultado, registro, pasos } = correr(grafoSwitch(), {
      contexto: { lead: { canal: "fb" } },
    });
    expect(await resultado).toEqual({ tipo: "fin" });
    expect(registro.corridos).toEqual(["porOtro"]);
    expect(pasos.find((p) => p.nodoId === "s")!.salida).toEqual({ caso: null });
  });

  it("un campo ausente también va por «Otro»: no se inventa el dato", async () => {
    const { resultado, registro } = correr(grafoSwitch(), { contexto: {} });
    await resultado;
    expect(registro.corridos).toEqual(["porOtro"]);
  });

  it("compara con el mismo evaluador que la condición: `es` exacto", async () => {
    const { resultado, registro } = correr(
      grafoSwitch("vehiculo.marca", [
        { id: "a", valor: "Chevrolet" },
        { id: "b", valor: "Kia" },
      ]),
      { cargar: async () => ({ vehiculo: { marca: "chevrolet" } }) },
    );
    await resultado;
    expect(registro.corridos).toEqual(["porOtro"]);
  });

  it("un campo vivo se lee de la base al llegar, igual que en la condición", async () => {
    const cargar = vi.fn(async (_c: { campos: ReadonlySet<string> }) => ({
      vehiculo: { marca: "Kia" },
    }));
    const { resultado, registro } = correr(
      grafoSwitch("vehiculo.marca", [
        { id: "a", valor: "Chevrolet" },
        { id: "b", valor: "Kia" },
      ]),
      { cargar },
    );
    await resultado;
    expect(registro.corridos).toEqual(["porIg"]);
    expect(cargar).toHaveBeenCalledTimes(1);
    expect([...cargar.mock.calls[0]![0].campos]).toEqual(["vehiculo.marca"]);
  });

  it("una config inválida falla la corrida con el motivo, sin elegir rama", async () => {
    const { resultado, registro } = correr(grafoSwitch("sesion.precio_cotizado"), {
      contexto: { sesion: { precio_cotizado: 10 } },
    });
    const r = await resultado;
    expect(r).toMatchObject({ tipo: "fallado", nodoId: "s", motivo: "condicion_invalida" });
    expect(registro.corridos).toEqual([]);
  });
});

describe("Ir a en el motor", () => {
  it("salta al destino y sigue desde ahí", async () => {
    const grafo: Grafo = {
      nodos: [
        nodo("t", "trigger_mensaje"),
        nodo("g", "logica_goto", { nodoDestino: "b" }),
        nodo("a", "msg_texto", { mensaje: "a" }),
        nodo("b", "msg_texto", { mensaje: "b" }),
        nodo("fin", "logica_detener"),
      ],
      aristas: [
        { desde: "t", hasta: "g", puerto: "salida" },
        { desde: "a", hasta: "fin", puerto: "salida" },
        { desde: "b", hasta: "fin", puerto: "salida" },
      ],
    };
    const { resultado, registro, pasos } = correr(grafo);
    expect(await resultado).toEqual({ tipo: "fin" });
    expect(registro.corridos).toEqual(["b"]);
    expect(pasos.map((p) => p.nodoId)).toEqual(["t", "g", "b", "fin"]);
    expect(pasos[1]!.salida).toEqual({ destino: "b" });
  });

  it("un destino que no existe falla la corrida como grafo inválido", async () => {
    const grafo: Grafo = {
      nodos: [nodo("t", "trigger_mensaje"), nodo("g", "logica_goto", { nodoDestino: "nada" })],
      aristas: [{ desde: "t", hasta: "g", puerto: "salida" }],
    };
    const { resultado, pasos } = correr(grafo);
    expect(await resultado).toMatchObject({
      tipo: "fallado",
      nodoId: "g",
      motivo: "grafo_invalido",
      retriable: false,
    });
    expect(pasos.at(-1)).toMatchObject({ nodoId: "g", error: expect.stringContaining("nada") });
  });

  it("un bucle que el validador habría rechazado lo corta igual el tope de pasos", async () => {
    // Guardado sin validar: g -> x -> g sin espera.
    const grafo: Grafo = {
      nodos: [
        nodo("t", "trigger_mensaje"),
        nodo("x", "msg_texto", { mensaje: "x" }),
        nodo("g", "logica_goto", { nodoDestino: "x" }),
      ],
      aristas: [
        { desde: "t", hasta: "x", puerto: "salida" },
        { desde: "x", hasta: "g", puerto: "salida" },
      ],
    };
    const { resultado, registro } = correr(grafo, { maxPasos: 9 });
    expect(await resultado).toMatchObject({ tipo: "fallado", motivo: "tope_pasos" });
    expect(registro.corridos).toEqual(["x", "x", "x", "x"]);
  });
});
