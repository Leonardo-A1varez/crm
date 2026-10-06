import { describe, expect, it, vi } from "vitest";
import {
  claveDeLote,
  makeRecalcularCompatibilidadFn,
  recalcularCompatibilidadHandler,
} from "@/inngest/functions/recalcular-compatibilidad.cron";
import type {
  RecalcularCompatibilidadResultado,
  RecalcularCompatibilidadService,
} from "@/server/services/catalog/recalcular-compatibilidad.service";

const TS = Date.UTC(2026, 9, 5, 12, 7, 31);

function resultado(leidos: number): RecalcularCompatibilidadResultado {
  return { leidos, actualizados: leidos, sinVehiculo: 0, descartados: 0 };
}

/** Un step.run que recuerda por nombre, como hace Inngest al reintentar una corrida. */
function pasoConMemoria() {
  const memoria = new Map<string, unknown>();
  return {
    memoria,
    run: async <T>(nombre: string, fn: () => Promise<T>): Promise<T> => {
      if (memoria.has(nombre)) return memoria.get(nombre) as T;
      const valor = await fn();
      memoria.set(nombre, valor);
      return valor;
    },
  };
}

describe("claveDeLote", () => {
  it("lleva nombre de la función, día, ventana de 5 minutos y número de lote", () => {
    expect(claveDeLote(new Date(TS), 0)).toBe("recalcular-compatibilidad-2026-10-05-1205-lote0");
    expect(claveDeLote(new Date(TS), 2)).toBe("recalcular-compatibilidad-2026-10-05-1205-lote2");
  });

  it("es estable dentro de la misma ventana y cambia en la siguiente", () => {
    const a = claveDeLote(new Date(Date.UTC(2026, 9, 5, 12, 5, 0)), 0);
    const b = claveDeLote(new Date(Date.UTC(2026, 9, 5, 12, 9, 59)), 0);
    const c = claveDeLote(new Date(Date.UTC(2026, 9, 5, 12, 10, 0)), 0);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});

describe("recalcularCompatibilidadHandler", () => {
  it("termina en el primer lote si trae menos del límite", async () => {
    const recalcular = vi.fn().mockResolvedValue(resultado(3));
    const servicio: RecalcularCompatibilidadService = { recalcular };

    const r = await recalcularCompatibilidadHandler(
      { ts: TS },
      { servicio, limiteLote: 10, maxLotes: 4 },
      pasoConMemoria(),
    );

    expect(recalcular).toHaveBeenCalledTimes(1);
    expect(recalcular).toHaveBeenCalledWith(10);
    expect(r).toMatchObject({ lotes: 1, leidos: 3, actualizados: 3 });
  });

  it("sigue con otro lote mientras el anterior venga lleno, hasta el máximo", async () => {
    const recalcular = vi.fn().mockResolvedValue(resultado(10));
    const r = await recalcularCompatibilidadHandler(
      { ts: TS },
      { servicio: { recalcular }, limiteLote: 10, maxLotes: 3 },
      pasoConMemoria(),
    );
    expect(recalcular).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ lotes: 3, leidos: 30 });
  });

  it("se detiene cuando un lote viene corto", async () => {
    const recalcular = vi
      .fn()
      .mockResolvedValueOnce(resultado(10))
      .mockResolvedValueOnce(resultado(4));
    const r = await recalcularCompatibilidadHandler(
      { ts: TS },
      { servicio: { recalcular }, limiteLote: 10, maxLotes: 5 },
      pasoConMemoria(),
    );
    expect(recalcular).toHaveBeenCalledTimes(2);
    expect(r.leidos).toBe(14);
  });

  it("reintentar la misma corrida no vuelve a traducir (replay)", async () => {
    const recalcular = vi.fn().mockResolvedValue(resultado(10));
    const paso = pasoConMemoria();
    const deps = { servicio: { recalcular }, limiteLote: 10, maxLotes: 2 };

    const primera = await recalcularCompatibilidadHandler({ ts: TS }, deps, paso);
    const llamadas = recalcular.mock.calls.length;
    const otra = await recalcularCompatibilidadHandler({ ts: TS }, deps, paso);

    expect(recalcular.mock.calls.length).toBe(llamadas);
    expect(otra).toEqual(primera);
    expect([...paso.memoria.keys()]).toEqual([
      "recalcular-compatibilidad-2026-10-05-1205-lote0",
      "recalcular-compatibilidad-2026-10-05-1205-lote1",
    ]);
  });

  it("la función de Inngest se registra con su id", () => {
    const fn = makeRecalcularCompatibilidadFn({ servicio: { recalcular: vi.fn() } });
    expect(fn.id()).toContain("recalcular-compatibilidad");
  });
});
