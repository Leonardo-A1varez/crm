"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Add, Close, Sell } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { opcionesSelector } from "@/lib/ui/selector-etiquetas";
import type {
  AsignarEtiquetaInput,
  CrearEtiquetaInput,
  QuitarEtiquetaInput,
} from "@/lib/validation/inbox.schema";
import type { Tag, UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

/**
 * Etiquetas del lead: los chips que tiene y el selector para agregarle más.
 *
 * El selector filtra el catálogo mientras se escribe y, cuando lo escrito no
 * existe, ofrece crearlo ahí mismo. Mandar al vendedor a la pantalla de
 * administración para volver después es la forma segura de que nadie etiquete:
 * la etiqueta se pone en el momento en que se entiende algo del lead, no diez
 * clicks más tarde.
 */
export function SeccionEtiquetas({
  leadId,
  tags,
  disponibles,
  onAsignar,
  onQuitar,
  onCrear,
}: {
  leadId: UUID;
  /** Las que ya tiene el lead. */
  tags: Tag[];
  /** Catálogo completo, incluidas las que ya tiene. */
  disponibles: Tag[];
  onAsignar: (input: AsignarEtiquetaInput) => Promise<ActionResult>;
  onQuitar: (input: QuitarEtiquetaInput) => Promise<ActionResult>;
  onCrear: (input: CrearEtiquetaInput) => Promise<ActionResult>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [isPending, startTransition] = useTransition();

  const { candidatas, puedeCrear } = opcionesSelector(disponibles, tags, q);

  const ejecutar = (accion: () => Promise<ActionResult>, alTerminar?: () => void) => {
    if (isPending) return;
    startTransition(async () => {
      const r = await accion();
      if (r.ok) {
        alTerminar?.();
      } else {
        toast.error(r.error);
      }
    });
  };

  return (
    <div className="border-line-layout flex flex-col gap-2.5 border-b px-[17px] py-[15px]">
      <Eyebrow>Etiquetas</Eyebrow>

      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="border-line-input bg-surface-card text-ink-secondary inline-flex max-w-full items-center gap-1 rounded-md border py-[2.5px] pr-1 pl-[7px] text-[10.5px] font-medium"
              title={tag.descripcion ?? undefined}
            >
              <Sell size={11} className="shrink-0" style={{ color: tag.color }} />
              <span className="min-w-0 break-words">{tag.nombre}</span>
              <button
                type="button"
                disabled={isPending}
                aria-label={`Quitar etiqueta ${tag.nombre}`}
                onClick={() => ejecutar(() => onQuitar({ leadId, tagId: tag.id }))}
                className="text-ink-ghost hover:text-danger shrink-0 rounded-[4px] transition-colors disabled:opacity-50"
              >
                <Close size={11} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {abierto ? (
        <div className="border-line-control bg-surface-elevated flex flex-col gap-1.5 rounded-[10px] border p-2">
          <input
            value={q}
            autoFocus
            disabled={isPending}
            maxLength={40}
            aria-label="Buscar o crear etiqueta"
            placeholder="Buscar o crear…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQ("");
                setAbierto(false);
              }
            }}
            className="text-ink-body border-line-input bg-surface-input w-full rounded-[7px] border px-2 py-1 text-[11.5px] outline-none"
          />

          {candidatas.length > 0 ? (
            <ul className="flex max-h-[168px] flex-col overflow-y-auto">
              {candidatas.map((tag) => (
                <li key={tag.id}>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      ejecutar(
                        () => onAsignar({ leadId, tagId: tag.id }),
                        () => setQ(""),
                      )
                    }
                    className="text-ink-secondary hover:bg-surface-card flex w-full items-center gap-1.5 rounded-[6px] px-1.5 py-1 text-left text-[11.5px] transition-colors disabled:opacity-50"
                  >
                    <Sell size={11} className="shrink-0" style={{ color: tag.color }} />
                    <span className="min-w-0 truncate">{tag.nombre}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {puedeCrear ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                // El panel queda abierto, igual que al asignar: el chip nuevo
                // aparece arriba y se puede seguir agregando sin volver a abrir.
                ejecutar(
                  () => onCrear({ leadId, nombre: q }),
                  () => setQ(""),
                )
              }
              className="text-brand hover:bg-brand/10 flex w-full items-center gap-1.5 rounded-[6px] px-1.5 py-1 text-left text-[11.5px] font-medium transition-colors disabled:opacity-50"
            >
              <Add size={12} className="shrink-0" />
              <span className="min-w-0 truncate">Crear «{q.trim()}»</span>
            </button>
          ) : null}

          {candidatas.length === 0 && !puedeCrear ? (
            <p className="text-ink-fainter px-1.5 py-1 text-[10.5px]">
              {disponibles.length === 0
                ? "Todavía no hay etiquetas. Escribí una para crearla."
                : "Este lead ya tiene todas las etiquetas que existen."}
            </p>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="border-line-control text-ink-dim hover:border-brand/50 hover:text-brand inline-flex items-center gap-1 self-start rounded-md border border-dashed px-[7px] py-[3px] text-[10.5px] font-medium transition-colors"
        >
          <Add size={11} className="shrink-0" />
          Agregar etiquetas
        </button>
      )}
    </div>
  );
}
