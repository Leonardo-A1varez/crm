import { beforeEach, describe, expect, test, vi } from "vitest";
import { InfraError, RateLimitError } from "@/lib/errors";
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

describe("sendOutbound — ventana de doble envio", () => {
  test("si la escritura falla despues de Meta, el reintento NO reenvia", async () => {
    const conversations = new InMemoryConversationsRepository();
    const messages = new InMemoryMessagesRepository();
    const client = new FakeMetaApiClient();
    const conv = await conversations.create({
      lead_id: crypto.randomUUID(),
      canal: "wa",
      canal_thread_id: "5491155550000",
    });
    const service = new DefaultMetaApiService(conversations, messages, client);
    const entrada = {
      conversacionId: conv.id,
      leadSessionId: crypto.randomUUID(),
      canal: "wa" as const,
      to: "5491155550000",
      contenido: "tenemos el filtro",
      sender: "ia" as const,
      idempotencyKey: "out:wamid.ENTRANTE",
    };

    // Primer intento: Meta acepta, pero confirmar la fila falla.
    const confirmar = vi
      .spyOn(messages, "confirmarEnvio")
      .mockRejectedValueOnce(new InfraError("postgrest caido", "postgrest"));
    await expect(service.sendOutbound(entrada)).rejects.toThrow(InfraError);
    expect(client.calls).toHaveLength(1);

    // Reintento de Inngest: encuentra la reserva y no vuelve a llamar a Meta.
    confirmar.mockRestore();
    await service.sendOutbound(entrada);
    expect(client.calls).toHaveLength(1);
  });

  test("un 5xx de Meta deja la reserva visible como fallida y no reenvia", async () => {
    const conversations = new InMemoryConversationsRepository();
    const messages = new InMemoryMessagesRepository();
    const client = new FakeMetaApiClient();
    client.failWith = new InfraError("Meta 503", "meta");
    const conv = await conversations.create({
      lead_id: crypto.randomUUID(),
      canal: "wa",
      canal_thread_id: "5491155550001",
    });
    const service = new DefaultMetaApiService(conversations, messages, client);
    const entrada = {
      conversacionId: conv.id,
      leadSessionId: crypto.randomUUID(),
      canal: "wa" as const,
      to: "5491155550001",
      contenido: "hola",
      sender: "ia" as const,
      idempotencyKey: "out:wamid.CINCOXX",
    };

    await expect(service.sendOutbound(entrada)).rejects.toThrow(InfraError);

    const reserva = await messages.findByIdempotencyKey("out:wamid.CINCOXX");
    expect(reserva?.meta_message_id).toBeNull();
    expect(reserva?.estado_entrega).toBe("fallido");
    expect(reserva?.error_entrega).toContain("Meta 503");

    client.failWith = null;
    await service.sendOutbound(entrada);
    expect(client.calls).toHaveLength(1);
  });

  test("un 429 libera la reserva y el reintento si reenvia", async () => {
    const conversations = new InMemoryConversationsRepository();
    const messages = new InMemoryMessagesRepository();
    const client = new FakeMetaApiClient();
    client.failWith = new RateLimitError("Meta rate-limited", "meta");
    const conv = await conversations.create({
      lead_id: crypto.randomUUID(),
      canal: "wa",
      canal_thread_id: "5491155550002",
    });
    const service = new DefaultMetaApiService(conversations, messages, client);
    const entrada = {
      conversacionId: conv.id,
      leadSessionId: crypto.randomUUID(),
      canal: "wa" as const,
      to: "5491155550002",
      contenido: "hola",
      sender: "ia" as const,
      idempotencyKey: "out:wamid.CUATRO29",
    };

    await expect(service.sendOutbound(entrada)).rejects.toThrow(RateLimitError);
    expect(await messages.findByIdempotencyKey("out:wamid.CUATRO29")).toBeNull();

    client.failWith = null;
    const enviado = await service.sendOutbound(entrada);
    expect(client.calls).toHaveLength(2);
    expect(enviado.meta_message_id).not.toBeNull();
  });

  test("el camino feliz persiste el meta_message_id que devolvio Meta", async () => {
    const conversations = new InMemoryConversationsRepository();
    const messages = new InMemoryMessagesRepository();
    const client = new FakeMetaApiClient();
    const conv = await conversations.create({
      lead_id: crypto.randomUUID(),
      canal: "wa",
      canal_thread_id: "5491155550003",
    });
    const service = new DefaultMetaApiService(conversations, messages, client);

    const enviado = await service.sendOutbound({
      conversacionId: conv.id,
      leadSessionId: crypto.randomUUID(),
      canal: "wa",
      to: "5491155550003",
      contenido: "hola",
      sender: "ia",
      idempotencyKey: "out:wamid.FELIZ",
    });

    // `FakeMetaApiClient` numera sus ids desde 1 con el prefijo `wamid.fake-`.
    expect(enviado.meta_message_id).toBe("wamid.fake-1");
    expect(enviado.estado_entrega).toBeNull();
    expect(client.calls[0]?.text).toBe("hola");
    expect(await messages.findByMetaMessageId("wamid.fake-1")).not.toBeNull();
  });
});
