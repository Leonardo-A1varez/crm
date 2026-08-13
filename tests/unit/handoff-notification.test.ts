import { describe, expect, test } from "vitest";
import {
  handoffNotificationHandler,
  type HandoffNotificationDeps,
} from "@/inngest/functions/handoff-notification";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { FakeMetaApiClient } from "../mocks/meta";

async function setup() {
  const sessions = new InMemoryLeadSessionRepository();
  const conversations = new InMemoryConversationsRepository();
  const messages = new InMemoryMessagesRepository();
  const client = new FakeMetaApiClient();
  const leadId = crypto.randomUUID();
  const session = await sessions.create({
    lead_id: leadId,
    current_stage: "requiere_humano",
    stage_before_handoff: "negociando",
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
    ia_pausada: true,
  });
  const conversation = await conversations.create({
    lead_id: leadId,
    canal: "wa",
    canal_thread_id: "thread-1",
  });
  const deps: HandoffNotificationDeps = {
    sessions,
    conversations,
    configProvider: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
    metaApi: new DefaultMetaApiService(conversations, messages, client),
  };
  return { sessions, messages, client, session, conversation, deps };
}

describe("handoffNotificationHandler", () => {
  test("envía una sola plantilla de sistema aunque Inngest reintente", async () => {
    const ctx = await setup();
    const eventId = crypto.randomUUID();

    await handoffNotificationHandler(
      { handoffEventId: eventId, leadSessionId: ctx.session.id },
      ctx.deps,
    );
    await handoffNotificationHandler(
      { handoffEventId: eventId, leadSessionId: ctx.session.id },
      ctx.deps,
    );

    expect(ctx.client.calls).toHaveLength(1);
    expect(ctx.client.calls[0]?.text).toBe(CONFIG_DE_FABRICA.plantilla_escalado);
    const persisted = await ctx.messages.listBySessionId(ctx.session.id);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      sender: "sistema",
      idempotency_key: `handoff-notice:${eventId}`,
      metadata: { plantilla: "handoff" },
    });
  });

  test("si la sesión fue reanudada no envía un aviso atrasado", async () => {
    const ctx = await setup();
    await ctx.sessions.update(ctx.session.id, {
      ia_pausada: false,
      current_stage: "negociando",
      stage_before_handoff: null,
    });

    const result = await handoffNotificationHandler(
      { handoffEventId: crypto.randomUUID(), leadSessionId: ctx.session.id },
      ctx.deps,
    );

    expect(result).toEqual({ sent: false, reason: "session_resumed" });
    expect(ctx.client.calls).toHaveLength(0);
  });
});
