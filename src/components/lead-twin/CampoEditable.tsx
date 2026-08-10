"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Edit } from "@/components/icons";
import type { EditarCampoTwinInput } from "@/lib/validation/inbox.schema";
import type { CampoTwinEditable } from "@/types/domain";
import type { ProcedenciaCampo, UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

/**
 * Un campo del Twin con su procedencia y edición en el lugar.
 *
 * La procedencia se muestra solo cuando la tocó una persona: marcar también lo
 * que puso el extractor pondría una etiqueta en casi todos los campos y la
 * señal dejaría de significar algo. Sin chip = lo dedujo la IA.
 */
export function CampoEditable({
  label,
  campo,
  valor,
  leadId,
  sessionId,
  procedencia,
  multilinea = false,
  onGuardar,
}: {
  label: string;
  campo: CampoTwinEditable;
  valor: string | null;
  leadId: UUID;
  sessionId: UUID;
  procedencia?: ProcedenciaCampo;
  multilinea?: boolean;
  onGuardar: (input: EditarCampoTwinInput) => Promise<ActionResult>;
}) {
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState(valor ?? "");
  const [isPending, startTransition] = useTransition();

  const guardar = () => {
    if (isPending) return;
    startTransition(async () => {
      const r = await onGuardar({ leadId, sessionId, campo, valor: borrador });
      if (r.ok) {
        setEditando(false);
      } else {
        toast.error(r.error);
      }
    });
  };

  const cancelar = () => {
    setBorrador(valor ?? "");
    setEditando(false);
  };

  if (editando) {
    const comun = {
      value: borrador,
      autoFocus: true,
      disabled: isPending,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setBorrador(e.target.value),
      "aria-label": label,
      className:
        "text-ink-body border-line-input bg-surface-input w-full rounded-[8px] border px-2 py-1 text-[12.5px] outline-none",
    };
    return (
      <div>
        <div className="text-ink-faint mb-1 text-[10.5px]">{label}</div>
        {multilinea ? (
          <textarea {...comun} rows={3} className={`${comun.className} resize-none`} />
        ) : (
          <input
            {...comun}
            onKeyDown={(e) => {
              if (e.key === "Enter") guardar();
              if (e.key === "Escape") cancelar();
            }}
          />
        )}
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

  return (
    <div className="group">
      <div className="flex items-center gap-1.5">
        <span className="text-ink-faint text-[10.5px]">{label}</span>
        {procedencia ? (
          <span className="text-info bg-info/12 rounded px-1 py-px font-mono text-[8.5px] tracking-wide uppercase">
            editado
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setEditando(true)}
          aria-label={`Editar ${label}`}
          className="text-ink-ghost hover:text-ink-secondary ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Edit size={12} />
        </button>
      </div>
      <div className="text-ink-secondary mt-[3px] text-[12.5px] break-words whitespace-pre-wrap">
        {valor?.trim() ? valor : "—"}
      </div>
    </div>
  );
}
