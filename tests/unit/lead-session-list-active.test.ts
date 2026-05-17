import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";

describe("LeadSessionRepository.listActive (InMemory)", () => {
  let repo: InMemoryLeadSessionRepository;

  beforeEach(() => {
    repo = new InMemoryLeadSessionRepository();
  });

  test("returns empty when no sessions", async () => {
    const out = await repo.listActive();
    expect(out).toEqual([]);
  });

  test("returns only sessions where resultado IS NULL", async () => {
    const leadA = crypto.randomUUID();
    const leadB = crypto.randomUUID();
    const leadC = crypto.randomUUID();

    const sActive = await repo.create({
      lead_id: leadA,
      current_stage: "nuevo",
      urgencia: "media",
      consulta: "A",
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
    const sClosed = await repo.create({
      lead_id: leadB,
      current_stage: "nuevo",
      urgencia: "media",
      consulta: "B",
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
    await repo.close(sClosed.id, { resultado: "exito" });
    const sActive2 = await repo.create({
      lead_id: leadC,
      current_stage: "negociando",
      urgencia: "alta",
      consulta: "C",
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

    const out = await repo.listActive();
    const ids = out.map((s) => s.id).sort();
    expect(ids).toEqual([sActive.id, sActive2.id].sort());
  });

  test("returns deep cloned sessions (mutation safe)", async () => {
    const leadA = crypto.randomUUID();
    await repo.create({
      lead_id: leadA,
      current_stage: "nuevo",
      urgencia: "media",
      consulta: "A",
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
      extras: { foo: { bar: 1 } },
    });

    const out = await repo.listActive();
    expect(out).toHaveLength(1);
    const extras = out[0]!.extras as { foo: { bar: number } };
    extras.foo.bar = 999;

    const out2 = await repo.listActive();
    const extras2 = out2[0]!.extras as { foo: { bar: number } };
    expect(extras2.foo.bar).toBe(1);
  });
});
