import { describe, expect, test } from "vitest";
import { esAvance } from "@/lib/entrega";
import { parseMetaStatuses } from "@/lib/meta/parse-webhook";
import { onStatusReceivedHandler } from "@/inngest/functions/on-status-received";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";

function payloadWA(statuses: unknown[]): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { statuses } }] }],
  };
}

describe("esAvance", () => {
  test("el primer estado siempre entra", () => {
    expect(esAvance(null, "enviado")).toBe(true);
    expect(esAvance(null, "fallido")).toBe(true);
  });

  test("no retrocede: Meta no garantiza el orden de los webhooks", () => {
    expect(esAvance("leido", "entregado")).toBe(false);
    expect(esAvance("entregado", "enviado")).toBe(false);
  });

  test("el mismo estado repetido no es avance", () => {
    expect(esAvance("entregado", "entregado")).toBe(false);
  });

  test("fallido pisa cualquier escalón previo", () => {
    expect(esAvance("leido", "fallido")).toBe(true);
  });
});

describe("parseMetaStatuses", () => {
  test("mapea los cuatro estados de WhatsApp", () => {
    const out = parseMetaStatuses(
      payloadWA([
        { id: "wamid.1", status: "sent", timestamp: "1786000000" },
        { id: "wamid.2", status: "delivered", timestamp: "1786000001" },
        { id: "wamid.3", status: "read", timestamp: "1786000002" },
        { id: "wamid.4", status: "failed", timestamp: "1786000003" },
      ]),
    );

    expect(out.map((s) => s.estado)).toEqual(["enviado", "entregado", "leido", "fallido"]);
    expect(out[0]?.at).toEqual(new Date(1786000000 * 1000));
  });

  test("ignora estados que no son escalones de entrega", () => {
    expect(parseMetaStatuses(payloadWA([{ id: "wamid.9", status: "deleted" }]))).toEqual([]);
  });

  test("descarta el status sin id", () => {
    expect(parseMetaStatuses(payloadWA([{ status: "read" }]))).toEqual([]);
  });

  test("un timestamp roto no descarta el estado", () => {
    const out = parseMetaStatuses(
      payloadWA([{ id: "wamid.5", status: "sent", timestamp: "ayer" }]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.at).toBeInstanceOf(Date);
  });

  test("levanta el título del error cuando falla", () => {
    const out = parseMetaStatuses(
      payloadWA([
        {
          id: "wamid.6",
          status: "failed",
          timestamp: "1786000000",
          errors: [{ title: "Fuera de la ventana de 24 horas" }],
        },
      ]),
    );
    expect(out[0]?.error).toBe("Fuera de la ventana de 24 horas");
  });

  test("Instagram y Messenger no reportan por mensaje: devuelve vacío", () => {
    expect(parseMetaStatuses({ object: "instagram", entry: [] })).toEqual([]);
    expect(parseMetaStatuses({ object: "page", entry: [] })).toEqual([]);
  });
});

describe("onStatusReceivedHandler", () => {
  async function conMensaje() {
    const messages = new InMemoryMessagesRepository();
    const msg = await messages.create({
      conversacion_id: crypto.randomUUID(),
      lead_session_id: crypto.randomUUID(),
      direction: "out",
      sender: "ia",
      sender_user_id: null,
      tipo: "text",
      contenido: "hola",
      media_url: null,
      meta_message_id: "wamid.abc",
      idempotency_key: null,
      metadata: {},
    });
    return { messages, msg };
  }

  test("aplica el estado al mensaje que corresponde", async () => {
    const { messages, msg } = await conMensaje();

    const r = await onStatusReceivedHandler(
      {
        meta_message_id: "wamid.abc",
        estado: "entregado",
        at: "2026-08-10T10:00:00.000Z",
        error: null,
      },
      { messages },
    );

    expect(r).toEqual({ aplicado: true, motivo: "ok" });
    const actualizado = await messages.findById(msg.id);
    expect(actualizado?.estado_entrega).toBe("entregado");
    expect(actualizado?.estado_entrega_at).toEqual(new Date("2026-08-10T10:00:00.000Z"));
  });

  test("un estado viejo que llega tarde no hace retroceder el mensaje", async () => {
    const { messages, msg } = await conMensaje();
    const base = { meta_message_id: "wamid.abc", error: null };

    await onStatusReceivedHandler(
      { ...base, estado: "leido", at: "2026-08-10T10:00:02.000Z" },
      { messages },
    );
    await onStatusReceivedHandler(
      { ...base, estado: "entregado", at: "2026-08-10T10:00:01.000Z" },
      { messages },
    );

    expect((await messages.findById(msg.id))?.estado_entrega).toBe("leido");
  });

  test("un mensaje que no salió de acá no es un error", async () => {
    const { messages } = await conMensaje();

    const r = await onStatusReceivedHandler(
      {
        meta_message_id: "wamid.ajeno",
        estado: "leido",
        at: "2026-08-10T10:00:00.000Z",
        error: null,
      },
      { messages },
    );

    expect(r).toEqual({ aplicado: false, motivo: "mensaje_desconocido" });
  });

  test("guarda el error cuando el envío falla", async () => {
    const { messages, msg } = await conMensaje();

    await onStatusReceivedHandler(
      {
        meta_message_id: "wamid.abc",
        estado: "fallido",
        at: "2026-08-10T10:00:00.000Z",
        error: "Fuera de la ventana de 24 horas",
      },
      { messages },
    );

    const actualizado = await messages.findById(msg.id);
    expect(actualizado?.estado_entrega).toBe("fallido");
    expect(actualizado?.error_entrega).toBe("Fuera de la ventana de 24 horas");
  });
});
