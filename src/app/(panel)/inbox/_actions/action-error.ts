import { ConflictError, DomainError, NotFoundError, ValidationError } from "@/lib/errors";
import { ConsoleLogger } from "@/lib/observability/logger";
import type { ActionResult } from "@/types/inbox";

const logger = new ConsoleLogger({ app: "crm", scope: "inbox-actions" });

/**
 * Mapea errores de service a mensaje user-friendly para toast. DomainError
 * esperado → mensaje específico sin log (flujo normal). Desconocido → log
 * error (PII redactada por ConsoleLogger) + mensaje genérico.
 */
export function toActionError(e: unknown, accion: string): ActionResult {
  if (e instanceof NotFoundError) {
    return { ok: false, error: "Lead, sesión o conversación no encontrada. Refrescá la página." };
  }
  if (e instanceof ConflictError) {
    return { ok: false, error: "La sesión ya está cerrada. Refrescá la página." };
  }
  if (e instanceof ValidationError) {
    return { ok: false, error: e.message };
  }
  if (e instanceof DomainError) {
    return { ok: false, error: e.message };
  }
  logger.error("action inesperada falló", {
    accion,
    error: e instanceof Error ? e.message : String(e),
  });
  return { ok: false, error: "Error inesperado. Reintentá en unos segundos." };
}
