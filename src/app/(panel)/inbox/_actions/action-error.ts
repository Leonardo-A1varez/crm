import {
  ConflictError,
  DomainError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@/lib/errors";
import { ConsoleLogger } from "@/lib/observability/logger";
import type { ActionResult } from "@/types/inbox";

const logger = new ConsoleLogger({ app: "crm", scope: "inbox-actions" });

/**
 * Mapea errores de service a mensaje user-friendly para toast. El detalle
 * técnico (respuestas Graph API, ids, stack) queda en logs server-side; al
 * cliente solo van mensajes curados — evita information disclosure en UI.
 */
export function toActionError(e: unknown, accion: string): ActionResult {
  if (e instanceof NotFoundError) {
    return { ok: false, error: "Lead, sesión o conversación no encontrada. Refrescá la página." };
  }
  if (e instanceof ConflictError) {
    return { ok: false, error: "La sesión ya está cerrada. Refrescá la página." };
  }
  if (e instanceof ValidationError) {
    // Accionable para el operador (p.ej. canal sin configurar). Sin secrets.
    return { ok: false, error: e.message };
  }
  if (e instanceof PermissionDeniedError) {
    logger.warn("meta auth rechazada en action", { accion, code: e.code });
    return {
      ok: false,
      error: "El canal de mensajería rechazó la autenticación. Avisá al administrador.",
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
