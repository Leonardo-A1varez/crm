import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import {
  detectIntentsBatchHandler,
  type DetectIntentsBatchDeps,
} from "@/inngest/functions/detect-intents.batch";
import { FakeIntentBatchDetectorLLM } from "../mocks/llm";

async function setup() {
  const sessions = new InMemoryLeadSessionRepository();
  const conversations = new InMemoryConversationsRepository();
  const messages = new InMemoryMessagesRepository();
  const intents = new InMemoryIntentsRepository();
  const detector = new FakeIntentBatchDetectorLLM();
  const deps: DetectIntentsBatchDeps = {
    sessions,
    conversations,
    messages,
    intents,
    detector,
    now: () => new Date("2026-05-12T00:00:00Z"),
  };
  return { sessions, conversations, messages, intents, detector, deps };
}

async function seedClosedSession(sessions: InMemoryLeadSessionRepository, closedAt: Date) {
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
  // forzar closed_at via store interno: re-emit via mismo patron — sessions.close ya seta. Pero queremos closed_at custom.
  // Workaround: castear store privado para tests.
  const store = (sessions as unknown as { store: Map<string, typeof closed> }).store;
  const current = store.get(closed.id)!;
  store.set(closed.id, { ...current, closed_at: closedAt });
  return store.get(closed.id)!;
}

describe("detectIntentsBatchHandler", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    ctx = await setup();
  });

  test("sin sesiones cerradas detector recibe [] y no crea intents", async () => {
    ctx.detector.enqueue([]);

    const result = await detectIntentsBatchHandler({}, ctx.deps);

    expect(ctx.detector.calls).toHaveLength(1);
    expect(ctx.detector.calls[0].sessions).toEqual([]);
    expect(result.persisted).toBe(0);
  });

  test("sesion cerrada hace 1 dia incluida en batch", async () => {
    const closedAt = new Date("2026-05-11T00:00:00Z");
    await seedClosedSession(ctx.sessions, closedAt);
    ctx.detector.enqueue([]);

    await detectIntentsBatchHandler({}, ctx.deps);

    expect(ctx.detector.calls[0].sessions).toHaveLength(1);
  });

  test("sesion cerrada hace 30 dias excluida del batch", async () => {
    const old = new Date("2026-04-01T00:00:00Z");
    await seedClosedSession(ctx.sessions, old);
    ctx.detector.enqueue([]);

    await detectIntentsBatchHandler({}, ctx.deps);

    expect(ctx.detector.calls[0].sessions).toEqual([]);
  });

  test("detector propone intent nuevo se crea auto_detectado=true activo=false", async () => {
    const closedAt = new Date("2026-05-11T00:00:00Z");
    await seedClosedSession(ctx.sessions, closedAt);
    ctx.detector.enqueue([
      {
        nombre: "pide_horario",
        descripcion: "lead pregunta horario",
        ejemplos: ["a qué hora abren?"],
      },
    ]);

    const result = await detectIntentsBatchHandler({}, ctx.deps);

    expect(result.persisted).toBe(1);
    const intent = await ctx.intents.findByNombre("pide_horario");
    expect(intent).not.toBeNull();
    expect(intent!.auto_detectado).toBe(true);
    expect(intent!.activo).toBe(false);
    expect(intent!.ejemplos).toEqual(["a qué hora abren?"]);
  });

  test("intent existente con mismo nombre no se duplica", async () => {
    const closedAt = new Date("2026-05-11T00:00:00Z");
    await seedClosedSession(ctx.sessions, closedAt);
    await ctx.intents.create({
      nombre: "saludo",
      descripcion: "existente",
      ejemplos: ["hola"],
      auto_detectado: false,
      activo: true,
    });
    ctx.detector.enqueue([{ nombre: "saludo", descripcion: "duplicado", ejemplos: ["buenas"] }]);

    const result = await detectIntentsBatchHandler({}, ctx.deps);

    expect(result.persisted).toBe(0);
    const all = await ctx.intents.list();
    expect(all).toHaveLength(1);
    expect(all[0].descripcion).toBe("existente");
  });

  test("detector recibe mensajes de las conversaciones de cada sesion", async () => {
    const closedAt = new Date("2026-05-11T00:00:00Z");
    const session = await seedClosedSession(ctx.sessions, closedAt);
    const conv = await ctx.conversations.create({
      lead_id: session.lead_id,
      canal: "wa",
      canal_thread_id: "549999",
    });
    await ctx.messages.create({
      conversacion_id: conv.id,
      lead_session_id: session.id,
      direction: "in",
      sender: "lead",
      sender_user_id: null,
      tipo: "text",
      contenido: "hola hay stock?",
      media_url: null,
      meta_message_id: "wamid.1",
      idempotency_key: null,
      metadata: {},
    });
    ctx.detector.enqueue([]);

    await detectIntentsBatchHandler({}, ctx.deps);

    expect(ctx.detector.calls[0].sessions).toHaveLength(1);
    expect(ctx.detector.calls[0].sessions[0].messages).toContain("hola hay stock?");
  });
});
