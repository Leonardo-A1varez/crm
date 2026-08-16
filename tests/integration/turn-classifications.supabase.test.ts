import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseTurnClassificationsRepository } from "@/server/repositories/turn-classifications.supabase.repo";
import { sembrarCadena, sembrarIntent, sembrarMensaje } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";
import type { TurnClassificationsContractFixtures } from "../repositories/turn-classifications.contract";
import { runTurnClassificationsContract } from "../repositories/turn-classifications.contract";

let client: TestClient;
let fixtures: TurnClassificationsContractFixtures;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  fixtures = await seedFixtures(client);
});

beforeEach(async () => {
  // Solo las clasificaciones: los mensajes y el intent son fixture y sobreviven.
  const { error } = await client
    .from("turn_classifications")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup turn_classifications fail: ${error.message}`);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

describe("SupabaseTurnClassificationsRepository (integration)", () => {
  runTurnClassificationsContract(
    () => new SupabaseTurnClassificationsRepository(client),
    () => fixtures,
  );
});

async function seedFixtures(c: TestClient): Promise<TurnClassificationsContractFixtures> {
  const { conversacionId, sesionId, mensajeId } = await sembrarCadena(c, "turn-class");
  const m2 = await sembrarMensaje(c, conversacionId, sesionId, "segundo mensaje");
  const intentId = await sembrarIntent(c, "consulta_precio");
  return { mensajeIds: { m1: mensajeId, m2 }, intentId };
}
