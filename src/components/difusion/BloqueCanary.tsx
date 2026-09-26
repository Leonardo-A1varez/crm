"use client";

import { useId } from "react";
import { formatearEntero } from "./formato";

/**
 * La muestra: programar primero unos pocos, mirar qué pasa y recién después
 * seguir.
 *
 * Viene marcada cuando se puede, porque el costo de equivocarse no es
 * simétrico: mandar 50 de más es un mal rato, mandar 3.500 de más es el
 * número. Va de 1 a n−1, igual que la valida el servidor: tiene que quedar
 * alguien para después de revisarla.
 *
 * Qué pasa con la muestra lo hace el motor de envío: la frena al salir y la
 * deja en revisión. El frenado automático por 368, 131031 y 131048 también es
 * del motor (`lib/difusion/reacciones.ts`) y lo dice la pantalla de envío.
 */
export function BloqueCanary({
  activo,
  tamano,
  totalDestinatarios,
  onCambiar,
}: {
  activo: boolean;
  tamano: number;
  totalDestinatarios: number;
  onCambiar: (canary: { activo: boolean; tamano: number }) => void;
}) {
  const idTamano = useId();
  const idError = useId();
  const posible = totalDestinatarios >= 2;
  const maximo = Math.max(1, totalDestinatarios - 1);
  const valido = Number.isInteger(tamano) && tamano >= 1 && tamano <= maximo;
  const marcado = activo && posible;

  return (
    <div className="flex flex-col gap-3">
      <label
        className={posible ? "flex cursor-pointer items-start gap-2.5" : "flex items-start gap-2.5"}
      >
        <input
          type="checkbox"
          checked={marcado}
          disabled={!posible}
          onChange={(e) => onCambiar({ activo: e.target.checked, tamano })}
          className="border-line-control checked:bg-ink-primary checked:border-ink-primary focus-visible:ring-ring/50 mt-[1px] size-[18px] shrink-0 appearance-none rounded-[5px] border transition-colors duration-150 focus-visible:ring-3 focus-visible:outline-none disabled:opacity-50"
        />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-ink-primary text-[12px] font-[650]">
            Mandar primero una muestra y revisar antes de seguir
          </span>
          <span className="text-ink-faint text-[11px] leading-relaxed text-pretty">
            {posible
              ? "La difusión guarda el tamaño de la muestra: sale esa parte y la difusión queda en revisión, con el resto en cola, hasta que alguien la reanude."
              : "Con un solo destinatario no hay muestra que revisar."}
          </span>
        </span>
      </label>

      {marcado ? (
        <div className="flex flex-col gap-1.5 pl-7">
          <div className="flex items-center gap-2.5">
            <label htmlFor={idTamano} className="text-ink-dim text-[11.5px]">
              Tamaño de la muestra
            </label>
            <input
              id={idTamano}
              type="number"
              inputMode="numeric"
              min={1}
              max={maximo}
              step={1}
              value={Number.isFinite(tamano) ? tamano : ""}
              aria-invalid={!valido || undefined}
              aria-describedby={valido ? undefined : idError}
              onChange={(e) => onCambiar({ activo, tamano: Number(e.target.value) })}
              className="border-line-input bg-surface-card text-ink-primary focus-visible:ring-ring/50 aria-invalid:border-danger h-7 w-[92px] rounded-lg border px-2 text-right font-mono text-[12px] tabular-nums focus-visible:ring-3 focus-visible:outline-none"
            />
            {valido ? (
              <span className="text-ink-ghost text-[11px]">
                y después los otros{" "}
                <span className="font-mono tabular-nums">
                  {formatearEntero(totalDestinatarios - tamano)}
                </span>
              </span>
            ) : null}
          </div>
          {valido ? null : (
            <p id={idError} role="alert" className="text-danger text-[11px]">
              La muestra va de 1 a {formatearEntero(maximo)}: tiene que quedar alguien para después
              de revisarla.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
