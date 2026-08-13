import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import type { Logger } from "@/lib/observability/logger";
import type { AgenteConfigRepository } from "@/server/repositories/agente-config.repo";
import type { AgenteConfigValores } from "@/types/agente";

/**
 * 30 s de staleness maxima. Es un compromiso explicito entre carga y frescura,
 * y la UI tiene que decirlo ("los cambios se aplican en menos de un minuto").
 * En serverless cada instancia cachea por separado y no hay forma barata de
 * invalidarlas todas: prometer instantaneidad seria mentir.
 */
export const TTL_CONFIG_MS = 30_000;

export interface AgentConfigProvider {
  get(): Promise<AgenteConfigValores>;
  /** Invalida el cache de ESTA instancia. Quien guarda ve su cambio al instante. */
  invalidar(): void;
}

/** Devuelve solo lo operativo: version y activa no le sirven a quien opera. */
function aValores(c: AgenteConfigValores): AgenteConfigValores {
  return {
    modelo: c.modelo,
    instrucciones: c.instrucciones,
    tono: c.tono,
    largo: c.largo,
    emojis: c.emojis,
    descuento_max_pct: c.descuento_max_pct,
    max_pasos_tool: c.max_pasos_tool,
    ventana_contexto_mensajes: c.ventana_contexto_mensajes,
    umbral_resumen_turnos: c.umbral_resumen_turnos,
    timeout_tool_ms: c.timeout_tool_ms,
    tope_gasto_diario_usd: c.tope_gasto_diario_usd,
    politica_tope: c.politica_tope,
    escalar_umbral_intents: c.escalar_umbral_intents,
    escalar_palabras: c.escalar_palabras,
    escalar_cotizacion_desde: c.escalar_cotizacion_desde,
    horario: c.horario,
    horario_timezone: c.horario_timezone,
    plantilla_fuera_horario: c.plantilla_fuera_horario,
    plantilla_escalado: c.plantilla_escalado,
  };
}

export class CachedAgentConfigProvider implements AgentConfigProvider {
  private cache: { valores: AgenteConfigValores; expira: number } | null = null;

  constructor(
    private readonly repo: AgenteConfigRepository,
    private readonly logger: Logger,
  ) {}

  async get(): Promise<AgenteConfigValores> {
    const ahora = Date.now();
    if (this.cache && ahora < this.cache.expira) return this.cache.valores;

    try {
      const activa = await this.repo.findActiva();
      if (!activa) {
        // Tabla sin fila activa: no es un error de infraestructura, pero tampoco
        // es normal. Se registra y se sigue con fabrica, sin cachear.
        this.logger.error("agente.config.sin_activa", {});
        return CONFIG_DE_FABRICA;
      }
      const valores = aValores(activa);
      this.cache = { valores, expira: ahora + TTL_CONFIG_MS };
      return valores;
    } catch (e) {
      // No se cachea el fallback: cachearlo dejaria al agente en valores de
      // fabrica 30 s despues de que la DB se recupere, sin ninguna razon.
      this.logger.error("agente.config.lectura_fallida", { error: (e as Error).message });
      return CONFIG_DE_FABRICA;
    }
  }

  invalidar(): void {
    this.cache = null;
  }
}

/** Config fija. Para tests y para `LLM_MODE=mock`. */
export class StaticAgentConfigProvider implements AgentConfigProvider {
  constructor(private readonly valores: AgenteConfigValores) {}

  async get(): Promise<AgenteConfigValores> {
    return this.valores;
  }

  invalidar(): void {}
}
