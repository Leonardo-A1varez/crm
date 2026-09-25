import { describe, expect, it } from "vitest";
import { SupabaseAdminAuditRepository } from "@/server/repositories/admin-audit.supabase.repo";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { SupabaseMergeCandidatesRepository } from "@/server/repositories/merge-candidates.supabase.repo";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { SupabaseProductsRepository } from "@/server/repositories/productos.supabase.repo";
import { SupabaseRuleExecutionsRepository } from "@/server/repositories/rule-executions.supabase.repo";
import { SupabaseSessionRecordatoriosRepository } from "@/server/repositories/session-recordatorios.supabase.repo";
import { fakePostgrest, MAX_ROWS_POSTGREST, uuidDe, type Fila } from "../helpers/fake-postgrest";

/**
 * Listados sin tope natural contra un PostgREST que corta en 1.000 filas
 * (AGENTS.md, lección 12). En cada caso el orden por id es distinto del orden
 * del contrato, para que un repo que pagine y se olvide de reordenar falle.
 */

const iso = (ms: number) => new Date(ms).toISOString();
const BASE = Date.UTC(2026, 8, 1);

function ordenadoDesc(xs: number[]): boolean {
  return xs.every((x, i) => i === 0 || (xs[i - 1] as number) >= x);
}

describe("leads.list sin limit", () => {
  function lead(i: number, updatedMs: number): Fila {
    return {
      id: uuidDe(i),
      nombre: `Lead ${i}`,
      nombre_perfil: null,
      telefono: null,
      email: null,
      direccion: null,
      datos_extra: {},
      vehiculo_marca: null,
      vehiculo_modelo: null,
      vehiculo_anio: null,
      vehiculo_motor: null,
      empresa_id: null,
      canal_origen: "wa",
      meta_user_ids: {},
      created_at: iso(BASE),
      updated_at: iso(updatedMs),
    };
  }

  it("trae todos los leads, ordenados por updated_at desc e id asc", async () => {
    // Pares con el mismo updated_at: el desempate por id tiene que sostenerse.
    const leads = Array.from({ length: 2600 }, (_, i) => lead(i, BASE + Math.floor(i / 2) * 1000));
    const { db, requests } = fakePostgrest({ leads });
    const out = await new SupabaseLeadsRepository(db).list();
    expect(out).toHaveLength(2600);
    expect(requests()).toBeGreaterThan(1);
    expect(out[0]?.id).toBe(uuidDe(2598));
    expect(out[1]?.id).toBe(uuidDe(2599));
    expect(ordenadoDesc(out.map((l) => l.updated_at.getTime()))).toBe(true);
  });

  it("con limit sigue siendo una sola consulta acotada", async () => {
    const leads = Array.from({ length: 1500 }, (_, i) => lead(i, BASE + i));
    const { db, requests } = fakePostgrest({ leads });
    expect(await new SupabaseLeadsRepository(db).list({ limit: 20 })).toHaveLength(20);
    expect(requests()).toBe(1);
  });
});

describe("productos.list sin limit", () => {
  it("trae el catálogo entero, ordenado por nombre y código", async () => {
    // Los ids van al revés del nombre: el orden de la base no es el del id.
    const productos = Array.from({ length: 2100 }, (_, i) => ({
      id: uuidDe(5000 - i),
      codigo_interno: `C-${String(i).padStart(5, "0")}`,
      codigo_fabrica: null,
      otros_codigos: [],
      sku_proveedor: null,
      nombre: `Pieza ${String(Math.floor(i / 3)).padStart(5, "0")}`,
      descripcion: null,
      categoria: null,
      compatibilidad: [],
      precio: 1,
      stock: 1,
      imagen_url: null,
      activo: true,
      created_at: iso(BASE),
      updated_at: iso(BASE),
    }));
    const { db } = fakePostgrest({ productos });
    const out = await new SupabaseProductsRepository(db).list();
    expect(out).toHaveLength(2100);
    expect(new Set(out.map((p) => p.id)).size).toBe(2100);
    expect(out.map((p) => p.codigo_interno)).toEqual(productos.map((p) => p.codigo_interno));
  });
});

describe("merge_candidates.list sin limit", () => {
  it("trae todos los pendientes, del más nuevo al más viejo", async () => {
    const candidatos = Array.from({ length: 1300 }, (_, i) => ({
      id: uuidDe(i),
      src_lead_id: uuidDe(i, "cccccccc"),
      dst_lead_id: uuidDe(i, "dddddddd"),
      similarity_score: 0.9,
      reasons: [],
      status: i % 10 === 0 ? "rejected" : "pending",
      resolved_by: null,
      resolved_at: null,
      created_at: iso(BASE + i * 1000),
    }));
    const { db } = fakePostgrest({ merge_candidates: candidatos });
    const out = await new SupabaseMergeCandidatesRepository(db).list({ status: "pending" });
    expect(out).toHaveLength(1170);
    expect(ordenadoDesc(out.map((c) => c.created_at.getTime()))).toBe(true);
  });
});

describe("admin_actions.list sin limit", () => {
  it("trae todas las acciones, de la más nueva a la más vieja", async () => {
    const acciones = Array.from({ length: 1100 }, (_, i) => ({
      id: uuidDe(i),
      actor_user_id: null,
      action: "tag.delete",
      entity_type: "tag",
      entity_id: uuidDe(1, "eeeeeeee"),
      payload: {},
      created_at: iso(BASE + i * 1000),
    }));
    const { db } = fakePostgrest({ admin_actions: acciones });
    const out = await new SupabaseAdminAuditRepository(db).list({ entityType: "tag" });
    expect(out).toHaveLength(1100);
    expect(ordenadoDesc(out.map((a) => a.created_at.getTime()))).toBe(true);
  });
});

describe("rule_executions.listByRegla", () => {
  it("trae todas las ejecuciones de la regla, de la más nueva a la más vieja", async () => {
    const regla = uuidDe(7, "ffffffff");
    const ejecuciones = Array.from({ length: 1400 }, (_, i) => ({
      id: uuidDe(i),
      regla_id: regla,
      mensaje_id: uuidDe(i, "abababab"),
      matched_intent_id: uuidDe(1, "cdcdcdcd"),
      created_at: iso(BASE + i * 1000),
    }));
    const { db } = fakePostgrest({ rule_executions: ejecuciones });
    const out = await new SupabaseRuleExecutionsRepository(db).listByRegla(regla);
    expect(out).toHaveLength(1400);
    expect(ordenadoDesc(out.map((e) => e.created_at.getTime()))).toBe(true);
  });
});

function recordatorio(i: number, recordarMs: number, estado = "pendiente"): Fila {
  return {
    id: uuidDe(i),
    lead_session_id: uuidDe(i, "12121212"),
    recordar_at: iso(recordarMs),
    nota: null,
    estado,
    motivo_cancelacion: null,
    creado_por: null,
    created_at: iso(BASE),
    avisado_at: null,
    cancelado_at: null,
  };
}

describe("session_recordatorios con más de 1.000 vivos", () => {
  const ahora = new Date(BASE + 10_000_000);
  // recordar_at decrece con el id.
  const vencidos = Array.from({ length: 1800 }, (_, i) => recordatorio(i, BASE - i * 1000));
  const futuros = Array.from({ length: 30 }, (_, i) => recordatorio(8000 + i, BASE + 99_000_000));
  const hechos = Array.from({ length: 30 }, (_, i) =>
    recordatorio(9000 + i, BASE - 5_000, "hecho"),
  );
  const filas = [...futuros, ...hechos, ...vencidos];

  it("listPorAvisar trae todos los vencidos, del más viejo al más nuevo", async () => {
    const { db } = fakePostgrest({ session_recordatorios: filas });
    const out = await new SupabaseSessionRecordatoriosRepository(db).listPorAvisar(ahora);
    expect(out).toHaveLength(1800);
    const fechas = out.map((r) => r.recordar_at.getTime());
    expect(fechas).toEqual([...fechas].sort((a, b) => a - b));
  });

  it("listVivosBySessionIds trae el vivo de cada sesión pedida, aunque sean más de 1.000", async () => {
    const { db } = fakePostgrest({ session_recordatorios: filas });
    const sesiones = [...vencidos, ...futuros].map((r) => r["lead_session_id"] as string);
    const out = await new SupabaseSessionRecordatoriosRepository(db).listVivosBySessionIds(
      sesiones,
    );
    expect(out).toHaveLength(1830);
    const fechas = out.map((r) => r.recordar_at.getTime());
    expect(fechas).toEqual([...fechas].sort((a, b) => a - b));
  });
});

function mensaje(i: number, sesion: string, createdMs: number): Fila {
  return {
    id: uuidDe(i),
    conversacion_id: uuidDe(1, "34343434"),
    lead_session_id: sesion,
    direction: "in",
    sender: "lead",
    sender_user_id: null,
    tipo: "text",
    contenido: `m${i}`,
    media_url: null,
    meta_message_id: null,
    idempotency_key: null,
    metadata: {},
    created_at: iso(createdMs),
    platform_created_at: null,
    estado_entrega: null,
    estado_entrega_at: null,
    error_entrega: null,
  };
}

describe("mensajes de muchas sesiones", () => {
  it("listBySessionIds trae todos los mensajes aunque una tanda pase de 1.000", async () => {
    // 100 sesiones —una tanda— con 15 mensajes cada una: 1.500 filas.
    const sesiones = Array.from({ length: 100 }, (_, i) => uuidDe(i, "56565656"));
    const mensajes = sesiones.flatMap((s, si) =>
      Array.from({ length: 15 }, (_, k) => mensaje(si * 100 + k, s, BASE - (si * 15 + k) * 1000)),
    );
    const { db } = fakePostgrest({ mensajes });
    const out = await new SupabaseMessagesRepository(db).listBySessionIds(sesiones);
    expect(out).toHaveLength(1500);
    const fechas = out.map((m) => m.created_at.getTime());
    expect(fechas).toEqual([...fechas].sort((a, b) => a - b));
  });

  it("listRecentBySessionIds no pide más de 1.000 filas en un solo RPC", async () => {
    const sesiones = Array.from({ length: 60 }, (_, i) => uuidDe(i, "78787878"));
    // Lo que hace `inbox_recent_messages`: los últimos p_limit de cada sesión,
    // ordenados por fecha ascendente en el conjunto.
    const f = fakePostgrest(
      {},
      {
        inbox_recent_messages: (args) => {
          const ids = args["p_session_ids"] as string[];
          const limite = args["p_limit"] as number;
          return ids
            .flatMap((s, si) =>
              Array.from({ length: limite }, (_, k) => ({
                conversacion_id: uuidDe(1, "34343434"),
                lead_session_id: s,
                direction: "in",
                sender: "lead",
                contenido: `m${k}`,
                created_at: iso(BASE + k * 60_000 + si),
              })),
            )
            .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
        },
      },
    );
    const out = await new SupabaseMessagesRepository(f.db).listRecentBySessionIds(sesiones, 50);
    expect(out).toHaveLength(60 * 50);
    for (const args of f.llamadasRpc("inbox_recent_messages")) {
      const pedidas = (args["p_session_ids"] as string[]).length * (args["p_limit"] as number);
      expect(pedidas).toBeLessThanOrEqual(MAX_ROWS_POSTGREST);
    }
    const fechas = out.map((m) => m.created_at.getTime());
    expect(fechas).toEqual([...fechas].sort((a, b) => a - b));
    // Cada sesión conserva sus 50: nadie se quedó sin el final del hilo.
    const porSesion = new Map<string, number>();
    for (const m of out)
      porSesion.set(m.lead_session_id, (porSesion.get(m.lead_session_id) ?? 0) + 1);
    expect([...porSesion.values()].every((n) => n === 50)).toBe(true);
  });
});
