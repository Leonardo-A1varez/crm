import { describe, expect, it } from "vitest";
import { FILTRO_JSONB_SESION_IMPORTADA } from "@/lib/coexistencia/sesion-importada";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryMetricsRepository } from "@/server/repositories/metrics.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseMetricsRepository } from "@/server/repositories/metrics.supabase.repo";
import { DefaultMetricsService } from "@/server/services/metricas/default-metricas.service";
import { fakePostgrest, uuidDe, type Fila } from "../helpers/fake-postgrest";
import type { FilaMensajeMetrica, FilaSesionMetrica } from "@/server/repositories/metrics.repo";

/**
 * Las sesiones que agrupan el historial importado de la app WhatsApp Business
 * (`extras.importado_historial = true`) se cierran como `perdido` sin motivo para
 * cumplir el esquema, pero nadie perdió una venta: no cuentan en Métricas, ni en
 * "Perdidos", ni en la columna de resultado de la lista de Leads
 * (docs/meta/conectar-whatsapp.md §5).
 */

const AHORA = new Date("2026-10-12T12:00:00.000Z");
const dias = (d: number) => new Date(AHORA.getTime() - d * 86_400_000);

function sesion(id: string, over: Partial<FilaSesionMetrica> = {}): FilaSesionMetrica {
  return {
    id,
    current_stage: "perdido",
    resultado: "perdido",
    motivo_perdida: null,
    started_at: dias(5),
    precio_cotizado: null,
    codigo_interno: null,
    closed_at: dias(5),
    cantidad: null,
    ...over,
  };
}

function mensaje(sesionId: string, over: Partial<FilaMensajeMetrica> = {}): FilaMensajeMetrica {
  return {
    sender: "lead",
    created_at: dias(5),
    platform_created_at: dias(5),
    canal: "wa",
    lead_session_id: sesionId,
    sender_user_id: null,
    ...over,
  };
}

describe("Métricas: el historial importado no es una venta perdida", () => {
  it("las sesiones importadas no entran en totales, perdidas ni motivos", async () => {
    const metrics = new InMemoryMetricsRepository({
      sesiones: [
        sesion("real", { motivo_perdida: "precio" }),
        sesion("importada-1", { importada: true }),
        sesion("importada-2", { importada: true }),
        sesion("abierta", { current_stage: "identificando", resultado: null, closed_at: null }),
      ],
    });
    const m = await new DefaultMetricsService({ metrics }).obtener(dias(30), AHORA);

    expect(m.totalSesiones).toBe(2);
    expect(m.resultado.perdido).toBe(1);
    expect(m.resultado.porMotivo).toEqual([{ motivo: "Precio", cantidad: 1 }]);
    // Sin la marca, las importadas serian 2 "perdidos sin motivo registrado".
    expect(m.resultado.porMotivo.some((x) => x.motivo === "Sin motivo registrado")).toBe(false);
    expect(m.tasaCierre.valor).toBe(0);
  });

  it("los mensajes del historial no inflan autoria, canal ni tiempos de respuesta", async () => {
    const metrics = new InMemoryMetricsRepository({
      sesiones: [sesion("real", { resultado: null, closed_at: null, current_stage: "nuevo" })],
      mensajes: [
        mensaje("real"),
        mensaje("importada", { sesion_importada: true }),
        mensaje("importada", { sesion_importada: true, sender: "humano" }),
        mensaje("importada", { sesion_importada: true, canal: "ig" }),
      ],
    });
    const m = await new DefaultMetricsService({ metrics }).obtener(dias(30), AHORA);
    expect(m.autoria.lead).toBe(1);
    expect(m.autoria.humano).toBe(0);
    expect(m.porCanal).toEqual([{ canal: "wa", cantidad: 1 }]);
  });
});

describe("Supabase: el filtro viaja a la base", () => {
  const MARCA = { importado_historial: true };

  it("listSesionesDesde no trae las importadas", async () => {
    const lead_session: Fila[] = [
      {
        id: uuidDe(1),
        current_stage: "perdido",
        resultado: "perdido",
        motivo_perdida: null,
        started_at: dias(2).toISOString(),
        precio_cotizado: null,
        codigo_interno: null,
        closed_at: null,
        cantidad: null,
        extras: {},
      },
      {
        id: uuidDe(2),
        current_stage: "perdido",
        resultado: "perdido",
        motivo_perdida: null,
        started_at: dias(2).toISOString(),
        precio_cotizado: null,
        codigo_interno: null,
        closed_at: null,
        cantidad: null,
        extras: MARCA,
      },
    ];
    const { db } = fakePostgrest({ lead_session });
    const out = await new SupabaseMetricsRepository(db).listSesionesDesde(dias(30), AHORA);
    expect(out.map((s) => s.id)).toEqual([uuidDe(1)]);
  });

  it("listMensajesDesde no trae los mensajes de una sesion importada", async () => {
    const fila = (n: number, extras: Record<string, unknown>): Fila => ({
      id: uuidDe(n),
      sender: "lead",
      created_at: dias(2).toISOString(),
      platform_created_at: null,
      lead_session_id: uuidDe(n, "99999999"),
      sender_user_id: null,
      conversaciones: { canal: "wa" },
      lead_session: { extras },
    });
    const { db } = fakePostgrest({ mensajes: [fila(1, {}), fila(2, MARCA), fila(3, { otra: 1 })] });
    const out = await new SupabaseMetricsRepository(db).listMensajesDesde(dias(30), AHORA);
    expect(out).toHaveLength(2);
  });

  it("el valor del filtro es exactamente la marca de la sesion importada", () => {
    expect(JSON.parse(FILTRO_JSONB_SESION_IMPORTADA)).toEqual(MARCA);
  });
});

describe("Leads: listCierres (columna de resultado y filtro Perdidos)", () => {
  const baseInsert = (leadId: string, extras: Record<string, unknown> = {}) => ({
    lead_id: leadId,
    current_stage: "perdido" as const,
    urgencia: "media" as const,
    consulta: "",
    producto_cotizado_id: null,
    codigo_interno: null,
    precio_cotizado: null,
    cantidad: null,
    bloqueador: null,
    comprobante_pago_url: null,
    metodo_pago: null,
    resultado: null,
    motivo_perdida: null,
    ia_pausada: false,
    extras,
  });

  it("en memoria: la sesion importada cerrada como perdido no es un cierre", async () => {
    const repo = new InMemoryLeadSessionRepository();
    const soloHistorial = await repo.create(baseInsert("lead-historial", MARCA_IMPORTADA));
    await repo.close(soloHistorial.id, { resultado: "perdido", motivo_perdida: "otro" });
    const real = await repo.create(baseInsert("lead-real"));
    await repo.close(real.id, { resultado: "perdido", motivo_perdida: "precio" });

    const cierres = await repo.listCierres();
    expect(cierres.map((c) => c.lead_id)).toEqual(["lead-real"]);
    // La ficha del lead sigue viendo su historial.
    expect((await repo.listByLeadId("lead-historial")).map((s) => s.id)).toEqual([
      soloHistorial.id,
    ]);
  });

  it("Supabase: el filtro viaja a la base", async () => {
    const fila = (n: number, extras: Record<string, unknown>): Fila => ({
      id: uuidDe(n),
      lead_id: uuidDe(n, "bbbbbbbb"),
      resultado: "perdido",
      motivo_perdida: null,
      closed_at: dias(n).toISOString(),
      extras,
    });
    const { db } = fakePostgrest({
      lead_session: [fila(1, {}), fila(2, MARCA_IMPORTADA)],
    });
    const out = await new SupabaseLeadSessionRepository(db).listCierres();
    expect(out.map((c) => c.lead_id)).toEqual([uuidDe(1, "bbbbbbbb")]);
  });
});

const MARCA_IMPORTADA = { importado_historial: true };
