import { InfraError, RateLimitError, ValidationError } from "@/lib/errors";

/**
 * Lo que dice un error del cliente de la Graph API (`GraphApiMetaClient`)
 * sobre si el mensaje salió.
 *
 * El cliente guarda `{ status, code }` de la respuesta en `issues` (400/401/403
 * → `ValidationError`) o en `cause` (429 → `RateLimitError`, 5xx →
 * `InfraError`). Acá se lee de vuelta.
 *
 * - `rechazo`: Meta respondió que no lo manda. El código dice por qué.
 * - `ritmo`: Meta pidió bajar el ritmo. No salió.
 * - `credencial`: token vencido o sin permiso. No es culpa del destinatario.
 * - `desconocido`: no hubo respuesta, o Meta respondió 5xx. Pudo haber salido.
 */
export interface ErrorDeGraph {
  codigo: string | null;
  status: number | null;
  clase: "rechazo" | "ritmo" | "credencial" | "desconocido";
}

interface ContextoGraph {
  status?: unknown;
  code?: unknown;
}

function contexto(v: unknown): ContextoGraph {
  return typeof v === "object" && v !== null ? (v as ContextoGraph) : {};
}

function codigoDe(ctx: ContextoGraph): string | null {
  const c = ctx.code;
  if (typeof c === "number" && Number.isInteger(c)) return String(c);
  if (typeof c === "string" && /^\d{1,10}$/.test(c)) return c;
  return null;
}

function statusDe(ctx: ContextoGraph): number | null {
  return typeof ctx.status === "number" && Number.isInteger(ctx.status) ? ctx.status : null;
}

export function errorDeGraph(error: unknown): ErrorDeGraph {
  if (error instanceof RateLimitError) {
    const ctx = contexto(error.cause);
    return { codigo: codigoDe(ctx), status: statusDe(ctx), clase: "ritmo" };
  }
  if (error instanceof ValidationError) {
    const ctx = contexto(error.issues);
    const status = statusDe(ctx);
    return {
      codigo: codigoDe(ctx),
      status,
      clase: status === 401 || status === 403 ? "credencial" : "rechazo",
    };
  }
  if (error instanceof InfraError) {
    const ctx = contexto(error.cause);
    return { codigo: codigoDe(ctx), status: statusDe(ctx), clase: "desconocido" };
  }
  return { codigo: null, status: null, clase: "desconocido" };
}
