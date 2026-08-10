import { Sell } from "@/components/icons";
import { EmptyState } from "@/components/shared/EmptyState";
import { tagColorLabel } from "@/lib/ui/tag-color";
import { TagBadge } from "./TagBadge";
import { TagRowActions } from "./TagRowActions";
import type { TagFormValues } from "./TagFormDialog";
import type { ActionResult } from "@/types/inbox";
import type { BorrarTagResult, TagListItem } from "@/types/tags";

// Encabezado y filas comparten la plantilla de columnas (handoff §2), así que
// vive en una sola constante: si se desincronizan, las columnas dejan de
// alinearse y el defecto es invisible leyendo el diff. La última columna solo
// existe para el admin — el vendedor tiene lectura sobre `tags`.
const FILA = "grid items-center gap-[14px] px-[18px] py-[11px]";
const COLS_ADMIN = "grid-cols-[1.2fr_2fr_0.7fr_1fr]";
const COLS_LECTURA = "grid-cols-[1.2fr_2fr_0.7fr]";
const TH = "text-ink-faint font-mono text-[9px] font-semibold tracking-[0.13em] uppercase";

export function TagsTable({
  tags,
  isAdmin,
  onEditar,
  onBorrar,
}: {
  tags: TagListItem[];
  isAdmin: boolean;
  onEditar: (input: TagFormValues & { id: string }) => Promise<ActionResult>;
  onBorrar: (input: { id: string }) => Promise<BorrarTagResult>;
}) {
  if (tags.length === 0) {
    return (
      <EmptyState
        icon={<Sell size={34} strokeWidth={1.4} />}
        title="Sin etiquetas todavía"
        description={
          isAdmin
            ? "Creá la primera desde «Nueva etiqueta». También se crean solas cuando un vendedor escribe una etiqueta nueva en la conversación."
            : "Las etiquetas las administra un administrador. También se crean solas cuando escribís una nueva en la conversación."
        }
      />
    );
  }

  const cols = isAdmin ? COLS_ADMIN : COLS_LECTURA;

  return (
    // Divs con roles ARIA y no `<table>`: la plantilla de columnas en `fr` del
    // handoff necesita `display:grid` en la fila, y eso descarta el layout de
    // tabla nativo. Los roles mantienen la semántica para el lector de pantalla.
    <div className="bg-surface-card border-line-card overflow-hidden rounded-[15px] border">
      <div role="table" aria-label="Etiquetas">
        <div role="rowgroup">
          <div role="row" className={`${FILA} ${cols}`}>
            <span role="columnheader" className={TH}>
              Etiqueta
            </span>
            <span role="columnheader" className={TH}>
              Descripción
            </span>
            <span role="columnheader" className={`${TH} text-right`}>
              Leads
            </span>
            {isAdmin ? (
              <span role="columnheader" className={`${TH} text-right`}>
                Acciones
              </span>
            ) : null}
          </div>
        </div>

        <div role="rowgroup">
          {tags.map((t) => (
            <div
              key={t.id}
              role="row"
              className={`${FILA} ${cols} border-line-row hover:bg-line-row border-t transition-colors`}
            >
              <span role="cell" className="min-w-0" title={tagColorLabel(t.color)}>
                <TagBadge nombre={t.nombre} color={t.color} />
              </span>

              <span role="cell" className="text-ink-muted truncate text-[11.5px]">
                {t.descripcion ?? "—"}
              </span>

              {/* El conteo es el costo de borrarla: se muestra siempre, también
                  en 0, porque un 0 es la señal de que la baja es inocua. */}
              <span
                role="cell"
                className={`text-right font-mono text-[11px] tabular-nums ${
                  t.leadsUsando === 0 ? "text-ink-ghost" : "text-ink-dim"
                }`}
              >
                {t.leadsUsando}
              </span>

              {isAdmin ? (
                <span role="cell">
                  <TagRowActions tag={t} onEditar={onEditar} onBorrar={onBorrar} />
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
