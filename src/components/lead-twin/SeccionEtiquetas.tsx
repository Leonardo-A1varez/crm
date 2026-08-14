"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Add, Close, Sell } from "@/components/icons";
import { useCerrarAlSalir } from "@/hooks/use-cerrar-al-salir";
import { ETAPA_REQUIERE_HUMANO } from "@/lib/ui/filtros-leads";
import { opcionesSelector } from "@/lib/ui/selector-etiquetas";
import { stageColor, stageLabel } from "@/lib/ui/stage";
import type {
  AsignarEtiquetaInput,
  CrearEtiquetaInput,
  QuitarEtiquetaInput,
  ToggleHandoffInput,
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
 *
 * No dibuja sección propia ni rótulo: va pegada debajo del nombre, como parte
 * de quién es el lead. Un encabezado "ETIQUETAS" entre el nombre y los chips
 * los volvía a alejar, que es justo lo que se quería sacar.
 */
export function SeccionEtiquetas({
  leadId,
  tags,
  disponibles,
  requiereHumano,
  onAsignar,
  onQuitar,
  onCrear,
  onQuitarRequiereHumano,
}: {
  leadId: UUID;
  /** Las que ya tiene el lead. */
  tags: Tag[];
  /** Catálogo completo, incluidas las que ya tiene. */
  disponibles: Tag[];
  /**
   * La sesión abierta cuando está escalada, o `null`.
   *
   * Se dibuja como un chip más de esta lista porque para el vendedor es una
   * marca sobre el lead, igual que una etiqueta. No lo es: sale de
   * `current_stage` y no de `lead_tags`, así que no aparece en el selector de
   * agregar —ponerlo lo decide el agente, no una persona— y no hay copia que
   * pueda quedar desincronizada del estado real.
   */
  requiereHumano: { sessionId: UUID } | null;
  onAsignar: (input: AsignarEtiquetaInput) => Promise<ActionResult>;
  onQuitar: (input: QuitarEtiquetaInput) => Promise<ActionResult>;
  onCrear: (input: CrearEtiquetaInput) => Promise<ActionResult>;
  /** Reanuda la IA: el mismo `resume` del toggle del encabezado. */
  onQuitarRequiereHumano: (input: ToggleHandoffInput) => Promise<ActionResult>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [isPending, startTransition] = useTransition();
  const panel = useRef<HTMLDivElement>(null);

  const cerrar = useCallback(() => {
    setQ("");
    setAbierto(false);
  }, []);

  // El `ref` abarca los chips y el selector, no solo el selector: quitar una
  // etiqueta con el `×` mientras se está agregando otra es la misma tarea, y
  // cerrar el panel ahí sería castigar un click legítimo.
  useCerrarAlSalir(abierto, panel, cerrar);

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
    <div ref={panel} className="flex flex-col gap-2">
      {requiereHumano !== null || tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {/* Primero y con el color de la etapa: es el único chip de la fila
              que pide una acción; las etiquetas del catálogo describen. */}
          {requiereHumano !== null ? (
            <li
              className="inline-flex max-w-full items-center gap-1 rounded-md border py-[2.5px] pr-1 pl-[7px] text-[10.5px] font-medium"
              style={{
                borderColor: stageColor(ETAPA_REQUIERE_HUMANO),
                color: stageColor(ETAPA_REQUIERE_HUMANO),
              }}
              title="Lo puso el agente al escalar. Quitarlo reanuda la IA."
            >
              <Sell size={11} className="shrink-0" />
              <span className="min-w-0 break-words">{stageLabel(ETAPA_REQUIERE_HUMANO)}</span>
              <button
                type="button"
                disabled={isPending}
                aria-label="Quitar Requiere humano y reanudar la IA"
                onClick={() =>
                  ejecutar(() =>
                    onQuitarRequiereHumano({
                      leadId,
                      sessionId: requiereHumano.sessionId,
                      action: "resume",
                    }),
                  )
                }
                className="hover:text-danger shrink-0 rounded-[4px] opacity-70 transition-colors hover:opacity-100 disabled:opacity-40"
              >
                <Close size={11} />
              </button>
            </li>
          ) : null}
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
