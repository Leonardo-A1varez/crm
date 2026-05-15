import { generateText, stepCountIs, tool, type LanguageModel } from "ai";
import type { CostTracker } from "@/lib/observability/cost-tracker";
import { BuscarRepuestoInputSchema } from "@/lib/validation/ai";
import type {
  AgentLLM,
  AgentLLMInput,
  AgentLLMResult,
  ToolCallRecord,
} from "@/server/services/ai-agent.service";
import { recordLlmUsage } from "./cost-tracker-bridge";

export interface OpenAiAgentConfig {
  model: LanguageModel;
  modelName: string;
  costTracker: CostTracker;
  /** Máx steps tool-call loop. Default 5 — pilot tier conversaciones cortas. */
  maxSteps?: number;
}

const DEFAULT_MAX_STEPS = 5;

const SYSTEM_PROMPT = [
  "Sos un vendedor IA experto en repuestos automotrices para LATAM (Argentina, Brasil, México, Chile, Colombia, Perú).",
  "Conversación informal, tuteás al cliente. Respuestas cortas (max 3-4 frases).",
  "Tu objetivo: identificar la pieza buscada + dar precio + cerrar venta o pasar a humano si no podés.",
  "Usás la tool `buscar_repuesto` para encontrar productos en el catálogo. NO inventes precios ni stock.",
  "Si la tool devuelve 0 matches, decí honestamente que no lo tenemos.",
  "El intent classification del último mensaje y el estado actual de la sesión te llegan como contexto.",
  "Si el cliente necesita algo que no podés resolver con la tool, sugerí handoff a vendedor humano.",
].join(" ");

/**
 * OpenAI impl `AgentLLM`. Slice 1 sub-paso 7.5.
 *
 * Usa `generateText` con tool `buscar_repuesto` que delega al
 * `AgentTools.buscar_repuesto` provisto por el caller (service consumidor
 * `DefaultAiAgentService` wrapea con audit + cost-tracking de la tool en sí).
 *
 * Tool loop limitado por `stopWhen: stepCountIs(maxSteps)` — evita runaway
 * costs si LLM se queda llamando tools indefinidamente.
 *
 * Mapea `result.toolCalls` + `result.toolResults` join-by-toolCallId a
 * `ToolCallRecord[]` que devuelve al service consumidor (este los persiste
 * via tool_executions repo). Tool calls sin result (dynamic / approval
 * denied) son skipped.
 */
export class OpenAiAgentLLM implements AgentLLM {
  private readonly maxSteps: number;

  constructor(private readonly cfg: OpenAiAgentConfig) {
    this.maxSteps = cfg.maxSteps ?? DEFAULT_MAX_STEPS;
  }

  async generate(input: AgentLLMInput): Promise<AgentLLMResult> {
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

    const result = await generateText({
      model: this.cfg.model,
      system: SYSTEM_PROMPT,
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
      stopWhen: stepCountIs(this.maxSteps),
    });

    await recordLlmUsage(this.cfg.costTracker, result, {
      model: this.cfg.modelName,
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
