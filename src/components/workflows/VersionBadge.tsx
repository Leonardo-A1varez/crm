import { cn } from "@/lib/utils";

export type VersionEstado = "draft" | "published" | "archived";

interface VersionBadgeProps {
  estado: VersionEstado;
  className?: string;
}

const ESTILOS: Record<VersionEstado, string> = {
  draft: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  published: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  archived: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
};

const ETIQUETAS: Record<VersionEstado, string> = {
  draft: "Borrador",
  published: "Publicada",
  archived: "Archivada",
};

/**
 * Badge visual que indica el estado de una versión de workflow.
 *
 * - draft (ámbar): versión en edición, no ejecuta
 * - published (verde): versión activa, es la que corre
 * - archived (gris): versión anterior, ya no ejecuta
 */
export function VersionBadge({ estado, className }: VersionBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        ESTILOS[estado],
        className,
      )}
    >
      {ETIQUETAS[estado]}
    </span>
  );
}

/**
 * Convierte el estado booleano `publicada` de WorkflowVersion al enum.
 *
 * Hoy no hay estado `archived` persistido en la DB — una versión que deja de
 * estar publicada vuelve a ser draft. Cuando se agregue el estado a la tabla,
 * este helper debería leer de un campo `estado` directamente.
 */
export function estadoDeVersion(publicada: boolean): VersionEstado {
  return publicada ? "published" : "draft";
}
