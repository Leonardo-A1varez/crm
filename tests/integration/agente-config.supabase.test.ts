import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { SupabaseAgenteConfigRepository } from "@/server/repositories/agente-config.supabase.repo";
import { runAgenteConfigContract } from "../repositories/agente-config.contract";
import { makeTestSupabaseClient, type TestClient } from "./setup";
import type { AgenteConfigInsert } from "@/server/repositories/agente-config.repo";
import type { AgenteConfig } from "@/types/agente";
import type { Database } from "@/server/db/types.gen";

/**
 * `agente_config` contra Postgres real.
 *
 * Corre el mismo contract que la impl InMemory (Task 6) más las garantías que
 * SOLO existen en la base y que InMemory no puede reproducir: el índice único
 * parcial, los CHECK de rango y las policies de RLS. Esas tres son la razón de
 * que esta suite valga su costo — un bug de índice no es reproducible en
 * memoria, y por eso es el que llega a producción.
 *
 * OJO: `cleanupTestDb` de `setup.ts` NO incluye `agente_config`, así que la
 * limpieza es local a esta suite. Se toma un snapshot de la config activa al
 * empezar y se restaura al terminar: la tabla tiene datos vivos que el agente
 * lee en cada turno. Durante la corrida la tabla queda sin fila activa, y eso
 * es tolerable por diseño — `CachedAgentConfigProvider` cae a
 * `CONFIG_DE_FABRICA` y registra el error en vez de dejar mudo al agente.
 */

const TABLA = "agente_config";
const PASSWORD = "agente-rls-test-2026!secret";
const EMAIL_VENDEDOR = "agente-rls-vendedor@crm.local";

let client: TestClient;
let repo: SupabaseAgenteConfigRepository;
let snapshotActiva: AgenteConfig | null = null;

async function limpiarAgenteConfig(c: TestClient): Promise<void> {
  const { error } = await c.from(TABLA).delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`limpiarAgenteConfig: ${error.message}`);
}

function insert(patch: Partial<AgenteConfigInsert> = {}): AgenteConfigInsert {
  return {
    ...CONFIG_DE_FABRICA,
    version: 1,
    nota: null,
    rollback_de: null,
    creada_por: null,
    ...patch,
  };
}

beforeAll(async () => {
  client = makeTestSupabaseClient();
  // Snapshot antes de tocar nada: si la suite falla a mitad, el afterAll
  // igual restaura una config activa y el agente no queda sin la suya.
  snapshotActiva = await new SupabaseAgenteConfigRepository(client).findActiva();
});

beforeEach(async () => {
  await limpiarAgenteConfig(client);
  repo = new SupabaseAgenteConfigRepository(client);
});

afterAll(async () => {
  await limpiarAgenteConfig(client);
  const valores = snapshotActiva ?? { ...CONFIG_DE_FABRICA };
  const restaurada = await new SupabaseAgenteConfigRepository(client).crear({
    ...valores,
    version: 1,
    nota: "Restaurada tras la suite de integration de agente_config",
    rollback_de: null,
    creada_por: null,
  });
  await new SupabaseAgenteConfigRepository(client).activar(restaurada.id);
});

describe("SupabaseAgenteConfigRepository (integration)", () => {
  runAgenteConfigContract(() => {
    return new SupabaseAgenteConfigRepository(client);
  });
});

describe("garantias que solo existen contra Postgres", () => {
  test("dos activaciones concurrentes no dejan dos configs activas", async () => {
    // El indice unico parcial `agente_config_una_activa (activa) where activa`
    // no existe en InMemory: este bug no es reproducible ahi, y es la razon de
    // que esta suite exista.
    const a = await repo.crear(insert({ version: 1 }));
    const b = await repo.crear(insert({ version: 2 }));

    await Promise.allSettled([repo.activar(a.id), repo.activar(b.id)]);

    const activas = (await repo.list()).filter((c) => c.activa);
    expect(activas).toHaveLength(1);
  });

  test("una activacion posterior desactiva la anterior sin dejar dos", async () => {
    const a = await repo.crear(insert({ version: 1 }));
    await repo.activar(a.id);
    const b = await repo.crear(insert({ version: 2 }));
    await repo.activar(b.id);

    const todas = await repo.list();
    expect(todas.filter((c) => c.activa).map((c) => c.id)).toEqual([b.id]);
  });

  test("los CHECK rechazan valores fuera de rango", async () => {
    await expect(repo.crear(insert({ descuento_max_pct: 50 }))).rejects.toThrow();
    await expect(repo.crear(insert({ max_pasos_tool: 99 }))).rejects.toThrow();
    await expect(repo.crear(insert({ ventana_contexto_mensajes: 999 }))).rejects.toThrow();
  });

  test("los CHECK rechazan valores fuera del dominio", async () => {
    await expect(repo.crear(insert({ tono: "sarcastico" as never }))).rejects.toThrow();
    await expect(repo.crear(insert({ politica_tope: "ignorar" as never }))).rejects.toThrow();
  });

  test("el CHECK rechaza instrucciones mas largas que el limite", async () => {
    await expect(repo.crear(insert({ instrucciones: "x".repeat(4001) }))).rejects.toThrow();
  });

  test("el horario sobrevive el round-trip a jsonb con los 7 dias", async () => {
    const creada = await repo.crear(insert({ horario: { ...CONFIG_DE_FABRICA.horario, dom: [] } }));
    const leida = await repo.findById(creada.id);

    expect(leida?.horario.dom).toEqual([]);
    expect(leida?.horario.lun).toEqual(CONFIG_DE_FABRICA.horario.lun);
  });

  test("numeric vuelve como numero, no como string", async () => {
    // PostgREST devuelve `numeric` como string para no perder precision. Sin la
    // conversion del repo, los rangos se comparan como texto y "9" > "10".
    const creada = await repo.crear(
      insert({ descuento_max_pct: 7.5, tope_gasto_diario_usd: 12.5 }),
    );
    const leida = await repo.findById(creada.id);

    expect(typeof leida?.descuento_max_pct).toBe("number");
    expect(leida?.descuento_max_pct).toBe(7.5);
    expect(typeof leida?.tope_gasto_diario_usd).toBe("number");
    expect(leida?.tope_gasto_diario_usd).toBe(12.5);
  });
});

describe("RLS", () => {
  let vendedorClient: SupabaseClient<Database>;
  let vendedorUserId: string | null = null;

  beforeAll(async () => {
    const url = process.env["SUPABASE_TEST_URL"];
    const anonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
    if (!url || !anonKey) {
      throw new Error(
        "RLS de agente_config requiere SUPABASE_TEST_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY",
      );
    }

    const { data, error } = await client.auth.admin.createUser({
      email: EMAIL_VENDEDOR,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { rol: "vendedor" },
    });
    if (error && !error.message.includes("already been registered")) throw error;
    vendedorUserId = data?.user?.id ?? null;

    vendedorClient = createClient<Database>(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const login = await vendedorClient.auth.signInWithPassword({
      email: EMAIL_VENDEDOR,
      password: PASSWORD,
    });
    if (login.error) throw new Error(`login vendedor: ${login.error.message}`);
  });

  afterAll(async () => {
    if (vendedorUserId) await client.auth.admin.deleteUser(vendedorUserId);
    // `deleteUser` borra de `auth.users` pero la fila que el trigger creo en
    // `public.usuarios` NO se cascadea: verificado empiricamente, quedaba
    // huerfana. Un test que deja residuo en una DB compartida es un defecto.
    await client.from("usuarios").delete().eq("email", EMAIL_VENDEDOR);
  });

  test("vendedor puede leer la config", async () => {
    await repo.crear(insert({ version: 1 }));

    const { data, error } = await vendedorClient.from(TABLA).select("*");

    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  test("vendedor NO puede escribir la config", async () => {
    // PostgREST devuelve 42501 cuando la policy de INSERT deniega.
    const { error } = await vendedorClient.from(TABLA).insert({
      ...insert({ version: 999 }),
      horario: CONFIG_DE_FABRICA.horario as never,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });
});
