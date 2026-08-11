import { beforeEach, describe, expect, test } from "vitest";
import { InMemorySessionRecordatoriosRepository } from "@/server/repositories/session-recordatorios.repo";
import type { UUID } from "@/types/entities";

const sesionA: UUID = "00000000-0000-0000-0000-0000000000a1";
const sesionB: UUID = "00000000-0000-0000-0000-0000000000b2";
const vendedor: UUID = "00000000-0000-0000-0000-0000000000c3";

const EN_DOS_DIAS = new Date("2026-08-13T15:00:00.000Z");
const AL_PROGRAMAR = new Date("2026-08-11T15:00:00.000Z");
const YA_VENCIDO = new Date("2026-08-14T09:00:00.000Z");

describe("InMemorySessionRecordatoriosRepository", () => {
  let repo: InMemorySessionRecordatoriosRepository;

  beforeEach(() => {
    repo = new InMemorySessionRecordatoriosRepository();
  });

  async function programar(sessionId: UUID = sesionA, nota = "dijo que lo pensaba") {
    return repo.create({
      lead_session_id: sessionId,
      recordar_at: EN_DOS_DIAS,
      nota,
      creado_por: vendedor,
    });
  }

  test("nace pendiente y sin sellos", async () => {
    const r = await programar();
    expect(r.estado).toBe("pendiente");
    expect(r.avisado_at).toBeNull();
    expect(r.cancelado_at).toBeNull();
    expect(r.motivo_cancelacion).toBeNull();
  });

  test("uno solo vivo por sesión", async () => {
    // Espeja el índice único parcial de la tabla. Sin esto los tests pasarían
    // con dos citas sobre la misma conversación y la DB rechazaría en prod.
    await programar();
    await expect(programar()).rejects.toThrow();
  });

  test("cancelado deja lugar para programar otro", async () => {
    const r = await programar();
    await repo.cancelar(r.id, "manual");
    await expect(programar()).resolves.toBeDefined();
  });

  test("marcarAvisado es idempotente: la segunda vez no aplica", async () => {
    const r = await programar();
    expect(await repo.marcarAvisado(r.id)).not.toBeNull();
    // El replay del step de Inngest tiene que salir por acá y no volver a
    // encender nada.
    expect(await repo.marcarAvisado(r.id)).toBeNull();
  });

  test("un recordatorio cancelado ya no se puede avisar", async () => {
    const r = await programar();
    await repo.cancelar(r.id, "respondio");
    expect(await repo.marcarAvisado(r.id)).toBeNull();
  });

  test("cancelar dos veces no es un error, es un no-op", async () => {
    const r = await programar();
    expect(await repo.cancelar(r.id, "manual")).not.toBeNull();
    expect(await repo.cancelar(r.id, "manual")).toBeNull();
  });

  test("cancelar guarda por qué se apagó", async () => {
    const r = await programar();
    const cancelado = await repo.cancelar(r.id, "respondio");
    expect(cancelado?.motivo_cancelacion).toBe("respondio");
    expect(cancelado?.cancelado_at).not.toBeNull();
  });

  test("cancelarVivosDeSesion solo toca la sesión que le pasan", async () => {
    await programar(sesionA);
    await programar(sesionB);
    expect(await repo.cancelarVivosDeSesion(sesionA, "respondio")).toBe(1);
    expect(await repo.findVivoBySessionId(sesionA)).toBeNull();
    expect(await repo.findVivoBySessionId(sesionB)).not.toBeNull();
  });

  test("cancelar los vivos de una sesión sin ninguno devuelve 0", async () => {
    expect(await repo.cancelarVivosDeSesion(sesionA, "respondio")).toBe(0);
  });

  test("listPorAvisar ignora los que todavía no vencieron", async () => {
    await programar();
    expect(await repo.listPorAvisar(AL_PROGRAMAR)).toHaveLength(0);
  });

  test("listPorAvisar levanta un pendiente ya vencido aunque el workflow no haya corrido", async () => {
    // La red del modo de falla que el dueño no acepta: si Inngest no despertó,
    // el recordatorio se atrasa pero no desaparece.
    await programar();
    expect(await repo.listPorAvisar(YA_VENCIDO)).toHaveLength(1);
  });

  test("listPorAvisar incluye los ya avisados", async () => {
    const r = await programar();
    await repo.marcarAvisado(r.id);
    expect(await repo.listPorAvisar(YA_VENCIDO)).toHaveLength(1);
  });

  test("listPorAvisar deja afuera los cancelados", async () => {
    const r = await programar();
    await repo.cancelar(r.id, "respondio");
    expect(await repo.listPorAvisar(YA_VENCIDO)).toHaveLength(0);
  });

  test("findVivoBySessionId encuentra tanto el pendiente como el avisado", async () => {
    const r = await programar();
    expect((await repo.findVivoBySessionId(sesionA))?.id).toBe(r.id);
    await repo.marcarAvisado(r.id);
    expect((await repo.findVivoBySessionId(sesionA))?.id).toBe(r.id);
  });
});
