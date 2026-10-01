"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { SelectOpciones, type OpcionSelect } from "@/components/shared/SelectOpciones";
import { etiquetaOpcionModo, type OpcionInterruptor } from "@/lib/copiloto/etiquetas";
import type { CambiarModoRespuestaInput } from "@/lib/validation/copiloto.schema";
import type { ModoDecidido, ModoOverride } from "@/types/copiloto";
import type { UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

const ORDEN: readonly OpcionInterruptor[] = ["segun_horario", "copiloto", "automatico"];

/**
 * Interruptor de modo de respuesta de la conversación (§5): "Según horario"
 * (default, muestra lo que haría ahora), "Copiloto" fijo y "Automático" fijo.
 *
 * Es un select y no tres botones: el encabezado del chat ya lleva avatar,
 * nombre, etapa y el chip de "IA activa", y a 520 px de ancho un segmentado de
 * tres textos no entra. `SelectOpciones` es el envoltorio del repo que evita
 * que Base UI pinte el valor crudo en el disparador.
 */
export function InterruptorModo({
  leadId,
  conversacionId,
  override,
  modoEfectivo,
  onCambiar,
}: {
  leadId: UUID;
  conversacionId: UUID;
  override: ModoOverride | null;
  modoEfectivo: ModoDecidido;
  onCambiar: (input: CambiarModoRespuestaInput) => Promise<ActionResult>;
}) {
  const [pendiente, startTransition] = useTransition();

  const opciones: OpcionSelect<OpcionInterruptor>[] = ORDEN.map((value) => ({
    value,
    label: etiquetaOpcionModo(value, modoEfectivo),
  }));

  const actual = override ?? "segun_horario";
  // El disparador corta con elipsis a 240 px; el title deja leer el texto entero.
  const titulo = etiquetaOpcionModo(actual, modoEfectivo);

  return (
    <span title={titulo} className="inline-flex min-w-0">
      <SelectOpciones<OpcionInterruptor>
        aria-label="Modo de respuesta"
        opciones={opciones}
        value={actual}
        disabled={pendiente}
        size="sm"
        className="border-line-card bg-surface-elevated text-ink-secondary h-[30px] max-w-[240px] rounded-[9px] px-2.5 text-[11.5px] font-semibold"
        onValueChange={(modo) => {
          startTransition(async () => {
            const r = await onCambiar({ leadId, conversacionId, modo });
            if (!r.ok) toast.error(r.error);
          });
        }}
      />
    </span>
  );
}
