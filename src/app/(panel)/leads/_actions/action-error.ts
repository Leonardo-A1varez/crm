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
export function toActionError(
  e: unknown,
  accion: string,
  /**
   * Copys alternativos para las acciones de esta pantalla que no fusionan. Los
   * defaults hablan de fusionar leads porque ese es el grueso de `/leads`; en
   * una acción que reanuda la IA, ese texto sería una pista falsa.
   */
  opciones: { permisoDenegado?: string } = {},
): { ok: false; error: string } {
  if (e instanceof ConflictError) {
    return { ok: false, error: "Este par ya fue resuelto o no existe. Refrescá la página." };
  }
  if (e instanceof NotFoundError) {
    // merge_candidate inexistente: ya fue resuelto (approve/reject) o el par
    // fue CASCADE-borrado (perdedor eliminado). Copy de contrato distinta a
    // "lead no encontrado" — addendum §2.A fila 1.
    if (e.resource === "merge_candidate") {
      return { ok: false, error: "Este par ya fue resuelto o no existe. Refrescá la página." };
    }
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
    return { ok: false, error: opciones.permisoDenegado ?? "Solo un admin puede fusionar leads." };
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
