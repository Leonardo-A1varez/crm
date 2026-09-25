import { describe, expect, it } from "vitest";
import { SupabaseMetricsRepository } from "@/server/repositories/metrics.supabase.repo";
import { fakePostgrest, uuidDe, type Fila } from "../helpers/fake-postgrest";

/**
 * Las lecturas de Métricas recorren ventanas enteras —30 días de mensajes son
 * decenas de miles de filas— y PostgREST corta en 1.000 sin avisar (AGENTS.md,
 * lección 12). Las que el service necesita como filas se paginan; las que solo
 * se cuentan o suman se agregan en la base.
 */

const iso = (ms: number) => new Date(ms).toISOString();
const DESDE = new Date(Date.UTC(2026, 8, 1));
const HASTA = new Date(Date.UTC(2026, 9, 1));
const DENTRO = DESDE.getTime() + 60_000;
const FUERA = DESDE.getTime() - 60_000;

function dentroYFuera(n: number, fuera: number, fila: (i: number, ms: number) => Fila): Fila[] {
  return [
    ...Array.from({ length: fuera }, (_, i) => fila(100_000 + i, FUERA - i * 1000)),
    ...Array.from({ length: n }, (_, i) => fila(i, DENTRO + i * 1000)),
  ];
}

/** El filtro de ventana que aplican los RPC de métricas: `[desde, hasta)`. */
function enVentana(args: Record<string, unknown>, f: Fila): boolean {
  const t = String(f["created_at"]);
  return t >= String(args["p_desde"]) && t < String(args["p_hasta"]);
}

describe("SupabaseMetricsRepository con más de 1.000 filas en la ventana", () => {
  it("listSesionesDesde trae todas las sesiones de la ventana", async () => {
    const lead_session = dentroYFuera(2300, 40, (i, ms) => ({
      id: uuidDe(i),
      current_stage: "nuevo",
      resultado: null,
      motivo_perdida: null,
      started_at: iso(ms),
      precio_cotizado: "12.5",
      codigo_interno: null,
      closed_at: null,
      cantidad: null,
    }));
    const { db } = fakePostgrest({ lead_session });
    const out = await new SupabaseMetricsRepository(db).listSesionesDesde(DESDE, HASTA);
    expect(out).toHaveLength(2300);
    expect(new Set(out.map((s) => s.id)).size).toBe(2300);
    expect(out[0]?.precio_cotizado).toBe(12.5);
  });

  it("listMensajesDesde trae todos los mensajes de la ventana", async () => {
    const mensajes = dentroYFuera(3456, 25, (i, ms) => ({
      id: uuidDe(i),
      sender: "lead",
      created_at: iso(ms),
      platform_created_at: null,
      lead_session_id: uuidDe(i % 7, "99999999"),
      sender_user_id: null,
      conversaciones: { canal: "wa" },
    }));
    const { db } = fakePostgrest({ mensajes });
    const out = await new SupabaseMetricsRepository(db).listMensajesDesde(DESDE, HASTA);
    expect(out).toHaveLength(3456);
    expect(out.every((m) => m.canal === "wa")).toBe(true);
  });

  it("listToolExecutionsDesde trae todas las llamadas de la ventana", async () => {
    const tool_executions = dentroYFuera(1500, 10, (i, ms) => ({
      id: uuidDe(i),
      tool_name: "buscar_repuesto",
      created_at: iso(ms),
      error: null,
      args: { query: "radiador" },
    }));
    const { db } = fakePostgrest({ tool_executions });
    const out = await new SupabaseMetricsRepository(db).listToolExecutionsDesde(DESDE, HASTA);
    expect(out).toHaveLength(1500);
    expect(out[0]?.args).toEqual({ query: "radiador", marca: undefined, modelo: undefined });
  });

  it("contarLeadsDesde cuenta en la base todos los leads de la ventana", async () => {
    const leads = dentroYFuera(2100, 30, (i, ms) => ({ id: uuidDe(i), created_at: iso(ms) }));
    const { db } = fakePostgrest({ leads });
    expect(await new SupabaseMetricsRepository(db).contarLeadsDesde(DESDE, HASTA)).toBe(2100);
  });

  it("contarRuleExecutionsDesde cuenta en la base todos los turnos de regla", async () => {
    const rule_executions = dentroYFuera(1700, 30, (i, ms) => ({
      id: uuidDe(i),
      created_at: iso(ms),
    }));
    const { db } = fakePostgrest({ rule_executions });
    expect(await new SupabaseMetricsRepository(db).contarRuleExecutionsDesde(DESDE, HASTA)).toBe(
      1700,
    );
  });

  it("contarClasificacionesPorIntent agrupa en la base, con la ventana pedida", async () => {
    const INTENT = uuidDe(1, "11111111");
    const filas = dentroYFuera(1900, 20, (i, ms) => ({
      intent_id: i % 4 === 0 ? null : INTENT,
      created_at: iso(ms),
    }));
    const f = fakePostgrest(
      {},
      {
        metricas_clasificaciones_por_intent: (args) => {
          const porIntent = new Map<string | null, number>();
          for (const x of filas.filter((x) => enVentana(args, x))) {
            const k = x["intent_id"] as string | null;
            porIntent.set(k, (porIntent.get(k) ?? 0) + 1);
          }
          // bigint viaja como string en JSON cuando no entra en un double.
          return [...porIntent].map(([intent_id, turnos]) => ({ intent_id, turnos: `${turnos}` }));
        },
      },
    );
    const out = await new SupabaseMetricsRepository(f.db).contarClasificacionesPorIntent(
      DESDE,
      HASTA,
    );
    expect(out).toContainEqual({ intent_id: INTENT, turnos: 1425 });
    expect(out).toContainEqual({ intent_id: null, turnos: 475 });
    expect(f.llamadasRpc("metricas_clasificaciones_por_intent")).toEqual([
      { p_desde: DESDE.toISOString(), p_hasta: HASTA.toISOString() },
    ]);
  });

  it("contarPausasPorMotivo agrupa en la base", async () => {
    const f = fakePostgrest(
      {},
      {
        metricas_pausas_por_motivo: () => [
          { reason_code: "manual_pause", cantidad: "1203" },
          { reason_code: "quote_limit", cantidad: 4 },
        ],
      },
    );
    const out = await new SupabaseMetricsRepository(f.db).contarPausasPorMotivo(DESDE, HASTA);
    expect(out).toEqual([
      { reason_code: "manual_pause", cantidad: 1203 },
      { reason_code: "quote_limit", cantidad: 4 },
    ]);
    expect(f.llamadasRpc("metricas_pausas_por_motivo")).toEqual([
      { p_desde: DESDE.toISOString(), p_hasta: HASTA.toISOString() },
    ]);
  });

  it("resumirGastoPorWorkflow suma en la base y normaliza numeric y bigint", async () => {
    const f = fakePostgrest(
      {},
      {
        metricas_gasto_por_workflow: () => [
          {
            workflow: "ai-agent",
            llamadas: "2500",
            costo_usd: "1.234567",
            input_tokens: "3000000",
            output_tokens: 400000,
          },
        ],
      },
    );
    const out = await new SupabaseMetricsRepository(f.db).resumirGastoPorWorkflow(DESDE, HASTA);
    expect(out).toEqual([
      {
        workflow: "ai-agent",
        llamadas: 2500,
        costo_usd: 1.234567,
        input_tokens: 3_000_000,
        output_tokens: 400_000,
      },
    ]);
  });
});
