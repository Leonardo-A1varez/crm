import { describe, expect, test } from "vitest";
import { onMessageReceivedHandler } from "@/inngest/functions/on-message-received";
import { makePipelineDeps } from "../../helpers/pipeline-deps";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";

function entrante(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    canal: "wa",
    canal_thread_id: "16505551234",
    meta_user_id: "16505551234",
    meta_message_id: `wamid.${crypto.randomUUID()}`,
    tipo: "text",
    contenido: "hola",
    media_url: null,
    nombre_perfil: "Pablo",
    raw: {},
    ...overrides,
  };
}

describe("on-message-received — el número de negocio de la conversación", () => {
  test("anota el phone_number_id del entrante y lo cambia si el cliente escribe a otro número", async () => {
    const deps = makePipelineDeps();
    deps.agentLLM.enqueueText("uno").enqueueText("dos");
    const r1 = await onMessageReceivedHandler(
      { parsed: entrante({ numero_negocio_id: "106540352242922" }) },
      deps,
    );
    expect((await deps.conversations.findById(r1.conversacionId))?.whatsapp_phone_number_id).toBe(
      "106540352242922",
    );

    await onMessageReceivedHandler(
      { parsed: entrante({ numero_negocio_id: "100000000000001" }) },
      deps,
    );
    expect((await deps.conversations.findById(r1.conversacionId))?.whatsapp_phone_number_id).toBe(
      "100000000000001",
    );
  });

  test("la respuesta del agente y el «escribiendo…» salen por el número al que escribió el cliente", async () => {
    const deps = makePipelineDeps();
    deps.agentLLM.enqueueText("respuesta");
    await onMessageReceivedHandler(
      { parsed: entrante({ numero_negocio_id: "106540352242922" }) },
      deps,
    );
    expect(deps.metaClient.calls.length).toBeGreaterThan(0);
    for (const c of deps.metaClient.calls) expect(c.desde).toBe("106540352242922");
    for (const c of deps.metaClient.typingCalls) expect(c.desde).toBe("106540352242922");
  });

  test("sin phone_number_id (payload viejo) la conversación queda como estaba", async () => {
    const deps = makePipelineDeps();
    deps.agentLLM.enqueueText("respuesta");
    const r = await onMessageReceivedHandler({ parsed: entrante() }, deps);
    expect(
      (await deps.conversations.findById(r.conversacionId))?.whatsapp_phone_number_id ?? null,
    ).toBeNull();
    for (const c of deps.metaClient.calls) expect(c.desde).toBeUndefined();
  });
});
