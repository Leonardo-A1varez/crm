import { describe, expect, test, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModel } from "ai";
import { InMemoryCostTracker, type CostTracker } from "@/lib/observability/cost-tracker";
import { OpenAiAgentLLM, joinToolCallsWithResults } from "@/server/services/llm/openai-ai-agent";
import { OPENAI_PRICING } from "@/server/services/llm/pricing";
import {
  StaticAgentConfigProvider,
  type AgentConfigProvider,
} from "@/server/services/agente/config-provider";
import { componerSystemPrompt } from "@/lib/agente/prompt";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import type { AgentLLMInput, AgentTools } from "@/server/services/ai-agent.service";
import type { LeadSession } from "@/types/entities";

function makeTracker() {
  return new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 10 });
}

function rawTextResult(text: string, usage = { input: 300, output: 150 }) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: {
      inputTokens: {
        total: usage.input,
        noCache: usage.input,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: usage.output, text: usage.output, reasoning: undefined },
    },
    warnings: [],
  };
}

function rawToolCallResult(
  toolCallId: string,
  toolName: string,
  input: unknown,
  usage = { input: 300, output: 100 },
) {
  return {
    content: [
      {
        type: "tool-call" as const,
        toolCallId,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls" as const, raw: undefined },
    usage: {
      inputTokens: {
        total: usage.input,
        noCache: usage.input,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: usage.output, text: usage.output, reasoning: undefined },
    },
    warnings: [],
  };
}

const baseSession: LeadSession = {
  id: "00000000-0000-0000-0000-000000000001",
  lead_id: "00000000-0000-0000-0000-000000000002",
  current_stage: "identificando",
  urgencia: "media",
  consulta: "pastilla de freno",
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
  extras: {},
  context_summary: null,
  started_at: new Date(),
  closed_at: null,
};

const baseInput: AgentLLMInput = {
  session: baseSession,
  conversationTurn: ["lead: cuanto sale pastilla freno corolla 2015"],
  classification: { intent_nombre: "consulta_precio", confidence: 0.9 },
  tools: {
    buscar_repuesto: vi.fn(),
  } as unknown as AgentTools,
};

/** Input descartable para tests que no versan sobre el contenido del turno. */
function agentInputFalso(): AgentLLMInput {
  return {
    session: baseSession,
    conversationTurn: ["lead: cuanto sale pastilla freno corolla 2015"],
    classification: { intent_nombre: "consulta_precio", confidence: 0.9 },
    tools: { buscar_repuesto: vi.fn() } as unknown as AgentTools,
  };
}

/** Tipo exacto que acepta `MockLanguageModelV3` una vez construido: solo la función. */
type MockDoGenerate = InstanceType<typeof MockLanguageModelV3>["doGenerate"];

/**
 * Arma un `OpenAiAgentLLM` de test. `provider` crea un `MockLanguageModelV3`
 * nuevo por cada `modelo` pedido (uno por turno, como hace el real), lo que
 * deja verificar que el nombre que llega a `doGenerate` es el de la config
 * vigente y no uno fijo resuelto al construir.
 */
function makeAgentLLM(
  opts: {
    configProvider?: AgentConfigProvider;
    costTracker?: CostTracker;
    onModelo?: (modelo: string) => void;
    onGenerate?: (args: { system?: string }) => void;
    doGenerate?: MockDoGenerate;
  } = {},
): OpenAiAgentLLM {
  const provider = (modelo: string): LanguageModel => {
    opts.onModelo?.(modelo);
    if (opts.doGenerate) {
      return new MockLanguageModelV3({ modelId: modelo, doGenerate: opts.doGenerate });
    }
    return new MockLanguageModelV3({
      modelId: modelo,
      doGenerate: async (options) => {
        const systemMsg = options.prompt.find((m) => m.role === "system");
        opts.onGenerate?.({
          system: systemMsg && systemMsg.role === "system" ? systemMsg.content : undefined,
        });
        return rawTextResult("ok");
      },
    });
  };

  return new OpenAiAgentLLM({
    provider,
    configProvider: opts.configProvider ?? new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
    costTracker: opts.costTracker ?? makeTracker(),
  });
}

describe("OpenAiAgentLLM", () => {
  test("generate sin tool calls devuelve text + toolCalls=[]", async () => {
    const tracker = makeTracker();
    const llm = makeAgentLLM({
      costTracker: tracker,
      doGenerate: async () => rawTextResult("Bienvenido, ¿qué necesitás?"),
    });

    const result = await llm.generate(baseInput);
    expect(result.text).toBe("Bienvenido, ¿qué necesitás?");
    expect(result.toolCalls).toEqual([]);
  });

  test("joinToolCallsWithResults mapea SDK pairs a ToolCallRecord[]", () => {
    const out = joinToolCallsWithResults(
      [
        { toolCallId: "c1", toolName: "buscar_repuesto", input: { query: "pastilla" } },
        { toolCallId: "c2", toolName: "buscar_repuesto", input: { query: "amortiguador" } },
      ],
      [
        { toolCallId: "c1", output: { matches: [], count: 0 } },
        { toolCallId: "c2", output: { matches: [{ id: "x" }], count: 1 } },
      ],
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      name: "buscar_repuesto",
      args: { query: "pastilla" },
      result: { matches: [], count: 0 },
    });
    expect(out[1]?.result).toEqual({ matches: [{ id: "x" }], count: 1 });
  });

  test("joinToolCallsWithResults skipea call sin matching result", () => {
    const out = joinToolCallsWithResults(
      [
        { toolCallId: "c1", toolName: "x", input: {} },
        { toolCallId: "c2-orphan", toolName: "y", input: {} },
      ],
      [{ toolCallId: "c1", output: { ok: true } }],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("x");
  });

  test("joinToolCallsWithResults maneja args undefined → {}", () => {
    const out = joinToolCallsWithResults(
      [{ toolCallId: "c1", toolName: "x" }],
      [{ toolCallId: "c1", output: { ok: true } }],
    );
    expect(out[0]?.args).toEqual({});
  });

  test("generate registra usage tokens en CostTracker con sessionId", async () => {
    const tracker = makeTracker();
    const llm = makeAgentLLM({
      costTracker: tracker,
      doGenerate: async () => rawTextResult("ok", { input: 1_000_000, output: 500_000 }),
    });

    await llm.generate(baseInput);
    // gpt-4o-mini (config de fabrica): 0.15 + 0.30 = 0.45 USD (un solo step)
    const spend = await tracker.getDailySpendUsd();
    expect(spend).toBeCloseTo(0.45, 5);
  });

  test("generate respeta max_pasos_tool de la config (no loop infinito en tool chain)", async () => {
    const tracker = makeTracker();
    const buscarMock = vi.fn().mockResolvedValue({ matches: [], count: 0 });

    // Mock devuelve tool-call siempre → SDK debería parar tras max_pasos_tool.
    let callCount = 0;
    const llm = makeAgentLLM({
      costTracker: tracker,
      configProvider: new StaticAgentConfigProvider({ ...CONFIG_DE_FABRICA, max_pasos_tool: 2 }),
      doGenerate: async () => {
        callCount++;
        return rawToolCallResult(`call-${callCount}`, "buscar_repuesto", { query: "x" });
      },
    });

    await llm.generate({ ...baseInput, tools: { buscar_repuesto: buscarMock } });
    // SDK debe parar en max_pasos_tool=2 (no llamar más de 2 veces doGenerate).
    expect(callCount).toBeLessThanOrEqual(2);
  });
});

describe("config en runtime", () => {
  test("usa el modelo que devuelve el provider, no uno fijo", async () => {
    const capturado: { modelo?: string } = {};
    const llm = makeAgentLLM({
      configProvider: new StaticAgentConfigProvider({
        ...CONFIG_DE_FABRICA,
        modelo: "gpt-4.1-mini",
      }),
      onModelo: (nombre: string) => {
        capturado.modelo = nombre;
      },
    });
    await llm.generate(agentInputFalso());
    expect(capturado.modelo).toBe("gpt-4.1-mini");
  });

  test("consulta el provider en CADA generate, no una sola vez", async () => {
    const provider = new StaticAgentConfigProvider(CONFIG_DE_FABRICA);
    const spy = vi.spyOn(provider, "get");
    const llm = makeAgentLLM({ configProvider: provider });
    await llm.generate(agentInputFalso());
    await llm.generate(agentInputFalso());
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test("el system prompt sale de componerSystemPrompt con la config vigente", async () => {
    const valores = { ...CONFIG_DE_FABRICA, instrucciones: "Solo vendemos Toyota." };
    const capturado: { system?: string } = {};
    const llm = makeAgentLLM({
      configProvider: new StaticAgentConfigProvider(valores),
      onGenerate: (args: { system?: string }) => {
        capturado.system = args.system;
      },
    });
    await llm.generate(agentInputFalso());
    expect(capturado.system).toBe(componerSystemPrompt(valores));
    expect(capturado.system).toContain("REGLAS INVIOLABLES");
  });

  test("recordLlmUsage registra el modelo de la config, no el de bootstrap", async () => {
    const tracker = new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 10 });
    const spy = vi.spyOn(tracker, "record");
    const llm = makeAgentLLM({
      configProvider: new StaticAgentConfigProvider({ ...CONFIG_DE_FABRICA, modelo: "gpt-4o" }),
      costTracker: tracker,
    });
    await llm.generate(agentInputFalso());
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ model: "gpt-4o" });
  });

  test("modelo sin pricing en la config no tumba el turno", async () => {
    // La Server Action valida al guardar. Si igual llega uno invalido, responder
    // con el de fabrica es mejor que no responder.
    const llm = makeAgentLLM({
      configProvider: new StaticAgentConfigProvider({ ...CONFIG_DE_FABRICA, modelo: "no-existe" }),
    });
    await expect(llm.generate(agentInputFalso())).resolves.toBeDefined();
  });
});
