"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Edit } from "@/components/icons";
import type { RenombrarLeadInput } from "@/lib/validation/inbox.schema";
import type { UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

/**
 * El nombre con el que la casa identifica al lead, editable en el lugar.
 *
 * `leads.nombre` no lo escribe el pipeline: los leads nacen con `""` y el
 * nombre de WhatsApp o de Instagram nunca se copia, porque un alias de redes no
 * alcanza para distinguir a una persona. Por eso el vacío no se rellena con "?"
 * ni con "—": esos dicen "no hay dato" cuando lo que hay que decir es "ponelo
 * vos". El estado vacío es la invitación a escribirlo.
 */
export function NombreLead({
  leadId,
  nombre,
  onGuardar,
}: {
  leadId: UUID;
  nombre: string;
  onGuardar: (input: RenombrarLeadInput) => Promise<ActionResult>;
}) {
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState(nombre);
  const [isPending, startTransition] = useTransition();

  const guardar = () => {
    if (isPending) return;
    startTransition(async () => {
      const r = await onGuardar({ leadId, nombre: borrador });
      if (r.ok) {
        setEditando(false);
      } else {
        toast.error(r.error);
      }
    });
  };

  const cancelar = () => {
    setBorrador(nombre);
    setEditando(false);
  };

  if (editando) {
    return (
      <div>
        <input
          value={borrador}
          autoFocus
          disabled={isPending}
          maxLength={80}
          aria-label="Nombre del lead"
          placeholder="Cómo lo identifica la casa"
          onChange={(e) => setBorrador(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") guardar();
            if (e.key === "Escape") cancelar();
          }}
          className="text-ink-body border-line-input bg-surface-input w-full rounded-[8px] border px-2 py-1 text-[13px] outline-none"
        />
        <div className="mt-1.5 flex gap-1.5">
          <button
            type="button"
            onClick={guardar}
            disabled={isPending}
            className="bg-brand text-brand-ink rounded-[7px] px-2 py-[3px] text-[10.5px] font-semibold disabled:opacity-50"
          >
            {isPending ? "Guardando…" : "Guardar"}
          </button>
          <button
            type="button"
            onClick={cancelar}
            disabled={isPending}
            className="text-ink-dim border-line-control rounded-[7px] border px-2 py-[3px] text-[10.5px] font-semibold"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  if (nombre.trim() === "") {
    return (
      <button
        type="button"
        onClick={() => setEditando(true)}
        className="border-line-control text-ink-dim hover:border-brand/50 hover:text-brand w-full rounded-[9px] border border-dashed px-2.5 py-2 text-left text-[13px] font-medium transition-colors"
      >
        Ponerle un nombre
      </button>
    );
  }

  return (
    <div className="group flex items-start gap-2">
      <h2 className="text-ink-primary min-w-0 flex-1 text-[18px] leading-tight font-[680] tracking-[-0.02em] break-words">
        {nombre}
      </h2>
      <button
        type="button"
        onClick={() => setEditando(true)}
        aria-label="Editar nombre del lead"
        className="text-ink-ghost hover:text-ink-secondary mt-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Edit size={13} />
      </button>
    </div>
  );
}
