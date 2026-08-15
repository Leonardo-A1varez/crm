import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { DefaultTwinExtractorService } from "@/server/services/twin-extractor.service";
import type { LeadSession } from "@/types/entities";
import { FakeTwinExtractorLLM } from "../mocks/llm";
import { CLAVE_MOTIVO_SUGERIDO } from "@/lib/ui/motivo-perdida";

async function createActiveSession(
  repo: InMemoryLeadSessionRepository,
  overrides: Partial<Omit<LeadSession, "id" | "started_at" | "closed_at">> = {},
): Promise<LeadSession> {
  return repo.create({
    lead_id: overrides.lead_id ?? crypto.randomUUID(),
    current_stage: overrides.current_stage ?? "nuevo",
    urgencia: overrides.urgencia ?? "media",
    consulta: overrides.consulta ?? "",
    producto_cotizado_id: overrides.producto_cotizado_id ?? null,
    codigo_interno: overrides.codigo_interno ?? null,
    precio_cotizado: overrides.precio_cotizado ?? null,
    cantidad: overrides.cantidad ?? null,
    bloqueador: overrides.bloqueador ?? null,
    comprobante_pago_url: overrides.comprobante_pago_url ?? null,
    metodo_pago: overrides.metodo_pago ?? null,
    resultado: overrides.resultado ?? null,
    motivo_perdida: overrides.motivo_perdida ?? null,
    ia_pausada: overrides.ia_pausada ?? false,
  });
}

describe("TwinExtractorService.extract", () => {
  let sessions: InMemoryLeadSessionRepository;
  let llm: FakeTwinExtractorLLM;
  let svc: DefaultTwinExtractorService;

  beforeEach(() => {
    sessions = new InMemoryLeadSessionRepository();
    llm = new FakeTwinExtractorLLM();
    svc = new DefaultTwinExtractorService(sessions, llm);
  });

  test("sesion no existe lanza error", async () => {
    await expect(
      svc.extract({ sessionId: "no-existe", conversationTurn: ["hola"] }),
    ).rejects.toThrow(/no encontrada/i);
    expect(llm.calls).toHaveLength(0);
  });

  test("sesion ya cerrada no llama LLM y retorna sesion sin cambios", async () => {
    const s = await createActiveSession(sessions);
    const closed = await sessions.close(s.id, { resultado: "exito" });

    const result = await svc.extract({ sessionId: s.id, conversationTurn: ["hola"] });

    expect(llm.calls).toHaveLength(0);
    expect(result).toEqual(closed);
  });

  test("patch parcial aplica update sin tocar resultado", async () => {
    const s = await createActiveSession(sessions, { current_stage: "nuevo" });
    llm.enqueue({
      current_stage: "cotizado",
      urgencia: "alta",
      precio_cotizado: 120,
    });

    const result = await svc.extract({ sessionId: s.id, conversationTurn: ["..."] });

    expect(result.current_stage).toBe("cotizado");
    expect(result.urgencia).toBe("alta");
    expect(result.precio_cotizado).toBe(120);
    expect(result.resultado).toBeNull();
  });

  test("patch vacio no toca sesion", async () => {
    const s = await createActiveSession(sessions, { current_stage: "negociando" });
    llm.enqueue({});

    const result = await svc.extract({ sessionId: s.id, conversationTurn: ["..."] });

    expect(result).toEqual(s);
  });

  // Cerrar una venta es una decisión humana y tiene una sola puerta: el rail
  // del Twin (decisión cerrada, `AGENTS.md §2`). El extractor propone.
  //
  // Esto no es teórico: en la primera conversación real el agente respondió "no
  // tenemos radiadores" —por un bug del catálogo— y el LLM devolvió
  // `resultado: perdido, motivo: stock`. El servicio cerró la sesión, la
  // conversación desapareció del Inbox, entró a la ventana de purga de 29 días
  // y las métricas contaron una pérdida por stock que nunca pasó.

  test("un resultado=exito del LLM NO cierra la sesión", async () => {
    const s = await createActiveSession(sessions, { current_stage: "esperando_pago" });
    llm.enqueue({ resultado: "exito" });

    const result = await svc.extract({ sessionId: s.id, conversationTurn: ["pagado"] });

    expect(result.resultado).toBeNull();
    expect(result.closed_at).toBeNull();
  });

  test("un resultado=perdido se guarda como propuesta, no como cierre", async () => {
    const s = await createActiveSession(sessions);
    llm.enqueue({ resultado: "perdido", motivo_perdida: "precio" });

    const result = await svc.extract({ sessionId: s.id, conversationTurn: ["caro"] });

    expect(result.resultado).toBeNull();
    expect(result.motivo_perdida).toBeNull();
    // Es lo que el popover del rail le ofrece a una persona para confirmar.
    expect(result.extras[CLAVE_MOTIVO_SUGERIDO]).toBe("precio");
  });

  test("el resto del patch se aplica igual aunque el resultado se descarte", async () => {
    const s = await createActiveSession(sessions);
    llm.enqueue({
      current_stage: "cerrado",
      precio_cotizado: 200,
      cantidad: 1,
      resultado: "exito",
    });

    const result = await svc.extract({ sessionId: s.id, conversationTurn: ["..."] });

    expect(result.current_stage).toBe("cerrado");
    expect(result.precio_cotizado).toBe(200);
    expect(result.cantidad).toBe(1);
    // La etapa puede llegar a `cerrado`; la SESIÓN sigue abierta hasta que
    // alguien la cierre. Son dos cosas distintas.
    expect(result.resultado).toBeNull();
    expect(result.closed_at).toBeNull();
  });

  test("un perdido sin motivo no inventa la propuesta", async () => {
    const s = await createActiveSession(sessions);
    llm.enqueue({ resultado: "perdido" });

    const result = await svc.extract({ sessionId: s.id, conversationTurn: ["..."] });

    expect(result.resultado).toBeNull();
    expect(result.extras[CLAVE_MOTIVO_SUGERIDO]).toBeUndefined();
  });

  test("LLM recibe current session + conversation turn", async () => {
    const s = await createActiveSession(sessions, { current_stage: "identificando" });
    llm.enqueue({});

    await svc.extract({
      sessionId: s.id,
      conversationTurn: ["lead: hola", "ia: hola"],
    });

    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].current.id).toBe(s.id);
    expect(llm.calls[0].current.current_stage).toBe("identificando");
    expect(llm.calls[0].conversationTurn).toEqual(["lead: hola", "ia: hola"]);
  });

  test("patch con campo invalido (no en LeadTwinUpdateSchema) es rechazado", async () => {
    const s = await createActiveSession(sessions);
    llm.enqueue({ current_stage: "valor-invalido" as never });

    await expect(svc.extract({ sessionId: s.id, conversationTurn: ["..."] })).rejects.toThrow();
  });

  test("patch puede setear bloqueador a string y luego limpiarlo con null", async () => {
    const s = await createActiveSession(sessions);
    llm.enqueue({ bloqueador: "espera comprobante" });
    const r1 = await svc.extract({ sessionId: s.id, conversationTurn: ["..."] });
    expect(r1.bloqueador).toBe("espera comprobante");

    llm.enqueue({ bloqueador: null });
    const r2 = await svc.extract({ sessionId: s.id, conversationTurn: ["..."] });
    expect(r2.bloqueador).toBeNull();
  });

  describe("lo que tocó una persona no se pisa", () => {
    const USER = "11111111-1111-4111-8111-111111111111";

    test("un campo corregido a mano sobrevive al turno siguiente", async () => {
      const s = await createActiveSession(sessions);
      await sessions.editarCampoTwin(s.id, "consulta", "lo que dijo el cliente", USER);
      llm.enqueue({ consulta: "lo que entendió el modelo" });

      const r = await svc.extract({ sessionId: s.id, conversationTurn: ["..."] });

      expect(r.consulta).toBe("lo que dijo el cliente");
    });

    test("la etapa puesta a mano sobrevive al turno siguiente", async () => {
      // Sin esto el rail clickeable del Twin sería mentira: el extractor
      // recalcula `current_stage` en cada turno y la etapa elegida a mano
      // duraría hasta el próximo mensaje del cliente.
      const s = await createActiveSession(sessions, { current_stage: "nuevo" });
      await sessions.moverEtapa(s.id, "negociando", USER);
      llm.enqueue({ current_stage: "identificando" });

      const r = await svc.extract({ sessionId: s.id, conversationTurn: ["..."] });

      expect(r.current_stage).toBe("negociando");
      expect(r.procedencia.current_stage?.por).toBe("humano");
    });

    test("la etapa bloqueada no frena el resto del patch", async () => {
      const s = await createActiveSession(sessions, { current_stage: "nuevo" });
      await sessions.moverEtapa(s.id, "cotizado", USER);
      llm.enqueue({ current_stage: "nuevo", urgencia: "alta", precio_cotizado: 90 });

      const r = await svc.extract({ sessionId: s.id, conversationTurn: ["..."] });

      expect(r.current_stage).toBe("cotizado");
      expect(r.urgencia).toBe("alta");
      expect(r.precio_cotizado).toBe(90);
    });

    test("la etapa que escribe el extractor queda marcada como ia y sí se puede pisar", async () => {
      const s = await createActiveSession(sessions, { current_stage: "nuevo" });
      llm.enqueue({ current_stage: "identificando" });
      const r1 = await svc.extract({ sessionId: s.id, conversationTurn: ["..."] });

      expect(r1.current_stage).toBe("identificando");
      expect(r1.procedencia.current_stage).toMatchObject({ por: "ia", valor_anterior: "nuevo" });

      llm.enqueue({ current_stage: "cotizado" });
      const r2 = await svc.extract({ sessionId: s.id, conversationTurn: ["..."] });

      expect(r2.current_stage).toBe("cotizado");
    });
  });
});
