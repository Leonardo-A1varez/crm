import {
  ConflictError,
  DomainError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";

const logger = getLogger({ scope: "productos-actions" });

/**
 * Mapea errores de service a mensaje user-friendly para toast. Detalle técnico
 * queda en logs server-side; al cliente solo mensajes curados. Retorna la rama
 * failure para poder usarse en action results tipados (import CSV).
 */
export function toActionError(e: unknown, accion: string): { ok: false; error: string } {
  if (e instanceof ConflictError) {
    return { ok: false, error: "Ya existe un producto con ese código interno." };
  }
  if (e instanceof NotFoundError) {
    return { ok: false, error: "Producto no encontrado. Refrescá la página." };
  }
  if (e instanceof ValidationError) {
    // Con cause = origen DB (mapPostgrestError, codes 23502/23514): el mensaje
    // trae detalle crudo de Postgres (constraint/columna) — no exponer al toast,
    // solo loguear server-side. Sin cause = mensaje de dominio curado a mano
    // (ej. CSV inválido, canal sin configurar): accionable para el operador,
    // pasa tal cual.
    if (e.cause !== undefined) {
      logger.warn("validacion DB rechazo escritura productos", {
        accion,
        code: e.code,
        error: e.message,
      });
      return { ok: false, error: "Datos inválidos: revisá precio y stock (deben ser ≥ 0)." };
    }
    return { ok: false, error: e.message };
  }
  if (e instanceof PermissionDeniedError) {
    logger.warn("permiso denegado en action productos", { accion, code: e.code });
    return { ok: false, error: "No tenés permisos para modificar el catálogo (solo admin)." };
  }
  if (e instanceof DomainError) {
    logger.warn("domain error en action productos", { accion, code: e.code, error: e.message });
    return { ok: false, error: "No se pudo completar la acción. Reintentá en unos segundos." };
  }
  logger.error("action productos inesperada falló", {
    accion,
    error: e instanceof Error ? e.message : String(e),
  });
  return { ok: false, error: "Error inesperado. Reintentá en unos segundos." };
}
