/**
 * Mapping de errores PostgREST/Postgres a DomainError taxonomy.
 *
 * Codes Postgres relevantes (consultar pg docs full list):
 * - 23505 unique_violation         → ConflictError
 * - 23503 foreign_key_violation    → ConflictError
 * - 23502 not_null_violation       → ValidationError
 * - 23514 check_violation          → ValidationError
 * - 42501 insufficient_privilege   → PermissionDeniedError
 * - P0002 no_data_found            → NotFoundError
 *
 * Codes PostgREST custom:
 * - PGRST116 no rows (single())    → caller decide (null vs NotFoundError)
 * - PGRST301 JWT expired           → PermissionDeniedError
 */

import {
  ConflictError,
  InfraError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@/lib/errors";

export interface PostgrestErrorLike {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

export function isPostgrestError(e: unknown): e is PostgrestErrorLike {
  if (typeof e !== "object" || e === null) return false;
  const obj = e as Record<string, unknown>;
  return typeof obj["message"] === "string" && "code" in obj;
}

/**
 * Map a PostgREST error a DomainError. Los códigos no clasificados son fallas
 * reintentables de infraestructura, nunca `Error` plano.
 */
export function mapPostgrestError(
  err: PostgrestErrorLike,
  context: { resource?: string } = {},
): import("@/lib/errors").DomainError {
  const code = err.code ?? "";
  const msg = `${err.message}${err.details ? ` (${err.details})` : ""}`;

  switch (code) {
    case "23505":
      return new ConflictError(msg, "unique_violation", err);
    case "23503":
      return new ConflictError(msg, "foreign_key_violation", err);
    case "23502":
      return new ValidationError(msg, { code, resource: context.resource }, err);
    case "23514":
      return new ValidationError(msg, { code, resource: context.resource }, err);
    // Lo levantan las funciones PL/pgSQL con `RAISE ... USING ERRCODE` cuando
    // la fila que iban a tocar no está, y `SELECT INTO STRICT` sin resultados.
    // Sin este caso caían al fallback `InfraError`, que es **retriable**: un
    // workflow reintentaba hasta agotarse buscando algo que no existe.
    case "P0002":
      // `id` va vacío: el error viene de Postgres y no trae cuál era la fila.
      // El mensaje del RPC sí nombra qué no encontró.
      return new NotFoundError(msg, context.resource ?? "desconocido", "", err);
    case "42501":
    case "PGRST301":
      return new PermissionDeniedError(msg, err);
    default:
      return new InfraError(`PostgREST error [${code}]: ${msg}`, "postgrest", err);
  }
}

/**
 * Throw-or-return helper para queries Supabase. Si `error` presente, mapea + throw.
 * Si `data` null + caller espera row, retornar null (caller decide NotFoundError).
 */
export function unwrapOrThrow<T>(
  result: { data: T | null; error: PostgrestErrorLike | null },
  context: { resource?: string } = {},
): T | null {
  if (result.error) {
    throw mapPostgrestError(result.error, context);
  }
  return result.data;
}
