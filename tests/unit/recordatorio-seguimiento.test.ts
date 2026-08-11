import { beforeEach, describe, expect, test, vi } from "vitest";
import { recordatorioSeguimientoHandler } from "@/inngest/functions/recordatorio-seguimiento";
import { InMemorySessionRecordatoriosRepository } from "@/server/repositories/session-recordatorios.repo";
import type { SessionRecordatorio, UUID } from "@/types/entities";

const sesion: UUID = "00000000-0000-0000-0000-0000000000a1";
const FECHA = new Date("2026-08-13T15:00:00.000Z");

describe("recordatorioSeguimientoHandler", () => {
  let recordatorios: InMemorySessionRecordatoriosRepository;

  beforeEach(() => {
    recordatorios = new InMemorySessionRecordatoriosRepository();
  });

  async function programar(nota = "dijo que lo pensaba"): Promise<SessionRecordatorio> {
    return recordatorios.create({
      lead_session_id: sesion,
      recordar_at: FECHA,
      nota,
      creado_por: null,
    });
  }

  test("al despertarse marca el recordatorio como avisado", async () => {
    const r = await programar();

    const res = await recordatorioSeguimientoHandler(
      { recordatorioId: r.id, leadSessionId: sesion, recordarAt: FECHA },
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
      { recordatorioId: r.id, leadSessionId: sesion, recordarAt: FECHA },
      { recordatorios },
    );

    expect(res.mensajeAlCliente).toBe(false);
  });

  test("con la puerta abierta sí llama al saliente, y con los ids de la sesión", async () => {
    const r = await programar();
    const avisarAlCliente = vi.fn(async () => {});

    const res = await recordatorioSeguimientoHandler(
      { recordatorioId: r.id, leadSessionId: sesion, recordarAt: FECHA },
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
      { recordatorioId: r.id, leadSessionId: sesion, recordarAt: FECHA },
      { recordatorios },
    );

    expect(res).toEqual({ resultado: "sin-efecto", mensajeAlCliente: false });
  });

  test("un cancelado no dispara el saliente ni con la puerta abierta", async () => {
    const r = await programar();
    await recordatorios.cancelar(r.id, "respondio");
    const avisarAlCliente = vi.fn(async () => {});

    await recordatorioSeguimientoHandler(
      { recordatorioId: r.id, leadSessionId: sesion, recordarAt: FECHA },
      { recordatorios, avisarAlCliente },
    );

    expect(avisarAlCliente).not.toHaveBeenCalled();
  });

  test("replay: correr el handler dos veces avisa una sola", async () => {
    const r = await programar();

    const primero = await recordatorioSeguimientoHandler(
      { recordatorioId: r.id, leadSessionId: sesion, recordarAt: FECHA },
      { recordatorios },
    );
    const segundo = await recordatorioSeguimientoHandler(
      { recordatorioId: r.id, leadSessionId: sesion, recordarAt: FECHA },
      { recordatorios },
    );

    expect(primero.resultado).toBe("avisado");
    expect(segundo.resultado).toBe("sin-efecto");
  });

  test("una fila que ya no existe —sesión purgada— no revienta", async () => {
    const res = await recordatorioSeguimientoHandler(
      {
        recordatorioId: "00000000-0000-0000-0000-00000000dead",
        leadSessionId: sesion,
        recordarAt: FECHA,
      },
      { recordatorios },
    );
    expect(res.resultado).toBe("sin-efecto");
  });

  /**
   * El riesgo real de reprogramar: reprogramar NO cancela la fila, así que el
   * workflow que ya estaba durmiendo se despierta con ella todavía `pendiente`.
   * Sin la comparación de fecha avisaría a la hora vieja, que es exactamente lo
   * que el vendedor acaba de decir que no quiere.
   */
  describe("reprogramado mientras dormía", () => {
    const MAS_TARDE = new Date("2026-08-20T15:00:00.000Z");

    test("el aviso viejo se despierta y no avisa: la fila ya tiene otra fecha", async () => {
      const r = await programar();
      await recordatorios.reprogramar(r.id, MAS_TARDE);

      const res = await recordatorioSeguimientoHandler(
        { recordatorioId: r.id, leadSessionId: sesion, recordarAt: FECHA },
        { recordatorios },
      );

      expect(res.resultado).toBe("sin-efecto");
      // Y sobre todo: la cita sigue viva esperando la fecha nueva.
      const fila = await recordatorios.findById(r.id);
      expect(fila?.estado).toBe("pendiente");
      expect(fila?.recordar_at).toEqual(MAS_TARDE);
    });

    test("el aviso nuevo sí avisa: arrancó con la fecha que quedó guardada", async () => {
      const r = await programar();
      await recordatorios.reprogramar(r.id, MAS_TARDE);

      const res = await recordatorioSeguimientoHandler(
        { recordatorioId: r.id, leadSessionId: sesion, recordarAt: MAS_TARDE },
        { recordatorios },
      );

      expect(res.resultado).toBe("avisado");
    });

    test("adelantarlo tampoco duplica: el viejo llega después y ya está avisado", async () => {
      const r = await programar();
      const ANTES = new Date("2026-08-12T15:00:00.000Z");
      await recordatorios.reprogramar(r.id, ANTES);

      const nuevo = await recordatorioSeguimientoHandler(
        { recordatorioId: r.id, leadSessionId: sesion, recordarAt: ANTES },
        { recordatorios },
      );
      const viejo = await recordatorioSeguimientoHandler(
        { recordatorioId: r.id, leadSessionId: sesion, recordarAt: FECHA },
        { recordatorios },
      );

      expect(nuevo.resultado).toBe("avisado");
      expect(viejo.resultado).toBe("sin-efecto");
    });

    test("posponer uno ya avisado lo devuelve a pendiente y apaga el chip", async () => {
      const r = await programar();
      await recordatorioSeguimientoHandler(
        { recordatorioId: r.id, leadSessionId: sesion, recordarAt: FECHA },
        { recordatorios },
      );

      await recordatorios.reprogramar(r.id, MAS_TARDE);

      const fila = await recordatorios.findById(r.id);
      expect(fila?.estado).toBe("pendiente");
      expect(fila?.avisado_at).toBeNull();
      // `listPorAvisar` es lo que enciende el motivo `seguimiento` del triage:
      // si el sello de avisado sobreviviera, la conversación seguiría arriba en
      // el Inbox después de posponerla.
      expect(await recordatorios.listPorAvisar(new Date("2026-08-14T00:00:00.000Z"))).toEqual([]);
    });
  });
});
