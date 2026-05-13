import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryReactivationDispatchesRepository } from "@/server/repositories/reactivation-dispatches.repo";
import {
  reactivationPredictorHandler,
  type ReactivationPredictorDeps,
  type ReactivationSendInput,
} from "@/inngest/functions/reactivation-predictor.cron";
import type { MotivoPerdida, Resultado } from "@/types/domain";

const NOW = new Date("2026-05-12T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

async function seedClosed(
  sessions: InMemoryLeadSessionRepository,
  resultado: Resultado,
  motivo: MotivoPerdida | null,
  closedAt: Date,
) {
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
  const closed = await sessions.close(s.id, { resultado, motivo_perdida: motivo });
  const store = (sessions as unknown as { store: Map<string, typeof closed> }).store;
  const cur = store.get(closed.id)!;
  store.set(closed.id, { ...cur, closed_at: closedAt });
  return closed.id;
}

describe("reactivationPredictorHandler", () => {
  let sessions: InMemoryLeadSessionRepository;
  let sent: ReactivationSendInput[];
  let deps: ReactivationPredictorDeps;

  beforeEach(() => {
    sessions = new InMemoryLeadSessionRepository();
    sent = [];
    deps = {
      sessions,
      sendReactivation: async (input) => {
        sent.push(input);
      },
      now: () => NOW,
    };
  });

  test("sin sesiones no envia", async () => {
    const result = await reactivationPredictorHandler({}, deps);
    expect(sent).toEqual([]);
    expect(result.dispatched).toBe(0);
  });

  test("perdida hace 20d dentro de ventana dispara reactivacion", async () => {
    const id = await seedClosed(sessions, "perdido", "precio", daysAgo(20));

    const result = await reactivationPredictorHandler({}, deps);

    expect(sent).toHaveLength(1);
    expect(sent[0].sessionId).toBe(id);
    expect(sent[0].motivo).toBe("precio");
    expect(result.dispatched).toBe(1);
  });

  test("perdida hace 3d (cooldown 7d) no dispara", async () => {
    await seedClosed(sessions, "perdido", "precio", daysAgo(3));

    const result = await reactivationPredictorHandler({}, deps);

    expect(result.dispatched).toBe(0);
  });

  test("perdida hace 90d (fuera de ventana 60d) no dispara", async () => {
    await seedClosed(sessions, "perdido", "precio", daysAgo(90));

    const result = await reactivationPredictorHandler({}, deps);

    expect(result.dispatched).toBe(0);
  });

  test("exito hace 20d no dispara", async () => {
    await seedClosed(sessions, "exito", null, daysAgo(20));

    const result = await reactivationPredictorHandler({}, deps);

    expect(result.dispatched).toBe(0);
  });

  test("multiples perdidas en ventana dispatch por cada", async () => {
    const id1 = await seedClosed(sessions, "perdido", "precio", daysAgo(15));
    const id2 = await seedClosed(sessions, "perdido", "stock", daysAgo(30));

    const result = await reactivationPredictorHandler({}, deps);

    expect(result.dispatched).toBe(2);
    expect(sent.map((s) => s.sessionId).sort()).toEqual([id1, id2].sort());
  });

  test("dispatches repo: persiste registro post-send con motivo/template/status", async () => {
    const dispatches = new InMemoryReactivationDispatchesRepository();
    const id = await seedClosed(sessions, "perdido", "tiempo", daysAgo(20));
    deps = {
      ...deps,
      dispatches,
      sendReactivation: async (input) => {
        sent.push(input);
        return {
          templateName: "reactivacion_tiempo_v1",
          metaMessageId: "wamid.out.123",
          status: "sent",
        };
      },
    };

    const result = await reactivationPredictorHandler({}, deps);

    expect(result.dispatched).toBe(1);
    expect(result.skippedCooldown).toBe(0);
    const stored = await dispatches.findLatestBySessionId(id);
    expect(stored?.template_name).toBe("reactivacion_tiempo_v1");
    expect(stored?.meta_message_id).toBe("wamid.out.123");
    expect(stored?.motivo).toBe("tiempo");
    expect(stored?.status).toBe("sent");
  });

  test("cooldown via DB: dispatch reciente (< cooldown) bloquea re-envio", async () => {
    const dispatches = new InMemoryReactivationDispatchesRepository();
    const id = await seedClosed(sessions, "perdido", "precio", daysAgo(20));
    // Pre-seed dispatch hace 3 días (dentro cooldown 7d).
    const store = (
      dispatches as unknown as {
        store: Map<
          string,
          { id: string; lead_session_id: string; created_at: Date; [k: string]: unknown }
        >;
      }
    ).store;
    const dispatchId = crypto.randomUUID();
    store.set(dispatchId, {
      id: dispatchId,
      lead_session_id: id,
      motivo: "precio",
      template_name: "reactivacion_precio_v1",
      meta_message_id: null,
      status: "sent",
      created_at: daysAgo(3),
    });
    deps = { ...deps, dispatches };

    const result = await reactivationPredictorHandler({}, deps);

    expect(result.dispatched).toBe(0);
    expect(result.skippedCooldown).toBe(1);
    expect(sent).toHaveLength(0);
  });

  test("cooldown via DB: dispatch viejo (> cooldown) permite re-envio", async () => {
    const dispatches = new InMemoryReactivationDispatchesRepository();
    const id = await seedClosed(sessions, "perdido", "precio", daysAgo(45));
    // Pre-seed dispatch hace 30 días (fuera cooldown 7d).
    const store = (
      dispatches as unknown as {
        store: Map<
          string,
          { id: string; lead_session_id: string; created_at: Date; [k: string]: unknown }
        >;
      }
    ).store;
    const dispatchId = crypto.randomUUID();
    store.set(dispatchId, {
      id: dispatchId,
      lead_session_id: id,
      motivo: "precio",
      template_name: "reactivacion_precio_v1",
      meta_message_id: null,
      status: "sent",
      created_at: daysAgo(30),
    });
    deps = { ...deps, dispatches };

    const result = await reactivationPredictorHandler({}, deps);

    expect(result.dispatched).toBe(1);
    expect(result.skippedCooldown).toBe(0);
    expect(sent).toHaveLength(1);
  });
});
