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

/**
 * Una difusión dinámica en curso: la única a la que `difusion_sumar_altas()`
 * le deja sumar altas. Programada y enviándose exige plantilla, idioma y fecha.
 */
async function sembrarDinamica(c: TestClient): Promise<string> {
  const { data, error } = await c
    .from("difusiones")
    .insert({
      nombre: "Contrato envios dinamica",
      audiencia: AUDIENCIA,
      audiencia_toda_la_base: true,
      audiencia_modo: "dinamica",
      plantilla_nombre: "promo",
      plantilla_categoria: "marketing",
      plantilla_idioma: "es",
    })
    .select("id")
    .single();
  if (error) throw new Error(`sembrar difusion dinamica fail: ${error.message}`);
  const { error: e2 } = await c
    .from("difusiones")
    .update({ estado: "enviando", programada_para: new Date().toISOString() })
    .eq("id", data.id);
  if (e2) throw new Error(`poner en envio la dinamica fail: ${e2.message}`);
  return data.id;
}

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  fixtures = {
    difusiones: {
      d1: await sembrarDifusion(client, "Contrato envios 1"),
      d2: await sembrarDifusion(client, "Contrato envios 2"),
      dinamica: await sembrarDinamica(client),
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
  // Sólo un borrador se borra (trigger): la dinámica vuelve a borrador primero.
  // Los envíos caen en cascada.
  if (fixtures.difusiones.dinamica) {
    await client
      .from("difusiones")
      .update({ estado: "borrador", programada_para: null })
      .eq("id", fixtures.difusiones.dinamica);
  }
  await client
    .from("difusiones")
    .delete()
    .in(
      "id",
      [fixtures.difusiones.d1, fixtures.difusiones.d2, fixtures.difusiones.dinamica].filter(
        (id): id is string => id !== undefined,
      ),
    );
  await cleanupTestDb(client);
});

describe("SupabaseDifusionEnviosRepository (integration)", () => {
  runDifusionEnviosContract(
    () => new SupabaseDifusionEnviosRepository(client),
    () => fixtures,
  );
});
