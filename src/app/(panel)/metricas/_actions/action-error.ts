import {
  ConflictError,
  DomainError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";

const logger = getLogger({ scope: "metricas-actions" });

export function toActionError(
  e: unknown,
  accion: string,
  opciones: { permisoDenegado?: string; conflicto?: string; noEncontrado?: string } = {},
): { ok: false; error: string } {
  if (e instanceof ConflictError) {
    return { ok: false, error: opciones.conflicto ?? "Ya existe una campaña con esos datos." };
  }
  if (e instanceof NotFoundError) {
    return {
      ok: false,
      error: opciones.noEncontrado ?? "Campaña no encontrada. Refrescá la página.",
    };
  }
  if (e instanceof ValidationError) {
    return { ok: false, error: e.message };
  }
  if (e instanceof PermissionDeniedError) {
    logger.warn("permiso denegado en action metricas", { accion, code: e.code });
    return {
      ok: false,
      error: opciones.permisoDenegado ?? "Solo un administrador puede gestionar campañas.",
    };
  }
  if (e instanceof DomainError) {
    logger.warn("domain error en action metricas", { accion, code: e.code, error: e.message });
    return { ok: false, error: "No se pudo completar la acción. Reintentá en unos segundos." };
  }
  logger.error("action metricas inesperada falló", {
    accion,
    error: e instanceof Error ? e.message : String(e),
  });
  return { ok: false, error: "Error inesperado. Reintentá en unos segundos." };
}
