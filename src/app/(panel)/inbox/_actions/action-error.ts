import {
  ConflictError,
  DomainError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";
import type { ActionError } from "@/types/inbox";

const logger = getLogger({ scope: "inbox-actions" });

/**
 * Mapea errores de service a mensaje user-friendly para toast. El detalle
 * técnico (respuestas Graph API, ids, stack) queda en logs server-side; al
 * cliente solo van mensajes curados — evita information disclosure en UI.
 */
export function toActionError(
  e: unknown,
  accion: string,
  /**
   * Copys alternativos para las acciones que no son de mensajería. Los defaults
   * hablan de la sesión y de la Graph API porque ese es el grueso del inbox;
   * en las que escriben etiquetas o el nombre del lead, esos textos serían una
   * pista falsa.
   */
  opciones: { permisoDenegado?: string; conflicto?: string } = {},
): ActionError {
  if (e instanceof NotFoundError) {
    return { ok: false, error: "Lead, sesión o conversación no encontrada. Refrescá la página." };
  }
  if (e instanceof ConflictError) {
    return {
      ok: false,
      error: opciones.conflicto ?? "La sesión ya está cerrada. Refrescá la página.",
    };
  }
  if (e instanceof ValidationError) {
    // Accionable para el operador (p.ej. canal sin configurar). Sin secrets.
    return { ok: false, error: e.message };
  }
  if (e instanceof PermissionDeniedError) {
    logger.warn("permiso denegado en action", { accion, code: e.code });
    return {
      ok: false,
      error:
        opciones.permisoDenegado ??
        "El canal de mensajería rechazó la autenticación. Avisá al administrador.",
    };
  }
  if (e instanceof DomainError) {
    logger.warn("domain error en action", { accion, code: e.code, error: e.message });
    return { ok: false, error: "No se pudo completar la acción. Reintentá en unos segundos." };
  }
  logger.error("action inesperada falló", {
    accion,
    error: e instanceof Error ? e.message : String(e),
  });
  return { ok: false, error: "Error inesperado. Reintentá en unos segundos." };
}
