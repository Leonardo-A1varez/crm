"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

/**
 * Interruptor de activo/inactivo. Desactivar en vez de borrar es a propósito:
 * una regla apagada conserva su historial en `rule_executions`, y borrarla
 * dejaría huérfanas las respuestas que ya salieron por ella.
 *
 * Dos presentaciones sobre la misma lógica:
 *
 * - `chip` (por defecto): la píldora "Activo / Inactivo" con la que se
 *   construyeron las listas de intents y reglas.
 * - `switch`: el interruptor de 30×17 que el handoff §4.1 pide en la tabla de
 *   reglas de la consola. Es una variante y no un componente aparte porque el
 *   comportamiento —transición pendiente, toast de error, etiqueta accesible—
 *   es idéntico y dos copias divergirían al primer arreglo.
 */
export function ToggleActivo({
  id,
  activo,
  etiqueta,
  onToggle,
  variante = "chip",
}: {
  id: UUID;
  activo: boolean;
  etiqueta: string;
  onToggle: (input: { id: UUID; valor: boolean }) => Promise<ActionResult>;
  variante?: "chip" | "switch";
}) {
  const [isPending, startTransition] = useTransition();

  const alternar = () =>
    startTransition(async () => {
      const r = await onToggle({ id, valor: !activo });
      if (!r.ok) toast.error(r.error);
    });

  const comunes = {
    type: "button",
    "aria-pressed": activo,
    "aria-label": `${activo ? "Desactivar" : "Activar"} ${etiqueta}`,
    disabled: isPending,
    onClick: alternar,
  } as const;

  if (variante === "switch") {
    return (
      <button
        {...comunes}
        className={cn(
          "relative h-[17px] w-[30px] shrink-0 rounded-[20px] transition-colors duration-[160ms] disabled:opacity-60",
          activo ? "bg-brand" : "bg-line-control",
        )}
      >
        <span
          aria-hidden
          className="absolute top-[2.5px] h-3 w-3 rounded-full bg-white transition-[left] duration-[160ms]"
          style={{ left: activo ? "15.5px" : "2.5px" }}
        />
      </button>
    );
  }

  return (
    <button
      {...comunes}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-[7px] py-[2.5px] text-[10px] font-semibold transition-colors disabled:opacity-60",
        activo ? "text-ok bg-ok/10 border-ok/28" : "text-ink-faint border-line-control",
      )}
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", activo ? "bg-ok" : "bg-ink-ghost")}
      />
      {activo ? "Activo" : "Inactivo"}
    </button>
  );
}
