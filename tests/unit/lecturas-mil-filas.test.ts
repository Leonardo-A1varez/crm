import { describe, expect, it } from "vitest";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseLlmUsageRepository } from "@/server/repositories/llm-usage.supabase.repo";
import { SupabaseTagsRepository } from "@/server/repositories/tags.supabase.repo";
import { fakePostgrest, uuidDe, type Fila } from "../helpers/fake-postgrest";

/**
 * Lecturas sin tope natural contra un PostgREST que corta en 1.000 filas
 * (AGENTS.md, lección 12). Cada caso siembra más de 1.000 filas que cumplen el
 * filtro: sin paginar o agregar en la base, el repo devolvería 1.000 y nadie se
 * enteraría.
 */

const TAG = uuidDe(1, "aaaaaaaa");
const OTRO_TAG = uuidDe(2, "aaaaaaaa");

function leadTag(i: number, tagId: string, quitada = false): Fila {
  return {
    lead_id: uuidDe(i),
    tag_id: tagId,
    source: "manual",
    assigned_by: null,
    assigned_at: "2026-09-01T00:00:00.000Z",
    quitada_at: quitada ? "2026-09-02T00:00:00.000Z" : null,
    quitada_por: null,
  };
}

/** Lo que hace `contar_leads_por_etiqueta()` en SQL, para el fake. */
function contarLeadsPorEtiqueta(filas: Fila[]) {
  const porTag = new Map<string, number>();
  for (const f of filas) {
    if (f["quitada_at"] !== null) continue;
    const tag = f["tag_id"] as string;
    porTag.set(tag, (porTag.get(tag) ?? 0) + 1);
  }
  return [...porTag].map(([tag_id, leads]) => ({ tag_id, leads }));
}

describe("tags con más de 1.000 leads etiquetados", () => {
  const puestas = Array.from({ length: 1734 }, (_, i) => leadTag(i, TAG));
  const quitadas = Array.from({ length: 12 }, (_, i) => leadTag(5000 + i, TAG, true));
  const otras = Array.from({ length: 1203 }, (_, i) => leadTag(10_000 + i, OTRO_TAG));
  const lead_tags = [...otras, ...quitadas, ...puestas];

  it("listLeadIdsByTag trae todos los leads con la etiqueta puesta", async () => {
    const { db, requests } = fakePostgrest({ lead_tags });
    const ids = await new SupabaseTagsRepository(db).listLeadIdsByTag(TAG);
    expect(ids).toHaveLength(puestas.length);
    expect(new Set(ids)).toEqual(new Set(puestas.map((f) => f["lead_id"])));
    expect(requests()).toBeGreaterThan(1);
  });

  it("countLeadsByTag cuenta en la base, no sobre las primeras 1.000 filas", async () => {
    const f = fakePostgrest(
      { lead_tags },
      { contar_leads_por_etiqueta: () => contarLeadsPorEtiqueta(lead_tags) },
    );
    const conteo = await new SupabaseTagsRepository(f.db).countLeadsByTag();
    expect(conteo.get(TAG)).toBe(puestas.length);
    expect(conteo.get(OTRO_TAG)).toBe(otras.length);
    expect(f.llamadasRpc("contar_leads_por_etiqueta")).toHaveLength(1);
  });
});

function sesion(i: number, over: Partial<Fila> = {}): Fila {
  return {
    id: uuidDe(i),
    // Dos sesiones por lead: el último cierre de cada uno tiene que ganarle al
    // anterior aunque la paginación las traiga en otro orden.
    lead_id: uuidDe(Math.floor(i / 2), "bbbbbbbb"),
    resultado: null,
    motivo_perdida: null,
    closed_at: null,
    codigo_interno: null,
    ...over,
  };
}

describe("lead_session con más de 1.000 sesiones cerradas", () => {
  // El id crece con i pero closed_at decrece: el orden por id es el inverso del
  // orden por fecha, así que un repo que dependa del orden de las páginas pierde.
  const cerradas = Array.from({ length: 2400 }, (_, i) =>
    sesion(i, {
      resultado: i % 2 === 0 ? "perdido" : "exito",
      motivo_perdida: i % 2 === 0 ? "precio" : null,
      closed_at: new Date(Date.UTC(2026, 8, 1) - i * 60_000).toISOString(),
    }),
  );
  const abiertas = Array.from({ length: 300 }, (_, i) => sesion(50_000 + i));

  it("listCierres trae todos los cierres, del más nuevo al más viejo", async () => {
    const { db } = fakePostgrest({ lead_session: [...abiertas, ...cerradas] });
    const out = await new SupabaseLeadSessionRepository(db).listCierres();
    expect(out).toHaveLength(cerradas.length);
    const fechas = out.map((c) => c.closed_at.getTime());
    expect(fechas).toEqual([...fechas].sort((a, b) => b - a));
    // Del lead 0 cerraron la sesión 0 (la más nueva, perdido) y la 1 (exito):
    // la primera que aparece es la más nueva.
    expect(out.find((c) => c.lead_id === uuidDe(0, "bbbbbbbb"))?.resultado).toBe("perdido");
  });

  it("listLeadIdsByCodigo trae todos los leads que cotizaron el código", async () => {
    const conCodigo = Array.from({ length: 2222 }, (_, i) =>
      sesion(i, { codigo_interno: `FRE_${i % 3}-X` }),
    );
    const sinCodigo = Array.from({ length: 50 }, (_, i) =>
      sesion(90_000 + i, { codigo_interno: "OTRO" }),
    );
    const { db } = fakePostgrest({ lead_session: [...sinCodigo, ...conCodigo] });
    const ids = await new SupabaseLeadSessionRepository(db).listLeadIdsByCodigo("fre_");
    const esperados = new Set(conCodigo.map((s) => s["lead_id"]));
    expect(ids).toHaveLength(esperados.size);
    expect(new Set(ids)).toEqual(esperados);
  });
});

describe("llm_usage con más de 1.000 llamadas", () => {
  it("listDesde trae todas las llamadas desde la fecha", async () => {
    const fila = (i: number, fecha: string): Fila => ({
      id: uuidDe(i),
      lead_session_id: null,
      mensaje_id: null,
      modelo: "gpt-4o-mini",
      input_tokens: 10,
      output_tokens: 5,
      costo_usd: "0.0001",
      workflow: "agente",
      created_at: fecha,
    });
    const nuevas = Array.from({ length: 3001 }, (_, i) => fila(i, "2026-09-10T00:00:00.000Z"));
    const viejas = Array.from({ length: 40 }, (_, i) => fila(9000 + i, "2026-08-01T00:00:00.000Z"));
    const { db } = fakePostgrest({ llm_usage: [...viejas, ...nuevas] });
    const out = await new SupabaseLlmUsageRepository(db).listDesde(new Date("2026-09-01"));
    expect(out).toHaveLength(nuevas.length);
    expect(out.every((u) => u.costo_usd === 0.0001)).toBe(true);
  });
});
