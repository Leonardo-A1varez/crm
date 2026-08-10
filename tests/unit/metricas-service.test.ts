import { describe, expect, test } from "vitest";
import { InMemoryMetricsRepository } from "@/server/repositories/metrics.repo";
import { DefaultMetricsService } from "@/server/services/metricas/default-metricas.service";
import type { FilaMensajeMetrica, FilaSesionMetrica } from "@/server/repositories/metrics.repo";

const AHORA = new Date("2026-08-10T12:00:00.000Z");

function haceDias(d: number): Date {
  return new Date(AHORA.getTime() - d * 24 * 60 * 60 * 1000);
}

function svc(sesiones: FilaSesionMetrica[] = [], mensajes: FilaMensajeMetrica[] = []) {
  return new DefaultMetricsService({
    metrics: new InMemoryMetricsRepository(sesiones, mensajes),
  });
}

function sesion(over: Partial<FilaSesionMetrica> = {}): FilaSesionMetrica {
  return {
    current_stage: "identificando",
    resultado: null,
    motivo_perdida: null,
    started_at: haceDias(1),
    ...over,
  };
}

describe("DefaultMetricsService.obtener", () => {
  test("sin datos devuelve las 6 etapas del embudo en cero", async () => {
    const m = await svc().obtener(30, AHORA);

    expect(m.totalSesiones).toBe(0);
    expect(m.embudo).toHaveLength(6);
    expect(m.embudo.every((e) => e.cantidad === 0)).toBe(true);
    expect(m.resultado).toEqual({ abiertas: 0, exito: 0, perdido: 0, porMotivo: [] });
  });

  test("la ventana recorta: lo anterior a `desde` no se cuenta", async () => {
    const m = await svc([
      sesion({ started_at: haceDias(5) }),
      sesion({ started_at: haceDias(40) }),
    ]).obtener(30, AHORA);

    expect(m.totalSesiones).toBe(1);
    expect(m.desde).toEqual(haceDias(30));
  });

  test("los desvíos se cuentan aparte del embudo", async () => {
    const m = await svc([
      sesion({ current_stage: "cotizado" }),
      sesion({ current_stage: "requiere_humano" }),
      sesion({ current_stage: "perdido" }),
    ]).obtener(30, AHORA);

    expect(m.embudo.find((e) => e.stage === "cotizado")?.cantidad).toBe(1);
    expect(m.embudo.map((e) => e.stage)).not.toContain("perdido");
    expect(m.desvios.find((d) => d.stage === "requiere_humano")?.cantidad).toBe(1);
    expect(m.desvios.find((d) => d.stage === "perdido")?.cantidad).toBe(1);
  });

  test("abiertas es el resto: ni éxito ni perdido", async () => {
    const m = await svc([
      sesion({ resultado: "exito" }),
      sesion({ resultado: "perdido", motivo_perdida: "precio" }),
      sesion(),
      sesion(),
    ]).obtener(30, AHORA);

    expect(m.resultado).toMatchObject({ exito: 1, perdido: 1, abiertas: 2 });
  });

  test("una perdida sin motivo no se inventa como 'otro'", async () => {
    const m = await svc([sesion({ resultado: "perdido", motivo_perdida: null })]).obtener(
      30,
      AHORA,
    );

    expect(m.resultado.porMotivo).toEqual([{ motivo: "Sin motivo registrado", cantidad: 1 }]);
  });

  test("los motivos salen ordenados por cantidad", async () => {
    const m = await svc([
      sesion({ resultado: "perdido", motivo_perdida: "stock" }),
      sesion({ resultado: "perdido", motivo_perdida: "precio" }),
      sesion({ resultado: "perdido", motivo_perdida: "precio" }),
    ]).obtener(30, AHORA);

    expect(m.resultado.porMotivo).toEqual([
      { motivo: "Precio", cantidad: 2 },
      { motivo: "Sin stock", cantidad: 1 },
    ]);
  });

  test("la autoría cuenta los 4 remitentes y arranca en cero", async () => {
    const m = await svc(
      [],
      [
        { sender: "lead", created_at: haceDias(1) },
        { sender: "ia", created_at: haceDias(1) },
        { sender: "ia", created_at: haceDias(2) },
        { sender: "humano", created_at: haceDias(3) },
        { sender: "ia", created_at: haceDias(45) },
      ],
    ).obtener(30, AHORA);

    expect(m.autoria).toEqual({ lead: 1, ia: 2, humano: 1, sistema: 0 });
  });
});
