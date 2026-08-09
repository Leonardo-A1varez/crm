import { generateText, stepCountIs, tool, type LanguageModel } from "ai";
import type { CostTracker } from "@/lib/observability/cost-tracker";
import type { Logger } from "@/lib/observability/logger";
import { withSpan } from "@/lib/observability/tracing";
import { BuscarRepuestoInputSchema } from "@/lib/validation/ai";
import { componerSystemPrompt } from "@/lib/agente/prompt";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import type { AgentConfigProvider } from "@/server/services/agente/config-provider";
import type {
  AgentLLM,
  AgentLLMInput,
  AgentLLMResult,
  ToolCallRecord,
} from "@/server/services/ai-agent.service";
import { recordLlmUsage } from "./cost-tracker-bridge";
import { OPENAI_PRICING } from "./pricing";

export interface OpenAiAgentConfig {
  /** El modelo concreto se elige por turno segun la config, no al construir. */
  provider: (modelo: string) => LanguageModel;
  configProvider: AgentConfigProvider;
  costTracker: CostTracker;
  logger?: Logger;
}

/**
 * OpenAI impl `AgentLLM`. Slice 1 sub-paso 7.5. Cablear el agente al provider
 * de config (Slice 1 sub-paso 7.8/Task 8): modelo y system prompt ya no se
 * resuelven al construir, se leen de `configProvider.get()` en cada turno.
 *
 * Usa `generateText` con tool `buscar_repuesto` que delega al
 * `AgentTools.buscar_repuesto` provisto por el caller (service consumidor
 * `DefaultAiAgentService` wrapea con audit + cost-tracking de la tool en sí).
 *
 * Tool loop limitado por `stopWhen: stepCountIs(config.max_pasos_tool)` —
 * evita runaway costs si LLM se queda llamando tools indefinidamente.
 *
 * Mapea `result.toolCalls` + `result.toolResults` join-by-toolCallId a
 * `ToolCallRecord[]` que devuelve al service consumidor (este los persiste
 * via tool_executions repo). Tool calls sin result (dynamic / approval
 * denied) son skipped.
 */
export class OpenAiAgentLLM implements AgentLLM {
  constructor(private readonly cfg: OpenAiAgentConfig) {}

  async generate(input: AgentLLMInput): Promise<AgentLLMResult> {
    const config = await this.cfg.configProvider.get();
    // La Server Action valida el modelo al guardar; si igual llega uno sin
    // pricing (dato viejo, edición manual en DB), caer al de fabrica es
    // mejor que no responder al cliente.
    const modelo = config.modelo in OPENAI_PRICING ? config.modelo : CONFIG_DE_FABRICA.modelo;
    if (modelo !== config.modelo) {
      this.cfg.logger?.error("agente.modelo_sin_pricing", { modelo: config.modelo });
    }

    const contextBlock = JSON.stringify(
      {
        intent_clasificado: input.classification.intent_nombre,
        confidence: input.classification.confidence,
        current_stage: input.session.current_stage,
        urgencia: input.session.urgencia,
        consulta_previa: input.session.consulta,
        vehiculo: {
          // Lead-level data viaja en el twin de la sesión via extras o consulta.
          // Acá lo dejamos a discreción del LLM extraer del turn.
        },
        context_summary: input.session.context_summary,
      },
      null,
      2,
    );

    const conversationText = input.conversationTurn
      .map((line, i) => `[${i + 1}] ${line}`)
      .join("\n");

    const result = await withSpan(
      "llm.ai-agent",
      { model: modelo, sessionId: input.session.id },
      () =>
        generateText({
          model: this.cfg.provider(modelo),
          system: componerSystemPrompt(config),
          prompt: [
            "Contexto:",
            contextBlock,
            "",
            "Último turno conversación:",
            conversationText,
            "",
            "Respondé al cliente (usá `buscar_repuesto` si necesitás chequear catálogo).",
          ].join("\n"),
          tools: {
            buscar_repuesto: tool({
              description:
                "Busca repuestos en catálogo por texto + filtros opcionales marca/modelo/año. Devuelve matches con precio + stock.",
              inputSchema: BuscarRepuestoInputSchema,
              execute: async (args) => input.tools.buscar_repuesto(args),
            }),
          },
          stopWhen: stepCountIs(config.max_pasos_tool),
        }),
    );

    await recordLlmUsage(this.cfg.costTracker, result, {
      model: modelo,
      workflow: "ai-agent",
      sessionId: input.session.id,
    });

    return {
      text: result.text,
      toolCalls: joinToolCallsWithResults(result.toolCalls, result.toolResults),
    };
  }
}

interface SdkToolCallLike {
  toolName: string;
  toolCallId: string;
  input?: unknown;
}

interface SdkToolResultLike {
  toolCallId: string;
  output?: unknown;
}

/**
 * Join SDK toolCalls + toolResults por toolCallId. Calls sin matching result
 * (dynamic, denied, error) son skipped del audit log (best-effort para no
 * romper service consumidor en edge cases).
 *
 * Exported para tests unitarios directos (el flujo end-to-end via
 * generateText con tools requiere integration test contra OpenAI real).
 */
export function joinToolCallsWithResults(
  toolCalls: readonly SdkToolCallLike[],
  toolResults: readonly SdkToolResultLike[],
): ToolCallRecord[] {
  const byId = new Map<string, unknown>();
  for (const r of toolResults) byId.set(r.toolCallId, r.output);

  const out: ToolCallRecord[] = [];
  for (const c of toolCalls) {
    const result = byId.get(c.toolCallId);
    if (result === undefined) continue;
    out.push({
      name: c.toolName,
      args: (c.input ?? {}) as Record<string, unknown>,
      result: result as Record<string, unknown>,
    });
  }
  return out;
}
