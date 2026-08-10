import { describe, expect, test } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { InMemoryCostTracker } from "@/lib/observability/cost-tracker";
import { OpenAiTwinExtractorLLM } from "@/server/services/llm/openai-twin-extractor";
import { OPENAI_PRICING } from "@/server/services/llm/pricing";
import type { LeadSession } from "@/types/entities";

const MODEL_NAME = "gpt-4o-mini";

function makeTracker() {
  return new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 10 });
}

function makeMockModel(jsonObject: object, usage = { input: 200, output: 100 }) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(jsonObject) }],
      finishReason: { unified: "stop", raw: undefined },
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
    }),
  });
}

const baseSession: LeadSession = {
  id: "00000000-0000-0000-0000-000000000001",
  lead_id: "00000000-0000-0000-0000-000000000002",
  current_stage: "nuevo",
  etapa_alcanzada: "nuevo",
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
  extras: {},
  context_summary: null,
  procedencia: {},
  updated_at: new Date(),
  started_at: new Date(),
  closed_at: null,
};

describe("OpenAiTwinExtractorLLM", () => {
  test("extract devuelve patch parseado desde JSON del LLM", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiTwinExtractorLLM({
      model: makeMockModel({
        current_stage: "cotizado",
        precio_cotizado: 150000,
        extras: { marca_preferida: "OEM" },
      }),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });

    const result = await llm.extract({
      current: baseSession,
      conversationTurn: ["lead: necesito pastillas", "ia: $150.000 OEM disponible"],
    });

    expect(result.current_stage).toBe("cotizado");
    expect(result.precio_cotizado).toBe(150000);
    expect(result.extras).toEqual({ marca_preferida: "OEM" });
  });

  test("extract permite patch vacío (sesión sin cambios detectados)", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiTwinExtractorLLM({
      model: makeMockModel({}),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });
    const result = await llm.extract({
      current: baseSession,
      conversationTurn: ["lead: hola"],
    });
    expect(result).toEqual({});
  });

  test("extract con resultado=perdido + motivo_perdida persiste close-trigger", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiTwinExtractorLLM({
      model: makeMockModel({ resultado: "perdido", motivo_perdida: "precio" }),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });
    const result = await llm.extract({
      current: baseSession,
      conversationTurn: ["lead: muy caro, busco otro"],
    });
    expect(result.resultado).toBe("perdido");
    expect(result.motivo_perdida).toBe("precio");
  });

  test("extract registra usage tokens en CostTracker con sessionId", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiTwinExtractorLLM({
      model: makeMockModel({}, { input: 2_000_000, output: 1_000_000 }),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });

    await llm.extract({ current: baseSession, conversationTurn: ["lead: x"] });
    // gpt-4o-mini: 0.30 + 0.60 = 0.90 USD
    const spend = await tracker.getDailySpendUsd();
    expect(spend).toBeCloseTo(0.9, 5);
  });

  test("extract throws si LLM devuelve schema inválido", async () => {
    const tracker = makeTracker();
    const llm = new OpenAiTwinExtractorLLM({
      // current_stage enum violation
      model: makeMockModel({ current_stage: "invalid_stage" }),
      modelName: MODEL_NAME,
      costTracker: tracker,
    });
    await expect(llm.extract({ current: baseSession, conversationTurn: ["x"] })).rejects.toThrow();
  });
});
