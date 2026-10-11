import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseMetricsRepository } from "@/server/repositories/metrics.supabase.repo";
import { sembrarConversacion, sembrarLead } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

/**
 * Las sesiones del historial importado de la app WhatsApp Business
 * (`extras.importado_historial = true`, cerradas como `perdido`) no cuentan en
 * Métricas, en «Perdidos» ni en el resultado de la lista de Leads. Lo que el fake
 * de PostgREST no puede probar —que `not.cs` sobre una columna y sobre una fila
 * embebida (`lead_session.extras`) funcionan de verdad— se prueba acá.
 *
 * Sólo contra el stack local: `node scripts/con-stack-local.mjs --perfil test
 * --resembrar -- vitest run -c vitest.integration.config.ts
 * tests/integration/historial-importado.supabase.test.ts`.
 */

let c: TestClient;
let leadReal: string;
let leadHistorial: string;
let sesionReal: string;
let sesionImportada: string;

const DESDE = new Date(Date.now() - 30 * 86_400_000);
const HASTA = new Date(Date.now() + 86_400_000);

async function sesionCerrada(leadId: string, extras: Record<string, unknown>): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await c.from("lead_session").insert({
    id,
    lead_id: leadId,
    consulta: "x",
    current_stage: "perdido",
    resultado: "perdido",
    motivo_perdida: extras["importado_historial"] ? null : "precio",
    closed_at: new Date().toISOString(),
    extras: extras as never,
  });
  if (error) throw new Error(`seed lead_session: ${error.message}`);
  return id;
}

async function mensaje(conversacionId: string, sesionId: string, sender: "lead" | "humano") {
  const { error } = await c.from("mensajes").insert({
    conversacion_id: conversacionId,
    lead_session_id: sesionId,
    direction: sender === "lead" ? "in" : "out",
    sender,
    tipo: "text",
    contenido: "hola",
  });
  if (error) throw new Error(`seed mensajes: ${error.message}`);
}

beforeAll(async () => {
  c = makeTestSupabaseClient();
  await cleanupTestDb(c);
  leadReal = await sembrarLead(c, "real");
  leadHistorial = await sembrarLead(c, "historial");
  sesionReal = await sesionCerrada(leadReal, {});
  sesionImportada = await sesionCerrada(leadHistorial, { importado_historial: true });
  const convReal = await sembrarConversacion(c, leadReal);
  const convHistorial = await sembrarConversacion(c, leadHistorial);
  await mensaje(convReal, sesionReal, "lead");
  await mensaje(convHistorial, sesionImportada, "lead");
  await mensaje(convHistorial, sesionImportada, "humano");
}, 120_000);

afterAll(async () => {
  await cleanupTestDb(c);
}, 120_000);

describe("historial importado contra PostgREST real", () => {
  test("Métricas: listSesionesDesde deja afuera la sesión importada", async () => {
    const out = await new SupabaseMetricsRepository(c).listSesionesDesde(DESDE, HASTA);
    expect(out.map((s) => s.id)).toEqual([sesionReal]);
  });

  test("Métricas: listMensajesDesde deja afuera los mensajes de la sesión importada y sigue trayendo el canal", async () => {
    const out = await new SupabaseMetricsRepository(c).listMensajesDesde(DESDE, HASTA);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ lead_session_id: sesionReal, canal: "wa", sender: "lead" });
  });

  test("Leads: listCierres no cuenta la sesión importada como perdida", async () => {
    const out = await new SupabaseLeadSessionRepository(c).listCierres();
    expect(out.map((x) => x.lead_id)).toEqual([leadReal]);
    expect(out[0]).toMatchObject({ resultado: "perdido", motivo_perdida: "precio" });
  });

  test("la ficha del lead sí sigue viendo su historial", async () => {
    const sesiones = await new SupabaseLeadSessionRepository(c).listByLeadId(leadHistorial);
    expect(sesiones.map((s) => s.id)).toEqual([sesionImportada]);
  });
});
