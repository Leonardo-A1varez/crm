"use client";

import { ToggleActivo } from "@/components/reglas/ToggleActivo";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { cn } from "@/lib/utils";
import type { ReglaConIntent } from "@/server/services/reglas/reglas-admin.service";
import type { ActionResult } from "@/types/inbox";
import type { UUID } from "@/types/entities";

export const TIPO_LABEL: Record<string, string> = {
  text: "Texto fijo",
  template: "Plantilla",
  handoff: "Escala a un humano",
};

/** Grid del handoff §4.1: Regla / Usos por semana / Ahorro / On. */
const GRID = "grid grid-cols-[1.6fr_.7fr_.7fr_44px] items-center gap-2";

/** La regla no tiene nombre propio en el schema: la identifica su respuesta. */
function nombreDeRegla(contenido: string): string {
  const primera = contenido.split("\n")[0]?.trim() ?? "";
  return primera.length > 0 ? primera : "(sin contenido)";
}

export function TablaReglas({
  filas,
  seleccionada,
  onSeleccionar,
  onToggle,
  esAdmin,
}: {
  filas: ReglaConIntent[];
  seleccionada: UUID | null;
  onSeleccionar: (id: UUID) => void;
  onToggle: (input: { id: UUID; valor: boolean }) => Promise<ActionResult>;
  esAdmin: boolean;
}) {
  if (filas.length === 0) {
    return (
      <p className="text-ink-faint text-[11.5px]">
        Sin reglas cargadas. Mientras esta tabla esté vacía, cada mensaje —incluido un saludo— pasa
        por el LLM y se paga en tokens.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      <div className={cn(GRID, "border-line-layout border-b pb-2")}>
        <span className="text-ink-muted text-[10.5px]">Regla</span>
        <span className="text-ink-muted text-right text-[10.5px]">Usos/sem</span>
        <span className="text-ink-muted text-right text-[10.5px]">Ahorro</span>
        <span className="text-ink-muted text-center text-[10.5px]">On</span>
      </div>

      <ul>
        {filas.map(({ regla, intentNombre }) => {
          const sel = regla.id === seleccionada;
          return (
            <li
              key={regla.id}
              className={cn(
                GRID,
                "border-line-layout cursor-pointer border-b px-1 py-[11px] transition-colors",
                sel ? "bg-surface-hover" : "hover:bg-surface-elevated",
              )}
              onClick={() => onSeleccionar(regla.id)}
            >
              <button
                type="button"
                aria-pressed={sel}
                onClick={() => onSeleccionar(regla.id)}
                className="min-w-0 text-left"
              >
                <span
                  className={cn(
                    "block truncate text-[12px] font-semibold",
                    regla.activa ? "text-ink-primary" : "text-ink-faint",
                  )}
                >
                  {nombreDeRegla(regla.respuesta_contenido)}
                </span>
                <MonoMeta className="mt-0.5 block truncate text-[9.5px]">
                  intent: {intentNombre} · prioridad {regla.prioridad} ·{" "}
                  {TIPO_LABEL[regla.respuesta_tipo] ?? regla.respuesta_tipo}
                </MonoMeta>
              </button>

              {/* Sin medición todavía: ver la nota al pie de la tarjeta. */}
              <span className="text-ink-ghost text-right font-mono text-[11px]">—</span>
              <span className="text-ink-ghost text-right font-mono text-[11px]">—</span>

              <span
                className="flex justify-center"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                role="presentation"
              >
                {esAdmin ? (
                  <ToggleActivo
                    id={regla.id}
                    activo={regla.activa}
                    etiqueta={`regla de ${intentNombre}`}
                    onToggle={onToggle}
                    variante="switch"
                  />
                ) : (
                  <span
                    aria-label={regla.activa ? "Activa" : "Inactiva"}
                    className={cn(
                      "h-[7px] w-[7px] rounded-full",
                      regla.activa ? "bg-ok" : "bg-ink-ghost",
                    )}
                  />
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
