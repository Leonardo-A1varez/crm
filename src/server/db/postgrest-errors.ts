/**
 * Mapping de errores PostgREST/Postgres a DomainError taxonomy.
 *
 * Codes Postgres relevantes (consultar pg docs full list):
 * - 23505 unique_violation         → ConflictError
 * - 23503 foreign_key_violation    → ConflictError
 * - 23502 not_null_violation       → ValidationError
 * - 23514 check_violation          → ValidationError
 * - 42501 insufficient_privilege   → PermissionDeniedError
 *
 * Codes PostgREST custom:
 * - PGRST116 no rows (single())    → caller decide (null vs NotFoundError)
 * - PGRST301 JWT expired           → PermissionDeniedError
 */

import { ConflictError, PermissionDeniedError, ValidationError } from "@/lib/errors";

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
 * Map a Postgrest error a DomainError correspondiente. Si no matchea code conocido,
 * retorna un Error genérico (caller decide qué hacer — típicamente re-throw raw).
 */
export function mapPostgrestError(
  err: PostgrestErrorLike,
  context: { resource?: string } = {},
): Error {
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
    case "42501":
    case "PGRST301":
      return new PermissionDeniedError(msg, err);
    default:
      return new Error(`Postgrest error [${code}]: ${msg}`, { cause: err });
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
