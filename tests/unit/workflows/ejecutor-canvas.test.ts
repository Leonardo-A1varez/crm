import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { ejecutarSegmento } from "@/server/services/workflows/ejecutor.service";
import type { PasoEjecutado } from "@/server/services/workflows/ejecutor.service";
import {
  crearRegistro,
  type EntornoAccion,
  type RegistroDeAcciones,
} from "@/server/services/workflows/acciones/registro";
import type { Grafo, Nodo, NodoTipo, ResultadoAccion } from "@/types/workflows";

const AHORA = new Date("2026-09-13T10:00:00Z");

function nodo(id: string, tipo: NodoTipo, config: Record<string, unknown> = {}): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: 0 } };
}

/** Registro espía: registra qué nodos llegaron al registro y con qué entorno. */
function registroEspia(): RegistroDeAcciones & {
  llamadas: Array<{ nodo: Nodo; entorno: EntornoAccion }>;
} {
  const llamadas: Array<{ nodo: Nodo; entorno: EntornoAccion }> = [];
  return {
    llamadas,
    soporta: () => true,
    async ejecutar(n, entorno): Promise<ResultadoAccion> {
      llamadas.push({ nodo: n, entorno });
      return { puerto: "salida" };
    },
  };
}

function correr(
  grafo: Grafo,
  registro: RegistroDeAcciones,
  contexto: Record<string, unknown> = {},
) {
  const onPaso = vi.fn(async (_p: PasoEjecutado) => {});
  const inicio = grafo.nodos[0]!.id;
  return {
    onPaso,
    resultado: ejecutarSegmento(
      {
        grafo,
        desdeNodo: inicio,
        contexto,
        leadId: "l1",
        leadSessionId: "s1",
        runId: "r1",
        pasosPrevios: 0,
        maxPasos: 50,
      },
      { registro, ahora: () => AHORA, onPaso },
    ),
  };
}

describe("ejecutarSegmento — grafo armado en el canvas", () => {
  it("trigger_* y logica_detener son control de flujo del motor: no pasan por el registro", async () => {
    const grafo: Grafo = {
      nodos: [
        nodo("t", "trigger_mensaje"),
        nodo("tag", "crm_etiqueta_add", { tagIds: ["t1"] }),
        nodo("fin", "logica_detener"),
      ],
      aristas: [
        { desde: "t", hasta: "tag", puerto: "salida" },
        { desde: "tag", hasta: "fin", puerto: "salida" },
      ],
    };
    const registro = registroEspia();
    const { resultado, onPaso } = correr(grafo, registro);

    expect(await resultado).toEqual({ tipo: "fin" });
    expect(registro.llamadas.map((l) => l.nodo.id)).toEqual(["tag"]);
    // t, tag, fin: el trigger y el final también son pasos de la corrida.
    expect(onPaso.mock.calls.map(([p]) => p.nodoId)).toEqual(["t", "tag", "fin"]);
  });

  it("logica_condicion se evalúa en el motor contra el contexto de la corrida", async () => {
    const grafo: Grafo = {
      nodos: [
        nodo("t", "trigger_mensaje"),
        nodo("c", "logica_condicion", { campo: "lead.etapa", operador: "es", valor: "cotizado" }),
        nodo("si", "logica_detener"),
        nodo("no", "fin"),
      ],
      aristas: [
        { desde: "t", hasta: "c", puerto: "salida" },
        { desde: "c", hasta: "si", puerto: "verdadero" },
        { desde: "c", hasta: "no", puerto: "falso" },
      ],
    };
    const registro = registroEspia();
    const { resultado, onPaso } = correr(grafo, registro, { lead: { etapa: "cotizado" } });

    expect(await resultado).toEqual({ tipo: "fin" });
    expect(registro.llamadas).toHaveLength(0);
    expect(onPaso.mock.calls.map(([p]) => p.nodoId)).toEqual(["t", "c", "si"]);
  });

  it("una condición sin operador guardado usa 'es', que es lo que el panel muestra elegido", async () => {
    // `ConfigLogica` dibuja "es igual a" pero no lo escribe en la config hasta
    // que alguien toca el selector: el nodo llega con `operador` ausente.
    const grafo: Grafo = {
      nodos: [
        nodo("t", "trigger_mensaje"),
        nodo("c", "logica_condicion", { campo: "lead.etapa", valor: "cotizado" }),
        nodo("si", "logica_detener"),
        nodo("no", "fin"),
      ],
      aristas: [
        { desde: "t", hasta: "c", puerto: "salida" },
        { desde: "c", hasta: "si", puerto: "verdadero" },
        { desde: "c", hasta: "no", puerto: "falso" },
      ],
    };
    const { resultado, onPaso } = correr(grafo, registroEspia(), { lead: { etapa: "cotizado" } });

    expect(await resultado).toEqual({ tipo: "fin" });
    expect(onPaso.mock.calls.map(([p]) => p.nodoId)).toEqual(["t", "c", "si"]);
  });

  it("logica_esperar corta el segmento con duracion + unidad", async () => {
    const grafo: Grafo = {
      nodos: [
        nodo("t", "trigger_mensaje"),
        nodo("w", "logica_esperar", { duracion: 2, unidad: "dias" }),
        nodo("fin", "logica_detener"),
      ],
      aristas: [
        { desde: "t", hasta: "w", puerto: "salida" },
        { desde: "w", hasta: "fin", puerto: "salida" },
      ],
    };
    const { resultado } = correr(grafo, registroEspia());

    expect(await resultado).toEqual({
      tipo: "espera",
      nodoId: "w",
      hasta: new Date(AHORA.getTime() + 2 * 24 * 60 * 60_000),
      reanudarEn: "fin",
      contexto: {},
    });
  });

  it("logica_esperar sin config espera 1 hora, el default que muestra el panel", async () => {
    const grafo: Grafo = {
      nodos: [nodo("t", "trigger_mensaje"), nodo("w", "logica_esperar"), nodo("fin", "fin")],
      aristas: [
        { desde: "t", hasta: "w", puerto: "salida" },
        { desde: "w", hasta: "fin", puerto: "salida" },
      ],
    };
    const r = await correr(grafo, registroEspia()).resultado;
    expect(r).toMatchObject({ tipo: "espera", hasta: new Date(AHORA.getTime() + 60 * 60_000) });
  });

  // "Esperar respuesta" y "esperar evento" cortan el segmento como cualquier
  // espera: `hasta` es el tiempo máximo, y lo que las despierta antes es un
  // evento que resuelve `workflow-segmento` con `step.waitForEvent`. Así el
  // simulador y "Probar" las recorren igual que una espera de tiempo —el lead
  // no contesta durante una prueba— y ninguna espera es indefinida.
  function grafoEspera(tipo: NodoTipo, config: Record<string, unknown>): Grafo {
    return {
      nodos: [nodo("t", "trigger_mensaje"), nodo("w", tipo, config), nodo("fin", "fin")],
      aristas: [
        { desde: "t", hasta: "w", puerto: "salida" },
        { desde: "w", hasta: "fin", puerto: "salida" },
      ],
    };
  }

  it("esperar respuesta corta con su tiempo máximo y deja 'no respondió' hasta que llegue algo", async () => {
    const { resultado, onPaso } = correr(
      grafoEspera("logica_esperar_respuesta", { timeout: 2, unidadTimeout: "horas" }),
      registroEspia(),
      { sesion: { respondio: true, tiene_cotizacion: false } },
    );
    const r = await resultado;
    expect(r).toEqual({
      tipo: "espera",
      nodoId: "w",
      hasta: new Date(AHORA.getTime() + 2 * 60 * 60_000),
      reanudarEn: "fin",
      contexto: { sesion: { respondio: false, tiene_cotizacion: false } },
    });
    expect(onPaso).toHaveBeenLastCalledWith({
      nodoId: "w",
      orden: 2,
      salida: { hasta: "2026-09-13T12:00:00.000Z", esperando: "respuesta" },
      error: null,
    });
  });

  it("esperar respuesta sin config usa lo que muestra el panel: 24 horas", async () => {
    const r = await correr(grafoEspera("logica_esperar_respuesta", {}), registroEspia()).resultado;
    expect(r).toMatchObject({
      tipo: "espera",
      hasta: new Date(AHORA.getTime() + 24 * 60 * 60_000),
    });
  });

  it("esperar evento corta con su tiempo máximo (7 días por defecto)", async () => {
    const r = await correr(
      grafoEspera("logica_esperar_evento", { evento: "etiqueta_asignada" }),
      registroEspia(),
    ).resultado;
    expect(r).toMatchObject({
      tipo: "espera",
      nodoId: "w",
      hasta: new Date(AHORA.getTime() + 7 * 24 * 60 * 60_000),
      reanudarEn: "fin",
    });
  });

  it.each([
    ["un tiempo máximo en cero", "logica_esperar_respuesta", { timeout: 0 }],
    [
      "un tiempo máximo negativo",
      "logica_esperar_evento",
      { evento: "etapa_cambiada", timeoutMax: -1 },
    ],
    ["un evento sin elegir", "logica_esperar_evento", {}],
    ["un evento que nadie emite", "logica_esperar_evento", { evento: "comprobante_subido" }],
  ] as const)("%s no espera nunca: falla en voz alta", async (_caso, tipo, config) => {
    const r = await correr(grafoEspera(tipo, config), registroEspia()).resultado;
    expect(r).toMatchObject({
      tipo: "fallado",
      nodoId: "w",
      motivo: "grafo_invalido",
      retriable: false,
    });
  });

  it("la acción recibe el reloj del motor en el entorno", async () => {
    const grafo: Grafo = {
      nodos: [
        nodo("t", "trigger_mensaje"),
        nodo("m", "msg_texto", { mensaje: "hola" }),
        nodo("f", "fin"),
      ],
      aristas: [
        { desde: "t", hasta: "m", puerto: "salida" },
        { desde: "m", hasta: "f", puerto: "salida" },
      ],
    };
    const registro = registroEspia();
    await correr(grafo, registro).resultado;
    expect(registro.llamadas[0]?.entorno.ahora).toEqual(AHORA);
  });

  it("un nodo que el registro no sabe ejecutar falla con un error que nombra el tipo", async () => {
    const grafo: Grafo = {
      nodos: [nodo("t", "trigger_mensaje"), nodo("b", "msg_botones"), nodo("f", "fin")],
      aristas: [
        { desde: "t", hasta: "b", puerto: "salida" },
        { desde: "b", hasta: "f", puerto: "salida" },
      ],
    };
    const r = await correr(grafo, crearRegistro({})).resultado;
    expect(r).toMatchObject({ tipo: "fallado", nodoId: "b", retriable: false });
    expect((r as { error: string }).error).toContain("msg_botones");
  });
});

describe("ejecutarSegmento — el error de un nodo no soportado es un ValidationError", () => {
  it("crearRegistro rechaza un tipo sin handler con ValidationError (no reintentable)", async () => {
    await expect(
      crearRegistro({}).ejecutar(nodo("b", "msg_botones"), {
        leadId: "l1",
        runId: "r1",
        orden: 1,
        contexto: {},
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
