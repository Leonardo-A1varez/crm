import type { EstadoDifusion } from "./tipos";

/**
 * Cómo se nombra y de qué color va cada estado de una difusión. Un solo lugar
 * para el listado y la pantalla de envío: el mismo estado con dos nombres en
 * dos pantallas termina leyéndose como dos estados.
 *
 * `en_revision` es "En revisión" y no "Canary en revisión": una persona
 * también puede pausar un envío, y queda en el mismo estado.
 */
export const ESTADO_DIFUSION: Record<EstadoDifusion, { etiqueta: string; color: string }> = {
  borrador: { etiqueta: "Borrador", color: "var(--color-ink-faint)" },
  programada: { etiqueta: "Programada", color: "var(--color-info)" },
  enviando: { etiqueta: "Enviando", color: "var(--color-info)" },
  en_revision: { etiqueta: "En revisión", color: "var(--color-caution)" },
  completada: { etiqueta: "Completada", color: "var(--color-ok)" },
  detenida: { etiqueta: "Detenida", color: "var(--color-danger)" },
};
