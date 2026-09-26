import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import {
  crearAccionActualizarCampoTwin,
  type AccionActualizarCampoTwinDeps,
} from "@/server/services/workflows/acciones/campo-twin";
import type { Nodo } from "@/types/workflows";

/**
 * "Actualizar campo del Twin": escribe un campo editable de la sesión y deja la
 * procedencia en `workflow`, en la misma operación —igual que «Cambiar
 * etapa»—. El valor admite variables.
 */

const AHORA = new Date("2026-09-26T12:00:00Z");
const entorno = {
  leadId: "l1",
  leadSessionId: "s1",
  runId: "r1",
  orden: 3,
  contexto: {},
  ahora: AHORA,
};

function nodo(config: Record<string, unknown>): Nodo {
  return { id: "c", tipo: "crm_campo", config, posicion: { x: 0, y: 0 } };
}

function puertos(sesion: Record<string, unknown> = { bloqueador: "viejo", cantidad: 1 }) {
  return {
    sessions: {
      findById: vi.fn(async (_id: string) => ({ id: "s1", current_stage: "cotizado", ...sesion })),
      aplicarExtraccion: vi.fn(async (_id: string, _patch: unknown, _marcas: unknown) => ({})),
    },
    leads: {
      findById: vi.fn(async (_id: string) => ({
        nombre: "Ana",
        telefono: "593",
        canal_origen: "wa",
      })),
    },
    users: { findById: vi.fn(async (_id: string) => null) },
  };
}

/** Los mocks devuelven filas parciales: alcanza con lo que la acción lee. */
function accionCon(p: ReturnType<typeof puertos>) {
  return crearAccionActualizarCampoTwin(p as unknown as AccionActualizarCampoTwinDeps);
}

describe("actualizar_campo_twin", () => {
  it("escribe el campo y su procedencia por workflow, con el valor anterior", async () => {
    const p = puertos();
    const accion = accionCon(p);
    const r = await accion(nodo({ campo: "bloqueador", valor: "Espera el pago" }), entorno);

    expect(p.sessions.aplicarExtraccion).toHaveBeenCalledWith(
      "s1",
      { bloqueador: "Espera el pago" },
      {
        bloqueador: {
          por: "workflow",
          at: AHORA.toISOString(),
          user_id: null,
          mensaje_origen_id: null,
          valor_anterior: "viejo",
        },
      },
    );
    // Sin el valor: la salida del paso sobrevive a la purga de la sesión.
    expect(r).toEqual({ puerto: "salida", salida: { campo: "bloqueador" } });
  });

  it("resuelve las variables antes de escribir", async () => {
    const p = puertos();
    const accion = accionCon(p);
    await accion(nodo({ campo: "consulta", valor: "Pide {{lead.nombre}}" }), entorno);
    expect(p.sessions.aplicarExtraccion.mock.calls[0]![1]).toEqual({ consulta: "Pide Ana" });
  });

  it("un campo numérico se escribe como número", async () => {
    const p = puertos();
    const accion = accionCon(p);
    await accion(nodo({ campo: "precio_cotizado", valor: "1500,5" }), entorno);
    expect(p.sessions.aplicarExtraccion.mock.calls[0]![1]).toEqual({ precio_cotizado: 1500.5 });
  });

  it("vacío borra el dato", async () => {
    const p = puertos();
    const accion = accionCon(p);
    await accion(nodo({ campo: "cantidad", valor: "" }), entorno);
    expect(p.sessions.aplicarExtraccion.mock.calls[0]![1]).toEqual({ cantidad: null });
  });

  it("un número que sale mal de una variable falla sin escribir, y no se reintenta", async () => {
    const p = puertos();
    const accion = accionCon(p);
    await expect(
      accion(nodo({ campo: "cantidad", valor: "{{lead.nombre}}" }), entorno),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(p.sessions.aplicarExtraccion).not.toHaveBeenCalled();
  });

  it("un campo que el Twin no deja editar es ValidationError", async () => {
    const p = puertos();
    const accion = accionCon(p);
    await expect(
      accion(nodo({ campo: "ia_pausada", valor: "true" }), entorno),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(p.sessions.aplicarExtraccion).not.toHaveBeenCalled();
  });

  it("sin sesión en la corrida es ValidationError: el Twin vive en la sesión", async () => {
    const p = puertos();
    const accion = accionCon(p);
    await expect(
      accion(nodo({ campo: "bloqueador", valor: "x" }), { ...entorno, leadSessionId: null }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("actualizar_campo_twin en Probar", () => {
  it("se intercepta: queda anotado como su propio efecto, no como «Cambiar etapa»", async () => {
    const { simular } = await import("@/server/services/workflows/simulador.service");
    const grafo = {
      nodos: [
        { id: "t", tipo: "trigger_manual" as const, config: {}, posicion: { x: 0, y: 0 } },
        {
          id: "c",
          tipo: "crm_campo" as const,
          config: { campo: "bloqueador", valor: "Espera el pago" },
          posicion: { x: 0, y: 0 },
        },
        { id: "f", tipo: "logica_detener" as const, config: {}, posicion: { x: 0, y: 0 } },
      ],
      aristas: [
        { desde: "t", hasta: "c", puerto: "salida" as const },
        { desde: "c", hasta: "f", puerto: "salida" as const },
      ],
    };
    const r = await simular(grafo, { maxPasos: 10, desde: AHORA });
    expect(r.desenlace).toBe("fin");
    const paso = r.pasos.find((p) => p.nodoId === "c")!;
    expect(paso.efectos.map((e) => [e.accion, e.detalle])).toEqual([
      ["actualizar_campo_twin", { campo: "bloqueador" }],
    ]);
  });
});
