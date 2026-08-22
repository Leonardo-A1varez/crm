import { describe, expect, it, vi } from "vitest";
import { ejecutarSegmento } from "@/server/services/workflows/ejecutor.service";
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
  onPaso: vi.fn(async () => {}),
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
    });
    // d, a, w: la espera tambien es un paso.
    expect(d.onPaso).toHaveBeenCalledTimes(3);
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
    expect(r.tipo).toBe("fallado");
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
    expect(r).toMatchObject({ tipo: "fallado", nodoId: "c" });
    expect((r as { error: string }).error).toContain("mal configurada");
  });

  it("una accion que tira deja la corrida fallada con el nodo", async () => {
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
    expect(r).toMatchObject({ tipo: "fallado", nodoId: "a" });
  });
});
