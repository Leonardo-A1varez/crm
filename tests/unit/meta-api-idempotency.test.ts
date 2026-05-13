import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { FakeMetaApiClient } from "../mocks/meta";

async function setup() {
  const conversations = new InMemoryConversationsRepository();
  const messages = new InMemoryMessagesRepository();
  const client = new FakeMetaApiClient();
  const svc = new DefaultMetaApiService(conversations, messages, client);
  const conv = await conversations.create({
    lead_id: crypto.randomUUID(),
    canal: "wa",
    canal_thread_id: "549110",
  });
  return { conversations, messages, client, svc, conv };
}

describe("MetaApiService.sendOutbound idempotency", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    ctx = await setup();
  });

  test("sin idempotencyKey: comportamiento legacy (no dedup)", async () => {
    await ctx.svc.sendOutbound({
      conversacionId: ctx.conv.id,
      leadSessionId: crypto.randomUUID(),
      canal: "wa",
      to: "549110",
      contenido: "a",
      sender: "ia",
    });
    await ctx.svc.sendOutbound({
      conversacionId: ctx.conv.id,
      leadSessionId: crypto.randomUUID(),
      canal: "wa",
      to: "549110",
      contenido: "b",
      sender: "ia",
    });
    expect(ctx.client.calls).toHaveLength(2);
  });

  test("idempotencyKey nuevo: persiste con key + invoca Meta client", async () => {
    const m = await ctx.svc.sendOutbound({
      conversacionId: ctx.conv.id,
      leadSessionId: crypto.randomUUID(),
      canal: "wa",
      to: "549110",
      contenido: "respuesta",
      sender: "ia",
      idempotencyKey: "out:wamid.IN-1",
    });
    expect(m.idempotency_key).toBe("out:wamid.IN-1");
    expect(ctx.client.calls).toHaveLength(1);
  });

  test("idempotencyKey existente: retorna existing SIN llamar Meta client", async () => {
    const sessionId = crypto.randomUUID();
    const key = "out:wamid.IN-X";

    const first = await ctx.svc.sendOutbound({
      conversacionId: ctx.conv.id,
      leadSessionId: sessionId,
      canal: "wa",
      to: "549110",
      contenido: "respuesta",
      sender: "ia",
      idempotencyKey: key,
    });

    const second = await ctx.svc.sendOutbound({
      conversacionId: ctx.conv.id,
      leadSessionId: sessionId,
      canal: "wa",
      to: "549110",
      contenido: "respuesta-distinta-ignorada",
      sender: "ia",
      idempotencyKey: key,
    });

    expect(second.id).toBe(first.id);
    expect(ctx.client.calls).toHaveLength(1);
    const all = await ctx.messages.listByConversacion(ctx.conv.id);
    expect(all).toHaveLength(1);
  });

  test("idempotencyKey distintos: persiste 2 mensajes", async () => {
    await ctx.svc.sendOutbound({
      conversacionId: ctx.conv.id,
      leadSessionId: crypto.randomUUID(),
      canal: "wa",
      to: "549110",
      contenido: "a",
      sender: "ia",
      idempotencyKey: "out:k1",
    });
    await ctx.svc.sendOutbound({
      conversacionId: ctx.conv.id,
      leadSessionId: crypto.randomUUID(),
      canal: "wa",
      to: "549110",
      contenido: "b",
      sender: "ia",
      idempotencyKey: "out:k2",
    });
    expect(ctx.client.calls).toHaveLength(2);
  });
});
