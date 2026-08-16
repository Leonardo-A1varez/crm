import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.supabase.repo";
import { sembrarIntent, sembrarTag } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";
import type { ReglasEtiquetaContractFixtures } from "../repositories/reglas-etiqueta.contract";
import { runReglasEtiquetaContract } from "../repositories/reglas-etiqueta.contract";

let client: TestClient;
let fixtures: ReglasEtiquetaContractFixtures;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  fixtures = await seedFixtures(client);
});

beforeEach(async () => {
  // Solo las reglas: intents y tags son fixture. `cleanupTestDb` no toca esta
  // tabla —es posterior a esa lista— así que se limpia acá.
  const { error } = await client
    .from("reglas_etiqueta")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup reglas_etiqueta fail: ${error.message}`);
});

afterAll(async () => {
  await client.from("reglas_etiqueta").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await cleanupTestDb(client);
});

describe("SupabaseReglasEtiquetaRepository (integration)", () => {
  runReglasEtiquetaContract(
    () => new SupabaseReglasEtiquetaRepository(client),
    () => fixtures,
  );
});

async function seedFixtures(c: TestClient): Promise<ReglasEtiquetaContractFixtures> {
  const i1 = await sembrarIntent(c, "pide_factura");
  const i2 = await sembrarIntent(c, "consulta_envio");
  const t1 = await sembrarTag(c, "Pide factura");
  const t2 = await sembrarTag(c, "Consulta envio");
  return {
    intentIds: { i1, i2 },
    tagIds: { t1, t2 },
    desconocido: crypto.randomUUID(),
  };
}
