import { describe, expect, test } from "vitest";
import { ConflictError, IllegalStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultTwinExtractorService } from "@/server/services/twin-extractor.service";
import { FakeTwinExtractorLLM } from "../mocks/llm";

describe("Repos/services throw clases DomainError", () => {
  test("lead-session.update id inexistente → NotFoundError", async () => {
    const repo = new InMemoryLeadSessionRepository();
    await expect(repo.update("fake-id", {})).rejects.toBeInstanceOf(NotFoundError);
  });

  test("lead-session.close resultado distinto sobre cerrada → IllegalStateError (NonRetriable)", async () => {
    const repo = new InMemoryLeadSessionRepository();
    const s = await repo.create({
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
    await repo.close(s.id, { resultado: "exito" });
    await expect(repo.close(s.id, { resultado: "perdido" })).rejects.toBeInstanceOf(
      IllegalStateError,
    );
  });

  test("lead-session.close mismo resultado sobre cerrada → idempotente (no throw)", async () => {
    const repo = new InMemoryLeadSessionRepository();
    const s = await repo.create({
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
    const first = await repo.close(s.id, { resultado: "exito" });
    const second = await repo.close(s.id, { resultado: "exito" });
    expect(second.id).toBe(first.id);
    expect(second.closed_at).toEqual(first.closed_at);
  });

  test("leads.create telefono duplicado → ConflictError", async () => {
    const repo = new InMemoryLeadsRepository();
    const base = {
      nombre: "",
      telefono: "549110",
      email: null,
      direccion: null,
      vehiculo_marca: "",
      vehiculo_modelo: "",
      vehiculo_anio: 0,
      vehiculo_motor: null,
      empresa_id: null,
      canal_origen: "wa" as const,
      meta_user_ids: { wa: "549110" },
    };
    await repo.create(base);
    await expect(repo.create(base)).rejects.toBeInstanceOf(ConflictError);
  });

  test("productos.bulkUpsert dup en input → ValidationError", async () => {
    const repo = new InMemoryProductsRepository();
    const item = {
      codigo_interno: "DUP",
      sku_proveedor: null,
      nombre: "x",
      descripcion: null,
      categoria: null,
      precio: 1,
      stock: 0,
    };
    await expect(repo.bulkUpsert([item, item])).rejects.toBeInstanceOf(ValidationError);
  });

  test("conversations.upsertByCanalThread thread ya pertenece a otro lead → ConflictError", async () => {
    const repo = new InMemoryConversationsRepository();
    const leadA = crypto.randomUUID();
    const leadB = crypto.randomUUID();
    await repo.upsertByCanalThread("wa", "thread-1", leadA);
    await expect(repo.upsertByCanalThread("wa", "thread-1", leadB)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  test("handoff.pause sesión inexistente → NotFoundError", async () => {
    const sessions = new InMemoryLeadSessionRepository();
    const handoff = new DefaultHandoffService(sessions);
    await expect(handoff.pause("fake", "motivo")).rejects.toBeInstanceOf(NotFoundError);
  });

  test("handoff.pause sesión cerrada → ConflictError", async () => {
    const sessions = new InMemoryLeadSessionRepository();
    const s = await sessions.create({
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
    await sessions.close(s.id, { resultado: "exito" });
    const handoff = new DefaultHandoffService(sessions);
    await expect(handoff.pause(s.id, "x")).rejects.toBeInstanceOf(ConflictError);
  });

  test("twin-extractor LLM patch inválido → ValidationError", async () => {
    const sessions = new InMemoryLeadSessionRepository();
    const llm = new FakeTwinExtractorLLM();
    const svc = new DefaultTwinExtractorService(sessions, llm);
    const s = await sessions.create({
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
    llm.enqueue({ current_stage: "INVALIDO" as never });
    await expect(svc.extract({ sessionId: s.id, conversationTurn: ["x"] })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("twin-extractor sesión inexistente → NotFoundError", async () => {
    const sessions = new InMemoryLeadSessionRepository();
    const llm = new FakeTwinExtractorLLM();
    const svc = new DefaultTwinExtractorService(sessions, llm);
    await expect(svc.extract({ sessionId: "fake", conversationTurn: [] })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
