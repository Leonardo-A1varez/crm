import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { makeSendReactivation } from "@/inngest/callbacks/send-reactivation";
import { ValidationError } from "@/lib/errors";
import { NoopLogger } from "@/lib/observability/logger";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import type { MetaApiService, SendOutboundInput } from "@/server/services/meta-api.service";
import type { Lead, Mensaje } from "@/types/entities";

async function makeLead(repo: InMemoryLeadsRepository): Promise<Lead> {
  return repo.create({
    nombre: "Carlos Gómez",
    telefono: "+595981555444",
    email: null,
    direccion: null,
    vehiculo_marca: "Nissan",
    vehiculo_modelo: "Frontier",
    vehiculo_anio: 2018,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: "wa",
    meta_user_ids: {},
  });
}

describe("makeSendReactivation (real)", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let convs: InMemoryConversationsRepository;
  let sendOutbound: Mock<(input: SendOutboundInput) => Promise<Mensaje>>;
  let metaApi: MetaApiService;
  let send: ReturnType<typeof makeSendReactivation>;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    convs = new InMemoryConversationsRepository();
    sendOutbound = vi.fn(async (_input: SendOutboundInput) => {
      return { id: crypto.randomUUID(), meta_message_id: "wamid.react.1" } as unknown as Mensaje;
    });
    metaApi = { sendOutbound, recordInbound: vi.fn() } as unknown as MetaApiService;
    send = makeSendReactivation({
      leads,
      sessions,
      convs,
      metaApi,
      logger: new NoopLogger(),
    });
  });

  test("happy: envía por la conversación más reciente con idempotency key determinística", async () => {
    const lead = await makeLead(leads);
    await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: lead.telefono });
    await new Promise((r) => setTimeout(r, 5));
    const convIg = await convs.create({ lead_id: lead.id, canal: "ig", canal_thread_id: "ig-9" });
    const sessionId = crypto.randomUUID();

    const result = await send({ sessionId, leadId: lead.id, motivo: "precio" });

    expect(result.status).toBe("sent");
    expect(result.metaMessageId).toBe("wamid.react.1");
    expect(result.templateName).toBe("reactivacion_precio_v1");
    const input = sendOutbound.mock.calls[0]?.[0];
    expect(input?.canal).toBe("ig");
    expect(input?.to).toBe(convIg.canal_thread_id);
    expect(input?.sender).toBe("ia");
    expect(input?.idempotencyKey).toBe(`react-${sessionId}`);
    expect(input?.contenido).toContain("Carlos");
  });

  test("template varía por motivo (null → genérica)", async () => {
    const lead = await makeLead(leads);
    await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: lead.telefono });

    const r1 = await send({ sessionId: crypto.randomUUID(), leadId: lead.id, motivo: "stock" });
    const r2 = await send({ sessionId: crypto.randomUUID(), leadId: lead.id, motivo: null });

    expect(r1.templateName).toBe("reactivacion_stock_v1");
    expect(r2.templateName).toBe("reactivacion_generica_v1");
    const c1 = sendOutbound.mock.calls[0]?.[0]?.contenido ?? "";
    const c2 = sendOutbound.mock.calls[1]?.[0]?.contenido ?? "";
    expect(c1).not.toBe(c2);
  });

  test("lead con sesión ACTIVA → bounced skip sin enviar", async () => {
    const lead = await makeLead(leads);
    await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: lead.telefono });
    await sessions.create({
      lead_id: lead.id,
      current_stage: "nuevo",
      urgencia: "media",
      consulta: "nueva conversación viva",
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

    const result = await send({
      sessionId: crypto.randomUUID(),
      leadId: lead.id,
      motivo: "precio",
    });

    expect(result.status).toBe("bounced");
    expect(result.templateName).toBe("skip_sesion_activa");
    expect(sendOutbound).not.toHaveBeenCalled();
  });

  test("lead sin conversaciones → bounced skip", async () => {
    const lead = await makeLead(leads);

    const result = await send({ sessionId: crypto.randomUUID(), leadId: lead.id, motivo: null });

    expect(result.status).toBe("bounced");
    expect(result.templateName).toBe("skip_sin_conversacion");
    expect(sendOutbound).not.toHaveBeenCalled();
  });

  test("lead inexistente → bounced skip", async () => {
    const result = await send({
      sessionId: crypto.randomUUID(),
      leadId: crypto.randomUUID(),
      motivo: "otro",
    });

    expect(result.status).toBe("bounced");
    expect(result.templateName).toBe("skip_lead_inexistente");
  });

  test("ValidationError de Meta (canal sin config) → bounced; InfraError → rethrow", async () => {
    const lead = await makeLead(leads);
    await convs.create({ lead_id: lead.id, canal: "ig", canal_thread_id: "ig-1" });

    sendOutbound.mockRejectedValueOnce(new ValidationError("canal ig no configurado"));
    const bounced = await send({
      sessionId: crypto.randomUUID(),
      leadId: lead.id,
      motivo: "precio",
    });
    expect(bounced.status).toBe("bounced");
    expect(bounced.templateName).toBe("skip_canal_sin_config");

    sendOutbound.mockRejectedValueOnce(new Error("meta 500"));
    await expect(
      send({ sessionId: crypto.randomUUID(), leadId: lead.id, motivo: "precio" }),
    ).rejects.toThrow("meta 500");
  });
});
