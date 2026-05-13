import type { IntentsRepository } from "@/server/repositories/intents.repo";
import type { RulesRepository } from "@/server/repositories/rules.repo";
import type { RespuestaTipo } from "@/types/domain";
import type { UUID } from "@/types/entities";

export interface RuleMatchInput {
  intent_nombre: string | null;
  context: Record<string, unknown>;
}

export interface RuleMatchResult {
  regla_id: UUID;
  intent_id: UUID;
  respuesta_tipo: RespuestaTipo;
  respuesta_contenido: string;
}

export interface RuleEngineService {
  match(input: RuleMatchInput): Promise<RuleMatchResult | null>;
}

export class DefaultRuleEngineService implements RuleEngineService {
  constructor(
    private readonly intents: IntentsRepository,
    private readonly rules: RulesRepository,
  ) {}

  async match(input: RuleMatchInput): Promise<RuleMatchResult | null> {
    if (input.intent_nombre === null) return null;

    const intent = await this.intents.findByNombre(input.intent_nombre);
    if (!intent || !intent.activo) return null;

    const candidates = await this.rules.listActiveByIntent(intent.id);
    for (const r of candidates) {
      if (matchesCondiciones(r.condiciones_extra, input.context)) {
        return {
          regla_id: r.id,
          intent_id: intent.id,
          respuesta_tipo: r.respuesta_tipo,
          respuesta_contenido: r.respuesta_contenido,
        };
      }
    }
    return null;
  }
}

function matchesCondiciones(
  condiciones: Record<string, unknown> | null,
  context: Record<string, unknown>,
): boolean {
  if (condiciones === null) return true;
  for (const [key, expected] of Object.entries(condiciones)) {
    if (!deepEqual(expected, context[key])) return false;
  }
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return false;
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!deepEqual(aObj[k], bObj[k])) return false;
  }
  return true;
}
