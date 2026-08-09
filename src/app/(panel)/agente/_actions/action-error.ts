import {
  ConflictError,
  DomainError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";

const logger = getLogger({ scope: "agente-actions" });

/**
 * Mapea errores de service a mensaje curado para toast (detalle técnico solo
 * a logs). Copia de `leads/_actions/action-error.ts` adaptada al dominio de
 * `/agente` — la deuda de extraer un `toActionError` compartido ya está
 * registrada en el backlog de fase 11, no se resuelve acá.
 */
export function toActionError(e: unknown, accion: string): { ok: false; error: string } {
  if (e instanceof ConflictError) {
    // Índice único parcial "una sola activa" (spec §10): dos admins guardando
    // a la vez hacen fallar la segunda activación.
    return { ok: false, error: "Otra persona cambió la configuración. Refrescá la página." };
  }
  if (e instanceof NotFoundError) {
    if (e.resource === "lead_session") {
      return {
        ok: false,
        error: "Esa sesión ya no está disponible. Elegí otra para previsualizar.",
      };
    }
    return { ok: false, error: "Versión de configuración no encontrada. Refrescá la página." };
  }
  if (e instanceof ValidationError) {
    if (e.cause !== undefined) {
      logger.warn("validacion DB rechazo accion agente", { accion, code: e.code });
      return { ok: false, error: "Datos inválidos. Refrescá la página." };
    }
    return { ok: false, error: e.message };
  }
  if (e instanceof PermissionDeniedError) {
    logger.warn("permiso denegado en action agente", { accion, code: e.code });
    return { ok: false, error: "Solo un admin puede cambiar la configuración del agente." };
  }
  if (e instanceof DomainError) {
    logger.warn("domain error en action agente", { accion, code: e.code, error: e.message });
    return { ok: false, error: "No se pudo completar la acción. Reintentá en unos segundos." };
  }
  logger.error("action agente inesperada falló", {
    accion,
    error: e instanceof Error ? e.message : String(e),
  });
  return { ok: false, error: "Error inesperado. Reintentá en unos segundos." };
}
