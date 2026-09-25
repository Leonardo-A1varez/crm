import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseDifusionesRepository } from "@/server/repositories/difusiones.supabase.repo";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";
import type { DifusionesContractFixtures } from "../repositories/difusiones.contract";
import { runDifusionesContract } from "../repositories/difusiones.contract";

let client: TestClient;

/**
 * Sólo los borradores se borran (trigger `difusiones_solo_borra_borradores`):
 * los tests dejan difusiones programadas o detenidas, así que primero se las
 * devuelve a borrador. `difusion_envios` cae en cascada.
 */
async function limpiarDifusiones(c: TestClient): Promise<void> {
  const { error: aBorrador } = await c
    .from("difusiones")
    .update({
      estado: "borrador",
      programada_para: null,
      finalizada_at: null,
      motivo_detencion: null,
      detenida_por: null,
    })
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (aBorrador) throw new Error(`cleanup difusiones (a borrador) fail: ${aBorrador.message}`);
  const { error } = await c
    .from("difusiones")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup difusiones fail: ${error.message}`);
}

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  await limpiarDifusiones(client);
});

beforeEach(async () => {
  await limpiarDifusiones(client);
});

afterAll(async () => {
  await limpiarDifusiones(client);
  await cleanupTestDb(client);
});

describe("SupabaseDifusionesRepository (integration)", () => {
  runDifusionesContract(
    () => new SupabaseDifusionesRepository(client),
    (): DifusionesContractFixtures => ({ usuarioId: null, desconocido: crypto.randomUUID() }),
  );
});
