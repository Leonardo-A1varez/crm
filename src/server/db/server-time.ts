import { InfraError } from "@/lib/errors";
import type { AppClient } from "./client";
import { mapPostgrestError } from "./postgrest-errors";

/**
 * Server-side now() via RPC. Evita clock skew JS↔Postgres en columnas
 * timestamptz con `default now()` updateadas desde client.
 *
 * Backed by SQL function `public.server_now()` (migration
 * `20260514000016_repo_helpers.sql`). Costo: 1 roundtrip extra. Llamarlo
 * solo cuando el caller no provee timestamp explícito y la monotonicidad
 * vs default INSERT importa.
 */
export async function serverNowIso(db: AppClient): Promise<string> {
  const { data, error } = await db.rpc("server_now");
  if (error) throw mapPostgrestError(error, { resource: "server_now" });
  if (data === null) {
    throw new InfraError("server_now() devolvió null inesperadamente", "postgrest");
  }
  return data;
}
