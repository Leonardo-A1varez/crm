import { describe, expect, test, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { InMemoryCostTracker } from "@/lib/observability/cost-tracker";
import { OpenAiAgentLLM, joinToolCallsWithResults } from "@/server/services/llm/openai-ai-agent";
import { OPENAI_PRICING } from "@/server/services/llm/pricing";
import type { AgentLLMInput, AgentTools } from "@/server/services/ai-agent.service";
import type { LeadSession } from "@/types/entities";

const MODEL_NAME = "gpt-4o-mini";

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

describe("OpenAiAgentLLM", () => {
  test("generate sin tool calls devuelve text + toolCalls=[]", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiAgentLLM({
      model: new MockLanguageModelV3({
        doGenerate: async () => rawTextResult("Bienvenido, ¿qué necesitás?"),
      }),
      modelName: MODEL_NAME,
      costTracker: tracker,
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
    const llm = new OpenAiAgentLLM({
      model: new MockLanguageModelV3({
        doGenerate: async () => rawTextResult("ok", { input: 1_000_000, output: 500_000 }),
      }),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });

    await llm.generate(baseInput);
    // gpt-4o-mini: 0.15 + 0.30 = 0.45 USD (un solo step)
    const spend = await tracker.getDailySpendUsd();
    expect(spend).toBeCloseTo(0.45, 5);
  });

  test("generate respeta maxSteps (no loop infinito en tool chain)", async () => {
    const tracker = makeTracker();
    const buscarMock = vi.fn().mockResolvedValue({ matches: [], count: 0 });

    // Mock devuelve tool-call siempre → SDK debería parar tras maxSteps.
    let callCount = 0;
    const llm = new OpenAiAgentLLM({
      model: new MockLanguageModelV3({
        doGenerate: async () => {
          callCount++;
          return rawToolCallResult(`call-${callCount}`, "buscar_repuesto", { query: "x" });
        },
      }),
      modelName: MODEL_NAME,
      costTracker: tracker,
      maxSteps: 2,
    });

    await llm.generate({ ...baseInput, tools: { buscar_repuesto: buscarMock } });
    // SDK debe parar en maxSteps=2 (no llamar más de 2 veces doGenerate).
    expect(callCount).toBeLessThanOrEqual(2);
  });
});
