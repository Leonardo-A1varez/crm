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
 * máquina va corrido el test fallaría por algo que no tiene que ver. La única
 * excepción es `started_at` de la sesión, que sí se fija desde Node — ver
 * `STARTED_AT_SEMBRADO`.
 */
/**
 * `started_at` de la sesión sembrada, fijado a mano y no dejado en el `DEFAULT
 * now()` de Postgres. Motivo: `now()` tiene precisión de microsegundos y `Date`
 * de milisegundos, así que el valor leído de vuelta NUNCA sería exactamente el
 * de la fila y el test de exclusividad pasaría sin discriminar `<` de `<=`. Con
 * un ISO de 3 decimales el roundtrip es exacto.
 */
const STARTED_AT_SEMBRADO = new Date(Date.now() - 60_000);

const fixtures: MetricsContractFixtures = {
  antesDeTodo: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  despuesDeTodo: new Date(Date.now() + 24 * 60 * 60 * 1000),
  justoEnUnaFila: STARTED_AT_SEMBRADO,
};

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  // Una cadena completa alcanza: deja lead, sesión, conversación y mensaje, que
  // son las tres series con las que el contrato verifica el corte hacia atrás.
  const { sesionId } = await sembrarCadena(client, "metrics");
  const { error } = await client
    .from("lead_session")
    .update({ started_at: STARTED_AT_SEMBRADO.toISOString() })
    .eq("id", sesionId);
  if (error) throw new Error(`fijar started_at: ${error.message}`);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

describe("SupabaseMetricsRepository (integration)", () => {
  runMetricsContract(() => new SupabaseMetricsRepository(client), fixtures);
});
