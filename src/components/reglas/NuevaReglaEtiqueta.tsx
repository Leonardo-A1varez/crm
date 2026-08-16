"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

const CAMPO =
  "text-ink-body placeholder:text-ink-ghost border-line-input bg-surface-input w-full rounded-[9px] border px-2.5 py-[7px] text-[12px] outline-none";

/**
 * Alta de una regla que etiqueta.
 *
 * Solo pide intent y etiqueta: no hay respuesta que escribir —etiquetar no
 * contesta— ni prioridad que elegir, porque aplican todas las que matcheen.
 * Espeja `NuevaRegla` en forma y estilo, sin los campos que acá no significan
 * nada.
 */
export function NuevaReglaEtiqueta({
  intents,
  etiquetas,
  onCrear,
}: {
  intents: { id: UUID; nombre: string }[];
  etiquetas: { id: UUID; nombre: string }[];
  onCrear: (input: { intentId: UUID; tagId: UUID }) => Promise<ActionResult>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [intentId, setIntentId] = useState(intents[0]?.id ?? "");
  const [tagId, setTagId] = useState(etiquetas[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();

  if (intents.length === 0 || etiquetas.length === 0) {
    return (
      <p className="text-ink-faint text-[11.5px]">
        {intents.length === 0
          ? "Primero creá un intent: una regla cuelga de uno."
          : "Primero creá una etiqueta, desde el botón «Etiquetas» en Leads."}
      </p>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="bg-brand text-brand-ink inline-flex items-center rounded-[9px] px-[11px] py-1.5 text-[11.5px] font-semibold"
      >
        Nueva regla
      </button>
    );
  }

  const guardar = () => {
    startTransition(async () => {
      const r = await onCrear({ intentId, tagId });
      if (r.ok) {
        setAbierto(false);
        toast.success("Regla de etiquetado creada.");
      } else {
        toast.error(r.error);
      }
    });
  };

  return (
    <div className="border-line-card bg-surface-card flex flex-col gap-2 rounded-[12px] border p-3">
      <select
        value={intentId}
        onChange={(e) => setIntentId(e.target.value)}
        aria-label="Intent que dispara la etiqueta"
        className={CAMPO}
      >
        {intents.map((i) => (
          <option key={i.id} value={i.id}>
            {i.nombre}
          </option>
        ))}
      </select>
      <select
        value={tagId}
        onChange={(e) => setTagId(e.target.value)}
        aria-label="Etiqueta que se cuelga"
        className={CAMPO}
      >
        {etiquetas.map((t) => (
          <option key={t.id} value={t.id}>
            {t.nombre}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={guardar}
          disabled={isPending}
          className="bg-brand text-brand-ink rounded-[9px] px-[11px] py-1.5 text-[11.5px] font-semibold disabled:opacity-50"
        >
          {isPending ? "Creando…" : "Crear"}
        </button>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          disabled={isPending}
          className="text-ink-dim rounded-[9px] px-[11px] py-1.5 text-[11.5px]"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
