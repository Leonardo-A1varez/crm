import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemoryToolExecutionsRepository } from "@/server/repositories/tool-executions.repo";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { DefaultAiAgentService } from "@/server/services/ai-agent.service";
import { AllEnabledFeatureFlags } from "@/lib/feature-flags";
import { FakeAgentLLM } from "../mocks/llm";
import type { IntentClassification } from "@/lib/validation/ai";
import type { LeadSession } from "@/types/entities";
import { InMemoryReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.repo";

function cls(n: string | null): IntentClassification {
  return { intent_nombre: n, confidence: n ? 0.9 : 0 };
}

async function seedSession(repo: InMemoryLeadSessionRepository): Promise<LeadSession> {
  return repo.create({
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
}

describe("ai-agent tool execution audit", () => {
  let sessions: InMemoryLeadSessionRepository;
  let intents: InMemoryIntentsRepository;
  let rules: InMemoryRulesRepository;
  let productos: InMemoryProductsRepository;
  let toolExecutions: InMemoryToolExecutionsRepository;
  let llm: FakeAgentLLM;
  let svc: DefaultAiAgentService;

  beforeEach(() => {
    sessions = new InMemoryLeadSessionRepository();
    intents = new InMemoryIntentsRepository();
    rules = new InMemoryRulesRepository();
    productos = new InMemoryProductsRepository();
    toolExecutions = new InMemoryToolExecutionsRepository();
    llm = new FakeAgentLLM();
    svc = new DefaultAiAgentService(
      sessions,
      new DefaultRuleEngineService(intents, rules, new InMemoryReglasEtiquetaRepository()),
      new DefaultCatalogMatcherService(productos),
      llm,
      new AllEnabledFeatureFlags(),
      toolExecutions,
    );
  });

  test("invocación tool persiste row con args+result+duration", async () => {
    const s = await seedSession(sessions);
    await productos.create({
      codigo_interno: "PAS-001",
      sku_proveedor: null,
      nombre: "Pastilla",
      descripcion: null,
      categoria: null,
      compatibilidad: [],
      precio: 50,
      stock: 5,
      imagen_url: null,
      activo: true,
    });

    llm.enqueue(async (input) => {
      const out = await input.tools.buscar_repuesto({ query: "PAS-001" });
      return {
        text: `${out.count} match`,
        toolCalls: [
          {
            name: "buscar_repuesto",
            args: { query: "PAS-001" },
            result: out as unknown as Record<string, unknown>,
          },
        ],
      };
    });

    await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["tienes PAS-001?"],
      classification: cls(null),
    });

    const rows = await toolExecutions.listBySession(s.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].tool_name).toBe("buscar_repuesto");
    expect(rows[0].args).toEqual({ query: "PAS-001" });
    expect(rows[0].result).toBeTruthy();
    expect((rows[0].result as { count: number }).count).toBe(1);
    expect(rows[0].error).toBeNull();
    expect(rows[0].duration_ms).toBeGreaterThanOrEqual(0);
    expect(rows[0].lead_session_id).toBe(s.id);
    // Sin `mensajeOrigenId` no hay ancla que guardar: es el caller sin mensaje
    // detrás (el preview de la consola), no un turno del pipeline.
    expect(rows[0].mensaje_id).toBeNull();
  });

  test("la fila queda atada al entrante que abrió el turno", async () => {
    const s = await seedSession(sessions);
    const mensajeOrigenId = crypto.randomUUID();

    llm.enqueue(async (input) => {
      await input.tools.buscar_repuesto({ query: "PAS-001" });
      return { text: "ok", toolCalls: [] };
    });

    await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["tienes PAS-001?"],
      classification: cls(null),
      mensajeOrigenId,
    });

    const rows = await toolExecutions.listBySession(s.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].mensaje_id).toBe(mensajeOrigenId);
  });

  test("la herramienta que falla también queda atada al entrante", async () => {
    const s = await seedSession(sessions);
    const mensajeOrigenId = crypto.randomUUID();
    const failingCatalog = {
      async buscar() {
        throw new Error("catalog crash");
      },
    };
    const failingSvc = new DefaultAiAgentService(
      sessions,
      new DefaultRuleEngineService(intents, rules, new InMemoryReglasEtiquetaRepository()),
      failingCatalog as unknown as DefaultCatalogMatcherService,
      llm,
      new AllEnabledFeatureFlags(),
      toolExecutions,
    );

    llm.enqueue(async (input) => {
      try {
        await input.tools.buscar_repuesto({ query: "x" });
      } catch {
        // El agente sigue sin catálogo; la fila de auditoría ya se escribió.
      }
      return { text: "fallback", toolCalls: [] };
    });

    await failingSvc.respond({
      leadSessionId: s.id,
      conversationTurn: ["x"],
      classification: cls(null),
      mensajeOrigenId,
    });

    const rows = await toolExecutions.listBySession(s.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].mensaje_id).toBe(mensajeOrigenId);
    expect(rows[0].error).toBe("catalog crash");
  });

  test("multiples tool calls misma respond persisten N rows", async () => {
    const s = await seedSession(sessions);

    llm.enqueue(async (input) => {
      await input.tools.buscar_repuesto({ query: "uno" });
      await input.tools.buscar_repuesto({ query: "dos" });
      return { text: "ok", toolCalls: [] };
    });

    await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["x"],
      classification: cls(null),
    });

    const rows = await toolExecutions.listBySession(s.id);
    expect(rows).toHaveLength(2);
    const args = rows.map((r) => (r.args as { query: string }).query).sort();
    expect(args).toEqual(["dos", "uno"]);
  });

  test("tool error vía wrapper persiste error field", async () => {
    const s = await seedSession(sessions);

    // Inject failing catalog vía mock interna que throws
    const failingCatalog = {
      async buscar() {
        throw new Error("catalog crash");
      },
    };
    const failingSvc = new DefaultAiAgentService(
      sessions,
      new DefaultRuleEngineService(intents, rules, new InMemoryReglasEtiquetaRepository()),
      failingCatalog as unknown as DefaultCatalogMatcherService,
      llm,
      new AllEnabledFeatureFlags(),
      toolExecutions,
    );

    llm.enqueue(async (input) => {
      try {
        await input.tools.buscar_repuesto({ query: "x" });
        return { text: "ok", toolCalls: [] };
      } catch {
        return { text: "fallback sin catalog", toolCalls: [] };
      }
    });

    await failingSvc.respond({
      leadSessionId: s.id,
      conversationTurn: ["x"],
      classification: cls(null),
    });

    const rows = await toolExecutions.listBySession(s.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].error).toBe("catalog crash");
    expect(rows[0].result).toBeNull();
  });

  test("rule match (no LLM) NO genera tool_executions", async () => {
    const s = await seedSession(sessions);
    const intent = await intents.create({
      nombre: "saludo",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    await rules.create({
      intent_id: intent.id,
      condiciones_extra: null,
      respuesta_tipo: "text",
      respuesta_contenido: "Hola!",
      prioridad: 0,
      activa: true,
    });

    await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["hola"],
      classification: cls("saludo"),
    });

    const rows = await toolExecutions.listBySession(s.id);
    expect(rows).toHaveLength(0);
  });

  test("LLM sin tool calls NO genera tool_executions", async () => {
    const s = await seedSession(sessions);
    llm.enqueueText("respuesta sin tool");

    await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["x"],
      classification: cls(null),
    });

    expect(await toolExecutions.listBySession(s.id)).toEqual([]);
  });
});
