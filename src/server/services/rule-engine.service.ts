import type { IntentsRepository } from "@/server/repositories/intents.repo";
import type { ReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.repo";
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
  /**
   * Las etiquetas que corresponden a este turno. Puede ser ninguna.
   *
   * A diferencia de `match`, devuelve **todas** las reglas que matchean y no la
   * primera: no compiten por el único lugar de la respuesta, así que un mismo
   * mensaje puede dejar dos etiquetas. Y no corta nada — el turno sigue su
   * curso, conteste una regla enlatada o conteste el LLM.
   */
  etiquetasPara(input: RuleMatchInput): Promise<UUID[]>;
}

export class DefaultRuleEngineService implements RuleEngineService {
  constructor(
    private readonly intents: IntentsRepository,
    private readonly rules: RulesRepository,
    private readonly reglasEtiqueta: ReglasEtiquetaRepository,
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

  async etiquetasPara(input: RuleMatchInput): Promise<UUID[]> {
    if (input.intent_nombre === null) return [];

    const intent = await this.intents.findByNombre(input.intent_nombre);
    if (!intent || !intent.activo) return [];

    const candidatas = await this.reglasEtiqueta.listActiveByIntent(intent.id);
    const out: UUID[] = [];
    for (const r of candidatas) {
      // Sin `break`: todas las que cumplan aportan su etiqueta.
      if (matchesCondiciones(r.condiciones_extra, input.context)) out.push(r.tag_id);
    }
    return out;
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
