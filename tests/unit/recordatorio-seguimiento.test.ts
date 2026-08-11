import { beforeEach, describe, expect, test, vi } from "vitest";
import { recordatorioSeguimientoHandler } from "@/inngest/functions/recordatorio-seguimiento";
import { InMemorySessionRecordatoriosRepository } from "@/server/repositories/session-recordatorios.repo";
import type { SessionRecordatorio, UUID } from "@/types/entities";

const sesion: UUID = "00000000-0000-0000-0000-0000000000a1";

describe("recordatorioSeguimientoHandler", () => {
  let recordatorios: InMemorySessionRecordatoriosRepository;

  beforeEach(() => {
    recordatorios = new InMemorySessionRecordatoriosRepository();
  });

  async function programar(nota = "dijo que lo pensaba"): Promise<SessionRecordatorio> {
    return recordatorios.create({
      lead_session_id: sesion,
      recordar_at: new Date("2026-08-13T15:00:00.000Z"),
      nota,
      creado_por: null,
    });
  }

  test("al despertarse marca el recordatorio como avisado", async () => {
    const r = await programar();

    const res = await recordatorioSeguimientoHandler(
      { recordatorioId: r.id, leadSessionId: sesion },
      { recordatorios },
    );

    expect(res.resultado).toBe("avisado");
    expect((await recordatorios.findById(r.id))?.estado).toBe("avisado");
  });

  test("NO le manda nada al cliente: ese es el default deliberado", async () => {
    // Es la decisión de producto más cara de este workflow. Si alguien wirea
    // `avisarAlCliente` sin querer, este test se cae.
    const r = await programar();

    const res = await recordatorioSeguimientoHandler(
      { recordatorioId: r.id, leadSessionId: sesion },
      { recordatorios },
    );

    expect(res.mensajeAlCliente).toBe(false);
  });

  test("con la puerta abierta sí llama al saliente, y con los ids de la sesión", async () => {
    const r = await programar();
    const avisarAlCliente = vi.fn(async () => {});

    const res = await recordatorioSeguimientoHandler(
      { recordatorioId: r.id, leadSessionId: sesion },
      { recordatorios, avisarAlCliente },
    );

    expect(res.mensajeAlCliente).toBe(true);
    expect(avisarAlCliente).toHaveBeenCalledWith({
      recordatorioId: r.id,
      leadSessionId: sesion,
    });
  });

  test("si lo cancelaron mientras dormía, no avisa nada", async () => {
    const r = await programar();
    await recordatorios.cancelar(r.id, "respondio");

    const res = await recordatorioSeguimientoHandler(
      { recordatorioId: r.id, leadSessionId: sesion },
      { recordatorios },
    );

    expect(res).toEqual({ resultado: "sin-efecto", mensajeAlCliente: false });
  });

  test("un cancelado no dispara el saliente ni con la puerta abierta", async () => {
    const r = await programar();
    await recordatorios.cancelar(r.id, "respondio");
    const avisarAlCliente = vi.fn(async () => {});

    await recordatorioSeguimientoHandler(
      { recordatorioId: r.id, leadSessionId: sesion },
      { recordatorios, avisarAlCliente },
    );

    expect(avisarAlCliente).not.toHaveBeenCalled();
  });

  test("replay: correr el handler dos veces avisa una sola", async () => {
    const r = await programar();

    const primero = await recordatorioSeguimientoHandler(
      { recordatorioId: r.id, leadSessionId: sesion },
      { recordatorios },
    );
    const segundo = await recordatorioSeguimientoHandler(
      { recordatorioId: r.id, leadSessionId: sesion },
      { recordatorios },
    );

    expect(primero.resultado).toBe("avisado");
    expect(segundo.resultado).toBe("sin-efecto");
  });

  test("una fila que ya no existe —sesión purgada— no revienta", async () => {
    const res = await recordatorioSeguimientoHandler(
      { recordatorioId: "00000000-0000-0000-0000-00000000dead", leadSessionId: sesion },
      { recordatorios },
    );
    expect(res.resultado).toBe("sin-efecto");
  });
});
