import {
  ConflictError,
  DomainError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";

const logger = getLogger({ scope: "leads-actions" });

/** Mapea errores de service a mensaje curado para toast (detalle técnico solo a logs). */
export function toActionError(e: unknown, accion: string): { ok: false; error: string } {
  if (e instanceof ConflictError) {
    return { ok: false, error: "Este par ya fue resuelto o no existe. Refrescá la página." };
  }
  if (e instanceof NotFoundError) {
    return { ok: false, error: "Lead no encontrado. Refrescá la página." };
  }
  if (e instanceof ValidationError) {
    if (e.cause !== undefined) {
      logger.warn("validacion DB rechazo accion leads", { accion, code: e.code });
      return { ok: false, error: "Datos inválidos. Refrescá la página." };
    }
    return { ok: false, error: e.message };
  }
  if (e instanceof PermissionDeniedError) {
    logger.warn("permiso denegado en action leads", { accion, code: e.code });
    return { ok: false, error: "Solo un admin puede fusionar leads." };
  }
  if (e instanceof DomainError) {
    logger.warn("domain error en action leads", { accion, code: e.code, error: e.message });
    return { ok: false, error: "No se pudo completar la acción. Reintentá en unos segundos." };
  }
  logger.error("action leads inesperada falló", {
    accion,
    error: e instanceof Error ? e.message : String(e),
  });
  return { ok: false, error: "Error inesperado. Reintentá en unos segundos." };
}
