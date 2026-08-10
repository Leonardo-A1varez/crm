import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { RuleEngineService } from "@/server/services/rule-engine.service";
import type { CatalogMatcherService } from "@/server/services/catalog-matcher.service";
import {
  NoopToolExecutionsRepository,
  type ToolExecutionsRepository,
} from "@/server/repositories/tool-executions.repo";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { AllEnabledFeatureFlags, FLAGS, type FeatureFlags } from "@/lib/feature-flags";
import type { RespuestaTipo } from "@/types/domain";
import type { LeadSession, UUID } from "@/types/entities";
import type {
  BuscarRepuestoInput,
  BuscarRepuestoOutput,
  IntentClassification,
} from "@/lib/validation/ai";

export interface AgentTurnInput {
  leadSessionId: UUID;
  conversationTurn: string[];
  classification: IntentClassification;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface AgentTurnResult {
  source: "rule" | "llm" | "handoff";
  respuesta_tipo: RespuestaTipo;
  respuesta_contenido: string;
  regla_id?: UUID;
  /** Intent que disparo la regla. Va junto con `regla_id` para poder auditar. */
  intent_id?: UUID;
  tool_calls?: ToolCallRecord[];
}

export interface AgentTools {
  buscar_repuesto(input: BuscarRepuestoInput): Promise<BuscarRepuestoOutput>;
}

export interface AgentLLMInput {
  session: LeadSession;
  conversationTurn: string[];
  classification: IntentClassification;
  tools: AgentTools;
}

export interface AgentLLMResult {
  text: string;
  toolCalls: ToolCallRecord[];
}

export interface AgentLLM {
  generate(input: AgentLLMInput): Promise<AgentLLMResult>;
}

export interface AiAgentService {
  respond(input: AgentTurnInput): Promise<AgentTurnResult>;
}

export class DefaultAiAgentService implements AiAgentService {
  constructor(
    private readonly sessions: LeadSessionRepository,
    private readonly rules: RuleEngineService,
    private readonly catalog: CatalogMatcherService,
    private readonly llm: AgentLLM,
    private readonly flags: FeatureFlags = new AllEnabledFeatureFlags(),
    private readonly toolExecutions: ToolExecutionsRepository = new NoopToolExecutionsRepository(),
  ) {}

  async respond(input: AgentTurnInput): Promise<AgentTurnResult> {
    const session = await this.sessions.findById(input.leadSessionId);
    if (!session)
      throw new NotFoundError(
        `sesión no encontrada: ${input.leadSessionId}`,
        "lead_session",
        input.leadSessionId,
      );
    if (session.resultado !== null)
      throw new ConflictError(`sesión cerrada: ${session.id}`, "session_closed");

    if (session.ia_pausada) {
      return {
        source: "handoff",
        respuesta_tipo: "handoff",
        respuesta_contenido: "IA pausada manualmente",
      };
    }

    if (!(await this.flags.isEnabled(FLAGS.AI_AGENT_ENABLED))) {
      return {
        source: "handoff",
        respuesta_tipo: "handoff",
        respuesta_contenido: "IA desactivada por flag",
      };
    }

    const ruleMatch = await this.rules.match({
      intent_nombre: input.classification.intent_nombre,
      context: { current_stage: session.current_stage, urgencia: session.urgencia },
    });

    if (ruleMatch) {
      return {
        source: ruleMatch.respuesta_tipo === "handoff" ? "handoff" : "rule",
        respuesta_tipo: ruleMatch.respuesta_tipo,
        respuesta_contenido: ruleMatch.respuesta_contenido,
        regla_id: ruleMatch.regla_id,
        intent_id: ruleMatch.intent_id,
      };
    }

    const tools: AgentTools = {
      buscar_repuesto: (toolInput) =>
        this.invokeWithAudit("buscar_repuesto", session.id, toolInput, () =>
          this.catalog.buscar(toolInput),
        ),
    };

    const result = await this.llm.generate({
      session,
      conversationTurn: input.conversationTurn,
      classification: input.classification,
      tools,
    });

    return {
      source: "llm",
      respuesta_tipo: "text",
      respuesta_contenido: result.text,
      tool_calls: result.toolCalls,
    };
  }

  // Wrap tool call con timing + audit. Persiste resultado o error en tool_executions.
  // Si tool throws, persiste error y re-throws (LLM upstream maneja).
  private async invokeWithAudit<
    TArgs extends Record<string, unknown>,
    TResult extends Record<string, unknown>,
  >(toolName: string, sessionId: UUID, args: TArgs, fn: () => Promise<TResult>): Promise<TResult> {
    const start = Date.now();
    let resultPayload: Record<string, unknown> | null = null;
    let errorMessage: string | null = null;
    try {
      const result = await fn();
      resultPayload = result as Record<string, unknown>;
      return result;
    } catch (e) {
      errorMessage = (e as Error).message;
      throw e;
    } finally {
      await this.toolExecutions.create({
        lead_session_id: sessionId,
        mensaje_id: null,
        tool_name: toolName,
        args: args as Record<string, unknown>,
        result: resultPayload,
        error: errorMessage,
        duration_ms: Date.now() - start,
      });
    }
  }
}
