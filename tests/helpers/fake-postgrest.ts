import type { AppClient } from "@/server/db/client";

/**
 * PostgREST devuelve como mucho `max_rows` filas por request —1.000 en
 * `supabase/config.toml` y en Supabase Cloud— y no avisa (AGENTS.md, lección
 * 12). Este doble aplica ese tope igual que el servidor: pida lo que pida la
 * consulta, nunca devuelve más de 1.000 filas, ni desde una tabla ni desde un
 * RPC que devuelve un conjunto.
 *
 * Solo implementa los filtros que usan los repos que se prueban con él. Un
 * operador que no conoce explota, para que un test no pase por un filtro que el
 * fake ignoró en silencio.
 */
export const MAX_ROWS_POSTGREST = 1000;

export type Fila = Record<string, unknown>;
type Filtro = (f: Fila) => boolean;
type HandlerRpc = (args: Record<string, unknown>) => unknown;

function comparar(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** `%texto%` de un ILIKE a regex, respetando los escapes de `escaparLike`. */
function ilikeARegex(patron: string): RegExp {
  let re = "";
  for (let i = 0; i < patron.length; i++) {
    const c = patron[i] as string;
    if (c === "\\" && i + 1 < patron.length) {
      re += (patron[++i] as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (c === "%") re += ".*";
    else if (c === "_") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "is");
}

export interface FakePostgrest {
  db: AppClient;
  /** Requests que llegaron al "servidor", sumando tablas y RPCs. */
  requests: () => number;
  /** Argumentos de cada llamada a un RPC, en orden. */
  llamadasRpc: (nombre: string) => Record<string, unknown>[];
}

export function fakePostgrest(
  tablas: Record<string, Fila[]>,
  rpcs: Record<string, HandlerRpc> = {},
): FakePostgrest {
  let requests = 0;
  const llamadas = new Map<string, Record<string, unknown>[]>();

  const builder = (tabla: string) => {
    const filas = tablas[tabla];
    if (filas === undefined) throw new Error(`tabla ${tabla} sin filas en el fake`);
    const filtros: Filtro[] = [];
    const orden: { col: string; asc: boolean }[] = [];
    let desde = 0;
    let hasta = Number.POSITIVE_INFINITY;
    let soloConteo = false;

    const q = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head) {
          if (opts.count !== "exact") throw new Error("head sin count exact no está en el fake");
          soloConteo = true;
        }
        return q;
      },
      eq: (col: string, v: unknown) => (filtros.push((f) => f[col] === v), q),
      is: (col: string, v: null) => (filtros.push((f) => (f[col] ?? null) === v), q),
      not: (col: string, op: string, v: null) => {
        if (op !== "is") throw new Error(`not.${op} sin soporte en el fake`);
        filtros.push((f) => (f[col] ?? null) !== v);
        return q;
      },
      in: (col: string, vs: unknown[]) => (filtros.push((f) => vs.includes(f[col])), q),
      lt: (col: string, v: unknown) => (
        filtros.push((f) => f[col] != null && comparar(f[col], v) < 0),
        q
      ),
      lte: (col: string, v: unknown) => (
        filtros.push((f) => f[col] != null && comparar(f[col], v) <= 0),
        q
      ),
      gt: (col: string, v: unknown) => (
        filtros.push((f) => f[col] != null && comparar(f[col], v) > 0),
        q
      ),
      gte: (col: string, v: unknown) => (
        filtros.push((f) => f[col] != null && comparar(f[col], v) >= 0),
        q
      ),
      ilike: (col: string, patron: string) => {
        const re = ilikeARegex(patron);
        filtros.push((f) => typeof f[col] === "string" && re.test(f[col] as string));
        return q;
      },
      order: (col: string, o?: { ascending?: boolean }) => (
        orden.push({ col, asc: o?.ascending ?? true }),
        q
      ),
      limit: (n: number) => ((hasta = desde + n - 1), q),
      range: (a: number, b: number) => ((desde = a), (hasta = b), q),
      then: <R>(resolve: (r: unknown) => R, reject?: (e: unknown) => R) => {
        requests++;
        let out = filas.filter((f) => filtros.every((p) => p(f)));
        if (soloConteo) {
          return Promise.resolve({ data: null, count: out.length, error: null }).then(
            resolve,
            reject,
          );
        }
        if (orden.length > 0) {
          out = [...out].sort((a, b) => {
            for (const { col, asc } of orden) {
              const c = comparar(a[col], b[col]);
              if (c !== 0) return asc ? c : -c;
            }
            return 0;
          });
        }
        const pedidas = out.slice(desde, hasta + 1).slice(0, MAX_ROWS_POSTGREST);
        return Promise.resolve({ data: pedidas.map((f) => ({ ...f })), error: null }).then(
          resolve,
          reject,
        );
      },
    };
    return q;
  };

  const rpc = (nombre: string, args: Record<string, unknown> = {}) => {
    const handler = rpcs[nombre];
    if (handler === undefined) throw new Error(`rpc ${nombre} sin handler en el fake`);
    const lista = llamadas.get(nombre) ?? [];
    lista.push(args);
    llamadas.set(nombre, lista);
    return {
      then: <R>(resolve: (r: unknown) => R, reject?: (e: unknown) => R) => {
        requests++;
        const data = handler(args);
        const recortada = Array.isArray(data) ? data.slice(0, MAX_ROWS_POSTGREST) : data;
        return Promise.resolve({ data: recortada, error: null }).then(resolve, reject);
      },
    };
  };

  const db = { from: (tabla: string) => builder(tabla), rpc } as unknown as AppClient;
  return { db, requests: () => requests, llamadasRpc: (n) => llamadas.get(n) ?? [] };
}

/** Uuid v4 ordenable armado a mano: el orden de `n` es el orden del id. */
export function uuidDe(n: number, prefijo = "00000000"): string {
  return `${prefijo}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}
