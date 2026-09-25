import { ErrorIcon, Schedule, TaskAlt } from "@/components/icons";
import { tinte } from "./paleta";
import type { NivelVerdicto, Verdicto } from "./cupo";
import type { LucideIcon } from "lucide-react";

const ICONO: Record<NivelVerdicto, LucideIcon> = {
  listo: TaskAlt,
  reparto: Schedule,
  bloqueado: ErrorIcon,
};

/**
 * La tesis de la pantalla de pre-vuelo, arriba de todo y en una línea.
 *
 * El resto del pre-vuelo es la evidencia de esta frase. Va antes que
 * cualquier tarjeta porque la pregunta que trae el que entra es una sola —
 * "¿puedo mandar esto sin quemar el número?"— y merece respuesta antes que
 * datos. La misma frase se repite pegada al botón de confirmar, para que no
 * se pueda apretar sin haberla leído.
 */
export function VerdictoEnvio({ verdicto, compacto }: { verdicto: Verdicto; compacto?: boolean }) {
  const Icono = ICONO[verdicto.nivel];
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-[11px] border px-3.5 py-3"
      style={{
        borderColor: tinte(verdicto.color, 34),
        backgroundColor: tinte(verdicto.color, 8),
      }}
    >
      <Icono
        size={16}
        style={{ color: verdicto.color }}
        aria-hidden
        className="mt-[1px] shrink-0"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[12.5px] font-[650]" style={{ color: verdicto.color }}>
          {verdicto.titulo}
        </span>
        {compacto ? null : (
          <span className="text-ink-secondary text-[11.5px] leading-relaxed">
            {verdicto.detalle}
          </span>
        )}
      </div>
    </div>
  );
}
