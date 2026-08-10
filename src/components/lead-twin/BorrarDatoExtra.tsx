"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Close } from "@/components/icons";
import type { BorrarDatoExtraInput } from "@/lib/validation/inbox.schema";
import type { UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

/**
 * El `×` que saca un campo libre de la ficha.
 *
 * Sin confirmación, igual que el `×` de las etiquetas: lo que se borra es un
 * renglón que se vuelve a escribir en dos segundos con el `+` de abajo, y un
 * diálogo por cada campo mal tipeado cuesta más que el error que evita.
 */
export function BorrarDatoExtra({
  leadId,
  clave,
  onBorrar,
}: {
  leadId: UUID;
  /** El nombre tal como se ve en la fila; el service lo compara normalizado. */
  clave: string;
  onBorrar: (input: BorrarDatoExtraInput) => Promise<ActionResult>;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      aria-label={`Borrar el campo ${clave}`}
      title={`Borrar el campo ${clave}`}
      onClick={() =>
        startTransition(async () => {
          const r = await onBorrar({ leadId, clave });
          if (!r.ok) toast.error(r.error);
        })
      }
      className="text-ink-ghost hover:text-danger shrink-0 rounded-[4px] transition-colors disabled:opacity-50"
    >
      <Close size={11} />
    </button>
  );
}
