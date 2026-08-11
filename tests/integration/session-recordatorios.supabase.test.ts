import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { ConflictError } from "@/lib/errors";
import { SupabaseSessionRecordatoriosRepository } from "@/server/repositories/session-recordatorios.supabase.repo";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";
import type { UUID } from "@/types/entities";

/**
 * El repo de recordatorios contra la DB real.
 *
 * Lo que solo se puede comprobar acá y no con el InMemory: que el índice único
 * parcial exista de verdad, que el CHECK de coherencia de estado no rechace las
 * transiciones que el repo escribe, y que los UPDATE condicionales
 * (`.eq("estado", …)`) sean atómicos en Postgres y no en un `if` de JavaScript.
 */

let client: TestClient;
let repo: SupabaseSessionRecordatoriosRepository;
let sesionA: UUID;
let sesionB: UUID;

const EN_DOS_DIAS = new Date(Date.now() + 48 * 60 * 60 * 1000);
const HACE_UN_DIA = new Date(Date.now() - 24 * 60 * 60 * 1000);

beforeAll(async () => {
  client = makeTestSupabaseClient();
  repo = new SupabaseSessionRecordatoriosRepository(client);
  await cleanupTestDb(client);
  ({ sesionA, sesionB } = await seedFixtures(client));
});

beforeEach(async () => {
  const { error } = await client
    .from("session_recordatorios")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup session_recordatorios fail: ${error.message}`);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

describe("SupabaseSessionRecordatoriosRepository (integration)", () => {
  async function programar(sessionId: UUID, recordarAt = EN_DOS_DIAS, nota = "lo pensaba") {
    return repo.create({
      lead_session_id: sessionId,
      recordar_at: recordarAt,
      nota,
      creado_por: null,
    });
  }

  test("crea pendiente y lo devuelve mapeado a la entidad", async () => {
    const r = await programar(sesionA);
    expect(r.estado).toBe("pendiente");
    expect(r.recordar_at).toBeInstanceOf(Date);
    expect(r.recordar_at.getTime()).toBe(EN_DOS_DIAS.getTime());
    expect(r.avisado_at).toBeNull();
  });

  test("el índice único parcial rechaza un segundo recordatorio vivo", async () => {
    await programar(sesionA);
    // ConflictError y no un 500: `mapPostgrestError` traduce el 23505.
    await expect(programar(sesionA)).rejects.toBeInstanceOf(ConflictError);
  });

  test("después de cancelar se puede programar de nuevo", async () => {
    const r = await programar(sesionA);
    await repo.cancelar(r.id, "manual");
    await expect(programar(sesionA)).resolves.toBeDefined();
  });

  test("marcarAvisado escribe el sello y pasa el CHECK de coherencia", async () => {
    const r = await programar(sesionA);
    const avisado = await repo.marcarAvisado(r.id);
    expect(avisado?.estado).toBe("avisado");
    expect(avisado?.avisado_at).not.toBeNull();
  });

  test("marcarAvisado dos veces solo aplica la primera (UPDATE condicional)", async () => {
    const r = await programar(sesionA);
    expect(await repo.marcarAvisado(r.id)).not.toBeNull();
    expect(await repo.marcarAvisado(r.id)).toBeNull();
  });

  test("cancelar guarda el motivo y pasa el CHECK", async () => {
    const r = await programar(sesionA);
    const c = await repo.cancelar(r.id, "respondio");
    expect(c?.estado).toBe("cancelado");
    expect(c?.motivo_cancelacion).toBe("respondio");
    expect(c?.cancelado_at).not.toBeNull();
  });

  test("cancelarVivosDeSesion apaga solo los de esa sesión", async () => {
    await programar(sesionA);
    await programar(sesionB);
    expect(await repo.cancelarVivosDeSesion(sesionA, "respondio")).toBe(1);
    expect(await repo.findVivoBySessionId(sesionA)).toBeNull();
    expect(await repo.findVivoBySessionId(sesionB)).not.toBeNull();
  });

  test("listPorAvisar trae los vencidos y deja los futuros", async () => {
    await programar(sesionA, HACE_UN_DIA);
    await programar(sesionB, EN_DOS_DIAS);
    const porAvisar = await repo.listPorAvisar(new Date());
    expect(porAvisar.map((r) => r.lead_session_id)).toEqual([sesionA]);
  });

  test("listPorAvisar deja afuera los cancelados", async () => {
    const r = await programar(sesionA, HACE_UN_DIA);
    await repo.cancelar(r.id, "respondio");
    expect(await repo.listPorAvisar(new Date())).toHaveLength(0);
  });

  test("un id que no es UUID no explota: devuelve vacío", async () => {
    expect(await repo.findById("no-soy-un-uuid")).toBeNull();
    expect(await repo.findVivoBySessionId("tampoco")).toBeNull();
    expect(await repo.cancelarVivosDeSesion("nope", "manual")).toBe(0);
  });

  describe("reprogramar", () => {
    const EN_UNA_SEMANA = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    test("mueve la fecha sin romper el índice único: sigue habiendo una sola cita", async () => {
      const r = await programar(sesionA);
      const movido = await repo.reprogramar(r.id, EN_UNA_SEMANA);

      expect(movido?.id).toBe(r.id);
      expect(movido?.recordar_at.getTime()).toBe(EN_UNA_SEMANA.getTime());
      expect((await repo.findVivoBySessionId(sesionA))?.id).toBe(r.id);
    });

    test("posponer uno avisado pasa el CHECK de coherencia de estado", async () => {
      // `avisado` → `pendiente` obliga a limpiar `avisado_at`: el constraint
      // `session_recordatorios_estado_coherente` rechaza la fila si sobrevive,
      // y eso solo se comprueba contra Postgres.
      const r = await programar(sesionA, HACE_UN_DIA);
      await repo.marcarAvisado(r.id);

      const movido = await repo.reprogramar(r.id, EN_UNA_SEMANA);

      expect(movido?.estado).toBe("pendiente");
      expect(movido?.avisado_at).toBeNull();
    });

    test("uno cancelado no se reprograma: el WHERE lo deja afuera", async () => {
      const r = await programar(sesionA);
      await repo.cancelar(r.id, "respondio");
      expect(await repo.reprogramar(r.id, EN_UNA_SEMANA)).toBeNull();
    });

    test("un id que no existe devuelve null y no revienta", async () => {
      expect(await repo.reprogramar(crypto.randomUUID(), EN_UNA_SEMANA)).toBeNull();
    });
  });

  describe("marcarAvisado con la fecha esperada", () => {
    test("avisa cuando la fila conserva la fecha con la que arrancó el workflow", async () => {
      const r = await programar(sesionA, HACE_UN_DIA);
      expect(await repo.marcarAvisado(r.id, { esperadoRecordarAt: HACE_UN_DIA })).not.toBeNull();
    });

    test("no avisa si la reprogramaron: el filtro de fecha va en el WHERE", async () => {
      // La guarda que impide que el workflow viejo dispare a la hora vieja. Va
      // en el UPDATE y no en un `if` de JavaScript, así que hay que verla
      // funcionando contra Postgres con la precisión real de `timestamptz`.
      const r = await programar(sesionA, HACE_UN_DIA);
      const otraFecha = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      await repo.reprogramar(r.id, otraFecha);

      expect(await repo.marcarAvisado(r.id, { esperadoRecordarAt: HACE_UN_DIA })).toBeNull();
      expect((await repo.findById(r.id))?.estado).toBe("pendiente");
    });
  });

  test("el recordatorio se va con la sesión (CASCADE)", async () => {
    // El cron de purga borra las sesiones cerradas a los 29 días; la cita de
    // seguimiento no puede quedar huérfana apuntando a una conversación que ya
    // no existe.
    const leadId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    await seedLeadConSesion(client, leadId, sessionId, "cascade");
    const r = await programar(sessionId);

    const { error } = await client.from("lead_session").delete().eq("id", sessionId);
    expect(error).toBeNull();
    expect(await repo.findById(r.id)).toBeNull();
  });
});

async function seedFixtures(c: TestClient): Promise<{ sesionA: UUID; sesionB: UUID }> {
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  await seedLeadConSesion(c, crypto.randomUUID(), a, "A");
  await seedLeadConSesion(c, crypto.randomUUID(), b, "B");
  return { sesionA: a, sesionB: b };
}

async function seedLeadConSesion(
  c: TestClient,
  leadId: string,
  sessionId: string,
  etiqueta: string,
): Promise<void> {
  const { error: leadError } = await c.from("leads").insert({
    id: leadId,
    nombre: `Recordatorio Fixture ${etiqueta}`,
    telefono: `+4${leadId.replace(/-/g, "").slice(0, 12)}`,
    vehiculo_marca: "Toyota",
    vehiculo_modelo: "Hilux",
    vehiculo_anio: 2019,
    canal_origen: "wa",
  });
  if (leadError) throw new Error(`seed lead fail: ${leadError.message}`);

  const { error: sessionError } = await c.from("lead_session").insert({
    id: sessionId,
    lead_id: leadId,
    current_stage: "negociando",
    urgencia: "media",
    consulta: "pastillas de freno",
  });
  if (sessionError) throw new Error(`seed lead_session fail: ${sessionError.message}`);
}
