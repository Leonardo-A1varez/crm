import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { UMBRAL_INTENTS_MAX, UMBRAL_INTENTS_MIN } from "@/lib/agente/escalado";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { HandoffDecision, IntentClassification } from "@/lib/validation/ai";
import { ConflictError, NotFoundError } from "@/lib/errors";
import {
  StaticAgentConfigProvider,
  type AgentConfigProvider,
} from "@/server/services/agente/config-provider";
import type { LeadSession, UUID } from "@/types/entities";

/**
 * El umbral cuando nadie pasó uno. Sale de la config de fábrica (2, §4.2) y
 * ya no es un literal: antes era 3, un número que solo se podía cambiar
 * editando este archivo. El 2 es también el DEFAULT de la columna
 * `escalar_umbral_intents`, así que la decisión es la misma haya o no config.
 */
const UMBRAL_DE_FABRICA = CONFIG_DE_FABRICA.escalar_umbral_intents;

export interface AutoHandoffInput {
  recentClassifications: IntentClassification[];
  /** Umbral explícito. Sin él, el de fábrica. */
  threshold?: number;
}

export interface HandoffService {
  pause(sessionId: UUID, motivo: string): Promise<LeadSession>;
  resume(sessionId: UUID): Promise<LeadSession>;
  evaluate(input: AutoHandoffInput): HandoffDecision;
  /**
   * Igual que `evaluate`, pero tomando el umbral de la config activa en vez
   * del de fábrica. Es async porque leer la config lo es; `evaluate` queda
   * sincrónico para que la decisión siga siendo testeable sin config y para
   * no obligar a cada llamador a volverse async.
   */
  evaluateConConfig(input: AutoHandoffInput): Promise<HandoffDecision>;
}

/**
 * Recorta a lo que admite el CHECK `agente_config_umbral_intents_rango`. Una
 * fila escrita a mano fuera de rango no puede dejar el auto-handoff
 * desactivado de hecho (umbral 0 pausaría todo; 99 no pausaría nunca).
 */
function acotarUmbral(valor: number): number {
  if (!Number.isFinite(valor)) return UMBRAL_DE_FABRICA;
  return Math.min(UMBRAL_INTENTS_MAX, Math.max(UMBRAL_INTENTS_MIN, Math.trunc(valor)));
}

export class DefaultHandoffService implements HandoffService {
  private readonly config: AgentConfigProvider;

  constructor(
    private readonly sessions: LeadSessionRepository,
    config?: AgentConfigProvider,
  ) {
    // Sin provider el servicio sigue siendo usable (el panel de Bandeja solo
    // llama pause/resume) y `evaluateConConfig` devuelve lo mismo que
    // `evaluate`, en vez de fallar por una dependencia que ese caso no usa.
    this.config = config ?? new StaticAgentConfigProvider(CONFIG_DE_FABRICA);
  }

  async pause(sessionId: UUID, _motivo: string): Promise<LeadSession> {
    const current = await this.requireOpen(sessionId);
    if (current.ia_pausada) return current;
    return this.sessions.update(sessionId, { ia_pausada: true });
  }

  async resume(sessionId: UUID): Promise<LeadSession> {
    const current = await this.requireOpen(sessionId);
    if (!current.ia_pausada) return current;
    return this.sessions.update(sessionId, { ia_pausada: false });
  }

  evaluate(input: AutoHandoffInput): HandoffDecision {
    const threshold = acotarUmbral(input.threshold ?? UMBRAL_DE_FABRICA);
    const arr = input.recentClassifications;
    if (arr.length < threshold) {
      return { pausar_ia: false, motivo: "" };
    }
    const tail = arr.slice(-threshold);
    const allUnknown = tail.every((c) => c.intent_nombre === null);
    if (!allUnknown) {
      return { pausar_ia: false, motivo: "" };
    }
    return {
      pausar_ia: true,
      motivo: `${threshold} intents desconocidos consecutivos`,
    };
  }

  async evaluateConConfig(input: AutoHandoffInput): Promise<HandoffDecision> {
    // Un umbral explícito gana: si el llamador lo mandó, sabe algo que la
    // config no.
    if (input.threshold !== undefined) return this.evaluate(input);
    const { escalar_umbral_intents } = await this.config.get();
    return this.evaluate({ ...input, threshold: escalar_umbral_intents });
  }

  private async requireOpen(sessionId: UUID): Promise<LeadSession> {
    const s = await this.sessions.findById(sessionId);
    if (!s)
      throw new NotFoundError(`sesión no encontrada: ${sessionId}`, "lead_session", sessionId);
    if (s.resultado !== null)
      throw new ConflictError(`sesión cerrada: ${sessionId}`, "session_closed");
    return s;
  }
}
