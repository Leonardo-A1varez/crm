import type { HandoffEventsRepository } from "@/server/repositories/handoff-events.repo";
import type { LlmUsageRepository } from "@/server/repositories/llm-usage.repo";
import type { AgenteConfigValores } from "@/types/agente";
import type { UUID } from "@/types/entities";
import type { AccionDelegarDeps } from "./acciones/delegar";

export interface PuertosDelegacionDeps {
  handoffEvents: Pick<HandoffEventsRepository, "listBySessionIds">;
  llmUsage: Pick<LlmUsageRepository, "resumenPorLeadSession" | "listDesde">;
  config: { get(): Promise<Pick<AgenteConfigValores, "tope_gasto_diario_usd">> };
}

/** Las 00:00 UTC del día de `ahora`: el mismo corte de día que el contador de gasto. */
function inicioDelDiaUtc(ahora: Date): Date {
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
}

/**
 * Las lecturas de "Delegar al agente" en producción (`acciones/delegar.ts`),
 * cerradas contra los repos reales. "Probar" usa las suyas
 * (`crearSandboxDePrueba`): gasto cero y la pausa de la propia prueba.
 *
 * El gasto del día se suma de `llm_usage` y no del contador en memoria del
 * cost tracker: en serverless ese contador vive por instancia y no ve lo que
 * gastaron las demás.
 */
export function crearPuertosDelegacion(
  deps: PuertosDelegacionDeps,
): Pick<AccionDelegarDeps, "pausas" | "gastoLlm"> {
  return {
    pausas: {
      async ultimoMotivo(sessionId: UUID) {
        const eventos = await deps.handoffEvents.listBySessionIds([sessionId]);
        let ultima: (typeof eventos)[number] | null = null;
        for (const e of eventos) {
          if (e.action !== "pause") continue;
          if (ultima === null || e.created_at.getTime() > ultima.created_at.getTime()) ultima = e;
        }
        return ultima?.reason_code ?? null;
      },
    },
    gastoLlm: {
      deSesion: async (sessionId) => (await deps.llmUsage.resumenPorLeadSession(sessionId)).usd,
      delDia: async (ahora) =>
        (await deps.llmUsage.listDesde(inicioDelDiaUtc(ahora))).reduce(
          (total, fila) => total + fila.costo_usd,
          0,
        ),
      topeDiario: async () => (await deps.config.get()).tope_gasto_diario_usd,
    },
  };
}
