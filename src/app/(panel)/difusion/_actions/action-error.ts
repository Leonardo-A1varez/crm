import {
  BudgetExceededError,
  ConflictError,
  DomainError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";

const logger = getLogger({ scope: "difusion-actions" });

export type ResultadoAccion<T> = { ok: true; datos: T } | { ok: false; error: string };

/**
 * De un error del servicio al texto que lee la persona. El detalle técnico
 * queda en el log del servidor; a la pantalla va un texto curado, salvo los
 * que el propio servicio ya escribió para ella (validaciones y conflictos de
 * estado).
 */
export function errorDeAccion(e: unknown, accion: string): { ok: false; error: string } {
  if (e instanceof ValidationError) return { ok: false, error: e.message };
  if (e instanceof BudgetExceededError) {
    return {
      ok: false,
      error:
        "No hay cupo de mensajería para plantillas: lo que queda de las últimas 24 h no supera la reserva para conversaciones vivas. La difusión no se programó.",
    };
  }
  if (e instanceof ConflictError) {
    return {
      ok: false,
      error:
        e.conflictType === "estado_difusion"
          ? e.message
          : "La difusión cambió mientras la mirabas. Recargá la página.",
    };
  }
  if (e instanceof NotFoundError) {
    return { ok: false, error: "La difusión no existe o ya no está. Recargá la página." };
  }
  if (e instanceof PermissionDeniedError) {
    logger.warn("permiso denegado en una accion de difusion", { accion, code: e.code });
    return { ok: false, error: "Solo un administrador puede hacer esto." };
  }
  if (e instanceof DomainError) {
    logger.warn("error de dominio en una accion de difusion", { accion, code: e.code });
    return { ok: false, error: "No se pudo completar. Reintentá en unos segundos." };
  }
  logger.error("accion de difusion fallo sin un error de dominio", {
    accion,
    detalle: e instanceof Error ? e.message : String(e),
  });
  return { ok: false, error: "Error inesperado. Reintentá en unos segundos." };
}
