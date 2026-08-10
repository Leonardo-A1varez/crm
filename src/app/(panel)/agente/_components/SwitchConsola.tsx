"use client";

import { cn } from "@/lib/utils";

/**
 * El interruptor 30×17 del handoff §4.1/§4.2, sobre estado local.
 *
 * No reusa `ToggleActivo` en su variante `switch` a propósito: ese componente
 * persiste solo (recibe una Server Action y muestra su propio toast), y en la
 * consola de config nada se guarda hasta que el admin toca "Guardar". Un
 * switch que escribe en la base mientras la barra de cambios sin guardar dice
 * que no se guardó nada sería una contradicción visible.
 */
export function SwitchConsola({
  activo,
  etiqueta,
  onChange,
  disabled,
}: {
  activo: boolean;
  etiqueta: string;
  onChange: (valor: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      disabled={disabled}
      onClick={() => onChange(!activo)}
      className={cn(
        "relative h-[17px] w-[30px] shrink-0 rounded-[20px] transition-colors duration-[160ms] disabled:opacity-50",
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
