import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import {
  purgeOldSessionsHandler,
  type PurgeOldSessionsDeps,
} from "@/inngest/functions/purge-old-sessions.cron";
import type { UUID } from "@/types/entities";

async function seedClosed(sessions: InMemoryLeadSessionRepository, closedAt: Date) {
  const s = await sessions.create({
    lead_id: crypto.randomUUID(),
    current_stage: "cerrado",
    urgencia: "media",
    consulta: "",
    producto_cotizado_id: null,
    codigo_interno: null,
    precio_cotizado: null,
    cantidad: null,
    bloqueador: null,
    comprobante_pago_url: null,
    metodo_pago: null,
    resultado: null,
    motivo_perdida: null,
    ia_pausada: false,
  });
  const closed = await sessions.close(s.id, { resultado: "exito" });
  const store = (sessions as unknown as { store: Map<string, typeof closed> }).store;
  const cur = store.get(closed.id)!;
  store.set(closed.id, { ...cur, closed_at: closedAt });
  return closed.id;
}

describe("purgeOldSessionsHandler", () => {
  const NOW = new Date("2026-05-12T00:00:00Z");
  const cutoffDate = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000);

  let sessions: InMemoryLeadSessionRepository;
  let purged: UUID[];
  let deps: PurgeOldSessionsDeps;

  beforeEach(() => {
    sessions = new InMemoryLeadSessionRepository();
    purged = [];
    deps = {
      sessions,
      purgeSession: async (id) => {
        purged.push(id);
      },
      now: () => NOW,
    };
  });

  test("sin candidates purgeSession no se llama", async () => {
    const result = await purgeOldSessionsHandler({}, deps);
    expect(purged).toEqual([]);
    expect(result.purgedCount).toBe(0);
  });

  test("sesion cerrada 30 dias antes purga", async () => {
    const id = await seedClosed(sessions, cutoffDate(30));

    const result = await purgeOldSessionsHandler({}, deps);

    expect(purged).toEqual([id]);
    expect(result.purgedCount).toBe(1);
  });

  test("sesion cerrada 10 dias antes NO purga", async () => {
    await seedClosed(sessions, cutoffDate(10));

    const result = await purgeOldSessionsHandler({}, deps);

    expect(purged).toEqual([]);
    expect(result.purgedCount).toBe(0);
  });

  test("sesion activa (no closed_at) ignorada", async () => {
    await sessions.create({
      lead_id: crypto.randomUUID(),
      current_stage: "nuevo",
      urgencia: "media",
      consulta: "",
      producto_cotizado_id: null,
      codigo_interno: null,
      precio_cotizado: null,
      cantidad: null,
      bloqueador: null,
      comprobante_pago_url: null,
      metodo_pago: null,
      resultado: null,
      motivo_perdida: null,
      ia_pausada: false,
    });

    const result = await purgeOldSessionsHandler({}, deps);
    expect(result.purgedCount).toBe(0);
  });

  test("multiples candidates: purgeSession llamado por cada", async () => {
    const id1 = await seedClosed(sessions, cutoffDate(40));
    const id2 = await seedClosed(sessions, cutoffDate(50));

    const result = await purgeOldSessionsHandler({}, deps);

    expect(purged.sort()).toEqual([id1, id2].sort());
    expect(result.purgedCount).toBe(2);
  });
});
