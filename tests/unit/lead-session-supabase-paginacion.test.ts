import { describe, expect, it } from "vitest";
import type { AppClient } from "@/server/db/client";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";

/**
 * PostgREST devuelve como mucho 1.000 filas por request y no avisa (AGENTS.md,
 * lección 12). `listActive` y `listClosedBefore` alimentan los disparadores
 * programado y de inactividad —y la purga—: sin paginar, con más de 1.000
 * sesiones ignorarían leads en silencio.
 *
 * El fake aplica ese tope como lo hace PostgREST (`db-max-rows`): pida lo que
 * pida la consulta, nunca devuelve más de 1.000 filas.
 */
const MAX_ROWS_POSTGREST = 1000;

type Fila = Record<string, unknown> & { id: string };
type Filtro = (f: Fila) => boolean;

function filaDeSesion(i: number, cerrada: Date | null): Fila {
  // Ids ordenables y únicos, con la forma de un uuid.
  const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  return {
    id,
    lead_id: id,
    current_stage: "nuevo",
    etapa_alcanzada: "nuevo",
    urgencia: "media",
    consulta: null,
    producto_cotizado_id: null,
    codigo_interno: null,
    precio_cotizado: null,
    cantidad: null,
    bloqueador: null,
    comprobante_pago_url: null,
    metodo_pago: null,
    resultado: cerrada ? "perdido" : null,
    motivo_perdida: null,
    ia_pausada: false,
    stage_before_handoff: null,
    vendedor_asignado_id: null,
    asignado_at: null,
    extras: {},
    context_summary: null,
    procedencia: {},
    // Más nuevo cuanto mayor el índice: el orden de started_at no coincide con
    // el de id si se recorre al revés.
    started_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
    updated_at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    closed_at: cerrada ? cerrada.toISOString() : null,
  };
}

function fakePostgrest(filas: Fila[]): { db: AppClient; requests: () => number } {
  let requests = 0;
  const builder = () => {
    const filtros: Filtro[] = [];
    let orden: { col: string; asc: boolean }[] = [];
    let desde = 0;
    let hasta = Number.POSITIVE_INFINITY;
    const q = {
      select: () => q,
      is: (col: string, v: null) => (filtros.push((f) => f[col] === v), q),
      not: (col: string, op: string, v: null) => {
        if (op !== "is") throw new Error(`not.${op} sin soporte en el fake`);
        filtros.push((f) => f[col] !== v);
        return q;
      },
      lt: (col: string, v: string) => (
        filtros.push((f) => String(f[col] ?? "") < v && f[col] !== null),
        q
      ),
      gt: (col: string, v: string) => (filtros.push((f) => String(f[col]) > v), q),
      order: (col: string, o?: { ascending?: boolean }) => (
        orden.push({ col, asc: o?.ascending ?? true }),
        q
      ),
      limit: (n: number) => ((hasta = desde + n - 1), q),
      range: (a: number, b: number) => ((desde = a), (hasta = b), q),
      then: (resolve: (r: { data: Fila[]; error: null }) => unknown) => {
        requests++;
        let out = filas.filter((f) => filtros.every((p) => p(f)));
        if (orden.length > 0) {
          out = [...out].sort((a, b) => {
            for (const { col, asc } of orden) {
              const x = String(a[col]);
              const y = String(b[col]);
              if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
            }
            return 0;
          });
        }
        const pedidas = out.slice(desde, hasta + 1);
        return Promise.resolve({ data: pedidas.slice(0, MAX_ROWS_POSTGREST), error: null }).then(
          resolve,
        );
      },
    };
    orden = [];
    return q;
  };
  const db = { from: () => builder() } as unknown as AppClient;
  return { db, requests: () => requests };
}

describe("SupabaseLeadSessionRepository: lecturas de los disparadores con más de 1.000 sesiones", () => {
  const CORTE = new Date(Date.UTC(2026, 5, 1));
  const ANTES = new Date(Date.UTC(2026, 4, 1));
  const DESPUES = new Date(Date.UTC(2026, 6, 1));

  const activas = Array.from({ length: 2345 }, (_, i) => filaDeSesion(i, null));
  const cerradasAntes = Array.from({ length: 1501 }, (_, i) => filaDeSesion(10_000 + i, ANTES));
  const cerradasDespues = Array.from({ length: 7 }, (_, i) => filaDeSesion(20_000 + i, DESPUES));
  const filas = [...cerradasDespues, ...activas, ...cerradasAntes];

  it("listActive trae todas las activas, no las primeras 1.000", async () => {
    const { db, requests } = fakePostgrest(filas);
    const out = await new SupabaseLeadSessionRepository(db).listActive();
    expect(out).toHaveLength(activas.length);
    expect(new Set(out.map((s) => s.id)).size).toBe(activas.length);
    expect(requests()).toBeGreaterThan(1);
  });

  it("listActive sigue ordenando por started_at, de la más nueva a la más vieja", async () => {
    const { db } = fakePostgrest(filas);
    const out = await new SupabaseLeadSessionRepository(db).listActive();
    const fechas = out.map((s) => s.started_at.getTime());
    expect(fechas).toEqual([...fechas].sort((a, b) => b - a));
  });

  it("listClosedBefore trae todas las cerradas antes del corte, no las primeras 1.000", async () => {
    const { db } = fakePostgrest(filas);
    const out = await new SupabaseLeadSessionRepository(db).listClosedBefore(CORTE);
    expect(out).toHaveLength(cerradasAntes.length);
    expect(out.every((s) => s.closed_at !== null && s.closed_at < CORTE)).toBe(true);
  });

  it("con exactamente 1.000 filas no se queda sin la última página ni pide de más", async () => {
    const justas = Array.from({ length: 1000 }, (_, i) => filaDeSesion(i, null));
    const { db, requests } = fakePostgrest(justas);
    expect(await new SupabaseLeadSessionRepository(db).listActive()).toHaveLength(1000);
    expect(requests()).toBe(2);
  });
});
