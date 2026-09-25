import { describe, expect, test, vi } from "vitest";
import {
  MAX_LOTES_POR_CORRIDA,
  drenarDifusionesHandler,
  type PasosDrenado,
} from "@/inngest/functions/drenar-difusiones";
import type { MotorDifusionService, ResultadoLote } from "@/server/services/difusion/motor.service";

const D = "0b4a6f7e-1a2b-4c3d-8e9f-000000000001";

function pasos() {
  const nombres: string[] = [];
  const dormidas: { nombre: string; ms: number }[] = [];
  const step: PasosDrenado = {
    run: async (nombre, fn) => {
      nombres.push(nombre);
      return fn();
    },
    sleep: async (nombre, ms) => {
      dormidas.push({ nombre, ms });
    },
  };
  return { step, nombres, dormidas };
}

function motor(resultados: ResultadoLote[], verificar = true) {
  const cola = [...resultados];
  return {
    drenarLote: vi.fn(async () => cola.shift() ?? ({ tipo: "sin_trabajo" } as const)),
    verificarPlan: vi.fn(async () => verificar),
    aplicarEstadoWebhook: vi.fn(async () => false),
  } satisfies MotorDifusionService;
}

const ENVIADO: ResultadoLote = {
  tipo: "enviado",
  difusionId: D,
  aceptados: 25,
  fallidos: 0,
  excluidos: 0,
  diferidos: 0,
};

describe("drenarDifusionesHandler", () => {
  test("drena lote por lote, cada uno en su step, hasta que no queda trabajo", async () => {
    const m = motor([ENVIADO, ENVIADO]);
    const { step, nombres } = pasos();

    const r = await drenarDifusionesHandler({ tick: "2026-09-25T15:00" }, { motor: m }, step);

    expect(r).toEqual({ lotes: 3, aceptados: 50, fin: "sin_trabajo" });
    expect(nombres).toEqual([
      "drenar-difusiones-2026-09-25T15:00-lote-0",
      "drenar-difusiones-2026-09-25T15:00-lote-1",
      "drenar-difusiones-2026-09-25T15:00-lote-2",
    ]);
  });

  test("con el evento de programada verifica el plan antes del primer lote", async () => {
    const m = motor([ENVIADO]);
    const { step, nombres } = pasos();
    const plan = { difusionId: D, audienciaInicial: 30, destinatarios: 25 };

    await drenarDifusionesHandler({ tick: "t", plan }, { motor: m }, step);

    expect(m.verificarPlan).toHaveBeenCalledWith(plan);
    expect(nombres[0]).toBe(`drenar-difusiones-t-verificar-${D}`);
  });

  test("sin cupo corta la corrida: la retoma el cron", async () => {
    const m = motor([{ tipo: "esperando_cupo", difusionId: D }, ENVIADO]);
    const { step } = pasos();
    const r = await drenarDifusionesHandler({ tick: "t" }, { motor: m }, step);
    expect(r.fin).toBe("esperando_cupo");
    expect(m.drenarLote).toHaveBeenCalledTimes(1);
  });

  test("si Meta pide bajar el ritmo, duerme antes del lote siguiente", async () => {
    const m = motor([{ tipo: "ritmo", difusionId: D }, ENVIADO]);
    const { step, dormidas } = pasos();
    await drenarDifusionesHandler({ tick: "t" }, { motor: m }, step);
    expect(dormidas).toEqual([{ nombre: "drenar-difusiones-t-ritmo-0", ms: 5_000 }]);
  });

  test("un lote que sólo difirió por los 6 s espera antes de reintentar", async () => {
    const m = motor([{ ...ENVIADO, aceptados: 0, diferidos: 3 }, ENVIADO]);
    const { step, dormidas } = pasos();
    await drenarDifusionesHandler({ tick: "t" }, { motor: m }, step);
    expect(dormidas.map((d) => d.ms)).toEqual([6_000]);
  });

  test("una corrida tiene un tope de lotes: lo que sobra lo toma la siguiente", async () => {
    const m = motor(Array.from({ length: MAX_LOTES_POR_CORRIDA + 5 }, () => ENVIADO));
    const { step } = pasos();
    const r = await drenarDifusionesHandler({ tick: "t" }, { motor: m }, step);
    expect(r.lotes).toBe(MAX_LOTES_POR_CORRIDA);
    expect(r.fin).toBe("tope_de_lotes");
  });
});
