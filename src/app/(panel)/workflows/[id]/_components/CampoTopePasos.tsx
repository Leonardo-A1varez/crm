"use client";

import { useId, useState } from "react";
import { FOCO } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";
import { TOPE_PASOS } from "../_lib/max-pasos";

/**
 * El tope de pasos por corrida, en los ajustes del flujo del panel.
 *
 * Texto y no `type="number"`: el número del navegador cambia de valor con la
 * rueda del mouse apenas tiene foco —en un lienzo que se navega con la rueda,
 * es subir el tope sin darse cuenta— y acepta `1e2` o `1.5` a su manera.
 * `inputMode="numeric"` sigue abriendo el teclado numérico en pantallas táctiles.
 *
 * El error aparece al salir del campo y no con cada tecla: borrar "500" para
 * escribir "50" pasa por un campo vacío, y eso no es un error, es escribir.
 */
export function CampoTopePasos({
  valor,
  onCambiar,
  error,
  revelarError = false,
  soloLectura = false,
}: {
  /** El texto tal cual está en el campo, que a mitad de escribir no es un número. */
  valor: string;
  onCambiar: (texto: string) => void;
  /** Qué está mal con `valor`, o `null` si se puede guardar. */
  error: string | null;
  /** Mostrar el error aunque el campo no se haya tocado: después de un "Guardar" rebotado. */
  revelarError?: boolean;
  soloLectura?: boolean;
}) {
  const id = useId();
  const ayudaId = `${id}-ayuda`;
  const errorId = `${id}-error`;
  const [tocado, setTocado] = useState(false);
  const mostrarError = error !== null && (tocado || revelarError);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-ink-body text-[12px] font-medium">
        Tope de pasos por corrida
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={valor}
          onChange={(e) => onCambiar(e.target.value)}
          onBlur={() => setTocado(true)}
          readOnly={soloLectura}
          aria-invalid={mostrarError || undefined}
          aria-describedby={mostrarError ? `${errorId} ${ayudaId}` : ayudaId}
          className={cn(
            "bg-surface-input border-line-input text-ink-body w-20 rounded-[10px] border px-2.5 py-1.5 text-right font-mono text-[12.5px] tabular-nums",
            "aria-invalid:border-danger read-only:text-ink-faint",
            FOCO,
          )}
        />
        <span className="text-ink-faint text-[11.5px]">pasos</span>
      </div>
      {mostrarError ? (
        <p id={errorId} className="text-danger text-[11px] leading-snug text-pretty">
          {error}
        </p>
      ) : null}
      <p id={ayudaId} className="text-ink-faint text-[10.5px] leading-relaxed text-pretty">
        Entre {TOPE_PASOS.MIN} y {TOPE_PASOS.MAX}. Es la red contra un ciclo mal armado: la corrida
        que llega al tope se corta y queda fallada.
      </p>
    </div>
  );
}
