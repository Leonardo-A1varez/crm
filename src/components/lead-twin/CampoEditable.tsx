"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AutoAwesome, Edit } from "@/components/icons";
import { ChipProcedencia } from "@/components/lead-twin/ChipProcedencia";
import { cn } from "@/lib/utils";
import type { EditarCampoTwinInput } from "@/lib/validation/inbox.schema";
import type { CampoTwinEditable } from "@/types/domain";
import type { ProcedenciaCampo, UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

/**
 * Un campo del Twin con su procedencia y edición en el lugar.
 *
 * Todo campo con valor declara de dónde salió, que es el punto del panel: sin
 * marca de procedencia el vendedor no sabe si el dato lo dedujo un LLM o lo
 * escribió una persona, y trata igual a los dos.
 */
export function CampoEditable({
  label,
  campo,
  valor,
  leadId,
  sessionId,
  procedencia,
  multilinea = false,
  claseValor,
  onGuardar,
}: {
  label: string;
  campo: CampoTwinEditable;
  valor: string | null;
  leadId: UUID;
  sessionId: UUID;
  procedencia?: ProcedenciaCampo;
  multilinea?: boolean;
  /** Tipografía del valor cuando el handoff la especifica (precio, bloqueador). */
  claseValor?: string;
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

  const conValor = Boolean(valor?.trim());

  return (
    <div className="group">
      <div className="flex items-center gap-1.5">
        <span className="text-ink-faint text-[10.5px]">{label}</span>
        {procedencia ? (
          <ChipProcedencia
            Icon={Edit}
            className="text-info bg-info/12"
            titulo="Un humano lo pisó; el extractor no lo vuelve a tocar."
          >
            Corregido por vos
          </ChipProcedencia>
        ) : conValor ? (
          <ChipProcedencia
            Icon={AutoAwesome}
            className="text-brand-hover bg-brand/12"
            titulo="Lo infirió el extractor. Editable."
          >
            Extraído por IA
          </ChipProcedencia>
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
      <div
        className={cn(
          "text-ink-secondary mt-[3px] text-[12.5px] break-words whitespace-pre-wrap",
          claseValor,
        )}
      >
        {conValor ? valor : "—"}
      </div>
    </div>
  );
}
