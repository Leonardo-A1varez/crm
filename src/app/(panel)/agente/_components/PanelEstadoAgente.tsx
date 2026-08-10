import { PauseIcon } from "@/components/icons";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { cn } from "@/lib/utils";

/**
 * Panel de estado del header (§4). El handoff pide "punto verde animado +
 * Agente operando / 1.284 turnos hoy · sin incidentes + botón Pausar todo".
 *
 * Dos de esas tres cosas no existen todavía y no se inventan:
 *
 * - Los turnos del día y los incidentes no se miden en ningún lado: el cost
 *   tracker no persiste sin Upstash y nadie cuenta turnos por día. La segunda
 *   línea dice qué versión de config está corriendo, que sí es un dato real.
 * - "Pausar todo" necesitaría apagar la IA de todas las sesiones abiertas a la
 *   vez. Hoy la pausa es por sesión (`lead_sessions.ia_pausada`) y el único
 *   interruptor global es el feature flag `ai_agent.enabled`, que se cambia
 *   fuera de la app. El botón queda visible y deshabilitado en vez de mentir.
 *
 * El estado sí es real: sale del horario configurado.
 */
export function PanelEstadoAgente({
  abierto,
  version,
  modelo,
}: {
  abierto: boolean;
  version: number;
  modelo: string;
}) {
  return (
    <div className="flex items-center gap-3.5">
      <div className="text-right">
        <p className="flex items-center justify-end gap-1.5 text-[12px] font-semibold">
          <span
            aria-hidden
            className={cn(
              "h-[7px] w-[7px] rounded-full",
              abierto ? "bg-ok animate-pulse-dot" : "bg-caution",
            )}
          />
          <span className={abierto ? "text-ok" : "text-caution"}>
            {abierto ? "Agente operando" : "Fuera de horario"}
          </span>
        </p>
        <MonoMeta className="mt-0.5 block">
          v{version} · {modelo} · turnos de hoy: sin medición
        </MonoMeta>
      </div>
      <button
        type="button"
        disabled
        title="Todavía no existe: la pausa es por conversación (desde el Inbox) y el interruptor global es el feature flag ai_agent.enabled, que se cambia fuera de la app."
        className="text-danger border-line-control hover:border-danger rounded-[9px] border px-3 py-1.5 text-[11.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
      >
        <span className="flex items-center gap-1.5">
          <PauseIcon size={13} />
          Pausar todo
        </span>
      </button>
    </div>
  );
}
