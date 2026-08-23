import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { ejecutarSegmento } from "@/server/services/workflows/ejecutor.service";
import type { PasoEjecutado } from "@/server/services/workflows/ejecutor.service";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import type { Grafo } from "@/types/workflows";

const AHORA = new Date("2026-08-22T10:00:00Z");

function grafoLineal(): Grafo {
  return {
    nodos: [
      { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
      { id: "a", tipo: "accion", config: { accion: "marcar" }, posicion: { x: 0, y: 0 } },
      { id: "w", tipo: "espera", config: { minutos: 60 }, posicion: { x: 0, y: 0 } },
      { id: "f", tipo: "fin", config: {}, posicion: { x: 0, y: 0 } },
    ],
    aristas: [
      { desde: "d", hasta: "a", puerto: "salida" },
      { desde: "a", hasta: "w", puerto: "salida" },
      { desde: "w", hasta: "f", puerto: "salida" },
    ],
  };
}

const deps = (
  registro = crearRegistro({ marcar: async () => ({ puerto: "salida" as const }) }),
) => ({
  registro,
  ahora: () => AHORA,
  onPaso: vi.fn(async (_paso: PasoEjecutado) => {}),
});

describe("ejecutarSegmento", () => {
  it("corre inline hasta la espera y devuelve cuando reanudar", async () => {
    const d = deps();
    const r = await ejecutarSegmento(
      {
        grafo: grafoLineal(),
        desdeNodo: "d",
        contexto: {},
        leadId: "l1",
        runId: "r1",
        pasosPrevios: 0,
        maxPasos: 500,
      },
      d,
    );
    expect(r).toEqual({
      tipo: "espera",
      nodoId: "w",
      hasta: new Date("2026-08-22T11:00:00Z"),
      reanudarEn: "f",
      contexto: {},
    });
    // d, a, w: la espera tambien es un paso.
    expect(d.onPaso).toHaveBeenCalledTimes(3);
  });

  it("el contexto que agrega una accion viaja en el resultado de espera", async () => {
    // Task 10 (wiring a Inngest) necesita el contexto final para persistir
    // `workflow_runs.contexto` en `runs.esperar()`: sin este campo, el
    // segmento siguiente arrancaria con el contexto de ANTES de esta corrida.
    const d = deps(
      crearRegistro({ marcar: async () => ({ puerto: "salida" as const, contexto: { x: 1 } }) }),
    );
    const r = await ejecutarSegmento(
      {
        grafo: grafoLineal(),
        desdeNodo: "d",
        contexto: { y: 2 },
        leadId: "l1",
        runId: "r1",
        pasosPrevios: 0,
        maxPasos: 500,
      },
      d,
    );
    expect(r).toMatchObject({ tipo: "espera", contexto: { x: 1, y: 2 } });
  });

  it("reanudar despues de la espera llega al fin", async () => {
    const d = deps();
    const r = await ejecutarSegmento(
      {
        grafo: grafoLineal(),
        desdeNodo: "f",
        contexto: {},
        leadId: "l1",
        runId: "r1",
        pasosPrevios: 3,
        maxPasos: 500,
      },
      d,
    );
    expect(r).toEqual({ tipo: "fin" });
  });

  it("el orden de los pasos continua desde pasosPrevios, sin saltos", async () => {
    // Mutante que este test mata: computar `orden` como una constante
    // `pasosPrevios + 1` en vez de incrementar por nodo. Con esa mutacion los
    // 5 tests originales seguian en verde porque ninguno miraba la secuencia.
    const d = deps();
    const r = await ejecutarSegmento(
      {
        grafo: grafoLineal(),
        desdeNodo: "d",
        contexto: {},
        leadId: "l1",
        runId: "r1",
        pasosPrevios: 7,
        maxPasos: 500,
      },
      d,
    );
    expect(r.tipo).toBe("espera");
    const ordenes = d.onPaso.mock.calls.map(([paso]) => paso.orden);
    expect(ordenes).toEqual([8, 9, 10]);
  });

  it("el tope de pasos se chequea ANTES de ejecutar el nodo", async () => {
    const marcar = vi.fn(async () => ({ puerto: "salida" as const }));
    const d = deps(crearRegistro({ marcar }));
    const r = await ejecutarSegmento(
      {
        grafo: grafoLineal(),
        desdeNodo: "a",
        contexto: {},
        leadId: "l1",
        runId: "r1",
        pasosPrevios: 500,
        maxPasos: 500,
      },
      d,
    );
    expect(r).toMatchObject({ tipo: "fallado", motivo: "tope_pasos", retriable: false });
    // Lo que importa: la accion NO se ejecuto. Chequear despues manda el
    // mensaje 501 y recien ahi se entera.
    expect(marcar).not.toHaveBeenCalled();
  });

  it("una condicion mal configurada falla con motivo, no explota", async () => {
    const conCondicionRota: Grafo = {
      nodos: [
        { id: "c", tipo: "condicion", config: { campo: "inventado" }, posicion: { x: 0, y: 0 } },
        { id: "f", tipo: "fin", config: {}, posicion: { x: 0, y: 0 } },
      ],
      aristas: [
        { desde: "c", hasta: "f", puerto: "verdadero" },
        { desde: "c", hasta: "f", puerto: "falso" },
      ],
    };
    const r = await ejecutarSegmento(
      {
        grafo: conCondicionRota,
        desdeNodo: "c",
        contexto: {},
        leadId: "l1",
        runId: "r1",
        pasosPrevios: 0,
        maxPasos: 500,
      },
      deps(),
    );
    expect(r).toMatchObject({
      tipo: "fallado",
      nodoId: "c",
      motivo: "condicion_invalida",
      retriable: false,
    });
    expect((r as { error: string }).error).toContain("mal configurada");
  });

  it("una accion que tira deja la corrida fallada con el nodo, y un error generico es reintentable", async () => {
    const d = deps(
      crearRegistro({
        marcar: async () => {
          throw new Error("boom");
        },
      }),
    );
    const r = await ejecutarSegmento(
      {
        grafo: grafoLineal(),
        desdeNodo: "a",
        contexto: {},
        leadId: "l1",
        runId: "r1",
        pasosPrevios: 0,
        maxPasos: 500,
      },
      d,
    );
    // Un Error comun no es un DomainError no-reintentable: por defecto se
    // asume transitorio y se deja reintentar.
    expect(r).toMatchObject({
      tipo: "fallado",
      nodoId: "a",
      motivo: "accion_fallo",
      retriable: true,
    });
  });

  it("una accion que tira un DomainError no-reintentable marca retriable en false", async () => {
    const d = deps(
      crearRegistro({
        marcar: async () => {
          throw new ValidationError("telefono invalido", "telefono");
        },
      }),
    );
    const r = await ejecutarSegmento(
      {
        grafo: grafoLineal(),
        desdeNodo: "a",
        contexto: {},
        leadId: "l1",
        runId: "r1",
        pasosPrevios: 0,
        maxPasos: 500,
      },
      d,
    );
    expect(r).toMatchObject({
      tipo: "fallado",
      nodoId: "a",
      motivo: "accion_fallo",
      retriable: false,
    });
  });

  it("un puerto sin arista conectada falla en vez de reportar un fin silencioso", async () => {
    // "a" termina en "salida" pero esa arista no existe: sin el chequeo en
    // cada sitio, el ejecutor caeria fuera del while y devolveria { tipo:
    // "fin" }, reportando un grafo roto como una corrida exitosa.
    const grafoRoto: Grafo = {
      nodos: [
        { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
        { id: "a", tipo: "accion", config: { accion: "marcar" }, posicion: { x: 0, y: 0 } },
      ],
      aristas: [{ desde: "d", hasta: "a", puerto: "salida" }],
    };
    const r = await ejecutarSegmento(
      {
        grafo: grafoRoto,
        desdeNodo: "d",
        contexto: {},
        leadId: "l1",
        runId: "r1",
        pasosPrevios: 0,
        maxPasos: 500,
      },
      deps(),
    );
    expect(r).toMatchObject({
      tipo: "fallado",
      nodoId: "a",
      motivo: "grafo_invalido",
      retriable: false,
    });
  });
});
