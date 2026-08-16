import { afterAll, beforeAll, describe } from "vitest";
import { SupabaseMetricsRepository } from "@/server/repositories/metrics.supabase.repo";
import { sembrarCadena } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";
import type { MetricsContractFixtures } from "../repositories/metrics.contract";
import { runMetricsContract } from "../repositories/metrics.contract";

let client: TestClient;

/**
 * Los datos se siembran una sola vez: el contrato solo lee y ningún test
 * escribe, así que limpiar entre tests sería trabajo para nada.
 *
 * El corte de fecha se prueba contra `now()` de Postgres y no contra el reloj
 * de Node: las filas las fecha la base con su `DEFAULT`, y si el reloj de la
 * máquina va corrido el test fallaría por algo que no tiene que ver.
 */
const fixtures: MetricsContractFixtures = {
  antesDeTodo: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  despuesDeTodo: new Date(Date.now() + 24 * 60 * 60 * 1000),
};

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  // Una cadena completa alcanza: deja lead, sesión, conversación y mensaje, que
  // son las tres series con las que el contrato verifica el corte hacia atrás.
  await sembrarCadena(client, "metrics");
});

afterAll(async () => {
  await cleanupTestDb(client);
});

describe("SupabaseMetricsRepository (integration)", () => {
  runMetricsContract(() => new SupabaseMetricsRepository(client), fixtures);
});
