import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseDifusionEnviosRepository } from "@/server/repositories/difusion-envios.supabase.repo";
import { sembrarLead } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";
import type { DifusionEnviosContractFixtures } from "../repositories/difusion-envios.contract";
import { runDifusionEnviosContract } from "../repositories/difusion-envios.contract";

let client: TestClient;
let fixtures: DifusionEnviosContractFixtures;

const AUDIENCIA = { id: "raiz", clase: "grupo", operador: "y", hijos: [] };

async function sembrarDifusion(c: TestClient, nombre: string): Promise<string> {
  const { data, error } = await c
    .from("difusiones")
    .insert({ nombre, audiencia: AUDIENCIA })
    .select("id")
    .single();
  if (error) throw new Error(`sembrar difusion fail: ${error.message}`);
  return data.id;
}

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  fixtures = {
    difusiones: {
      d1: await sembrarDifusion(client, "Contrato envios 1"),
      d2: await sembrarDifusion(client, "Contrato envios 2"),
    },
    leads: {
      l1: await sembrarLead(client, "envios-1"),
      l2: await sembrarLead(client, "envios-2"),
      l3: await sembrarLead(client, "envios-3"),
      l4: await sembrarLead(client, "envios-4"),
    },
    desconocido: crypto.randomUUID(),
  };
});

beforeEach(async () => {
  // Las difusiones y los leads son fixture; sólo los envíos se limpian. El
  // service-role tiene DELETE sobre esta tabla (no hay policy para personas).
  const { error } = await client
    .from("difusion_envios")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup difusion_envios fail: ${error.message}`);
});

afterAll(async () => {
  // Borradores: se borran y los envíos caen en cascada.
  await client
    .from("difusiones")
    .delete()
    .in("id", [fixtures.difusiones.d1, fixtures.difusiones.d2]);
  await cleanupTestDb(client);
});

describe("SupabaseDifusionEnviosRepository (integration)", () => {
  runDifusionEnviosContract(
    () => new SupabaseDifusionEnviosRepository(client),
    () => fixtures,
  );
});
