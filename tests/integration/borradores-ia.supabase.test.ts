import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SupabaseBorradoresIaRepository } from "@/server/repositories/borradores-ia.supabase.repo";
import {
  runBorradoresIaContract,
  type BorradoresIaContractFixtures,
} from "../repositories/borradores-ia.contract";
import { sembrarCadena, sembrarIntent, sembrarMensaje, sembrarRegla } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

let client: TestClient;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

/** Cadena nueva por test: cada uno arranca con su "último entrante" propio. */
async function nuevasFixtures(): Promise<BorradoresIaContractFixtures> {
  const a = await sembrarCadena(client, "borr-a");
  const b = await sembrarCadena(client, "borr-b");
  const usuarioId = crypto.randomUUID();
  const { error } = await client.from("usuarios").insert({
    id: usuarioId,
    nombre: "Borradores Fixture",
    email: `borradores-${usuarioId}@test.local`,
    rol: "vendedor" as const,
  });
  if (error) throw new Error(`seed usuarios: ${error.message}`);
  const intentId = await sembrarIntent(client, `borr-${crypto.randomUUID().slice(0, 8)}`);
  const reglaId = await sembrarRegla(client, intentId);
  return {
    conversacionId: a.conversacionId,
    otraConversacionId: b.conversacionId,
    leadSessionId: a.sesionId,
    otraLeadSessionId: b.sesionId,
    usuarioId,
    reglaId,
    primerEntranteId: a.mensajeId,
    entranteDeOtraId: b.mensajeId,
    nuevoEntrante: () => sembrarMensaje(client, a.conversacionId, a.sesionId, "otro mensaje"),
  };
}

describe("SupabaseBorradoresIaRepository (integration)", () => {
  runBorradoresIaContract(() => new SupabaseBorradoresIaRepository(client), nuevasFixtures);
});

describe("garantías que solo existen contra Postgres", () => {
  test("dos iniciar concurrentes para el mismo entrante: uno crea, el otro ve 'existente', y queda UN vigente", async () => {
    const f = await nuevasFixtures();
    const repo = new SupabaseBorradoresIaRepository(client);
    const input = {
      conversacionId: f.conversacionId,
      leadSessionId: f.leadSessionId,
      mensajeOrigenId: f.primerEntranteId,
    };

    const [a, b] = await Promise.all([repo.iniciar(input), repo.iniciar(input)]);

    expect([a.resultado, b.resultado].sort()).toEqual(["creado", "existente"]);
    const { count } = await client
      .from("borradores_ia")
      .select("id", { count: "exact", head: true })
      .eq("conversacion_id", f.conversacionId)
      .in("estado", ["redactando", "listo", "error"]);
    expect(count).toBe(1);
  });

  test("el índice único parcial rechaza un segundo vigente insertado a mano (23505)", async () => {
    const f = await nuevasFixtures();
    const base = {
      conversacion_id: f.conversacionId,
      lead_session_id: f.leadSessionId,
      mensaje_origen_id: f.primerEntranteId,
      estado: "listo" as const,
      contenido: "uno",
      origen: "ia" as const,
    };
    const primero = await client.from("borradores_ia").insert(base);
    expect(primero.error).toBeNull();

    const segundo = await client.from("borradores_ia").insert({ ...base, contenido: "dos" });
    expect(segundo.error?.code).toBe("23505");
  });

  test("los CHECK rechazan estados incoherentes (23514)", async () => {
    const f = await nuevasFixtures();
    const base = {
      conversacion_id: f.conversacionId,
      lead_session_id: f.leadSessionId,
      mensaje_origen_id: f.primerEntranteId,
    };

    const listoSinTexto = await client.from("borradores_ia").insert({ ...base, estado: "listo" });
    expect(listoSinTexto.error?.code).toBe("23514");

    const errorConTextoLibre = await client
      .from("borradores_ia")
      .insert({ ...base, estado: "error", error_codigo: "El proveedor dijo: 500 Internal" });
    expect(errorConTextoLibre.error?.code).toBe("23514");

    const usadoSinVia = await client.from("borradores_ia").insert({ ...base, estado: "usado" });
    expect(usadoSinVia.error?.code).toBe("23514");
  });

  test("borrar la conversación borra sus borradores (CASCADE)", async () => {
    const f = await nuevasFixtures();
    const repo = new SupabaseBorradoresIaRepository(client);
    await repo.iniciar({
      conversacionId: f.conversacionId,
      leadSessionId: f.leadSessionId,
      mensajeOrigenId: f.primerEntranteId,
    });

    const del = await client.from("conversaciones").delete().eq("id", f.conversacionId);
    expect(del.error).toBeNull();

    const { count } = await client
      .from("borradores_ia")
      .select("id", { count: "exact", head: true })
      .eq("conversacion_id", f.conversacionId);
    expect(count).toBe(0);
  });

  test("las dos llamadas concurrentes de marcarUsado: una marca y la otra ve 'ya_usado'", async () => {
    const f = await nuevasFixtures();
    const repo = new SupabaseBorradoresIaRepository(client);
    const r = await repo.iniciar({
      conversacionId: f.conversacionId,
      leadSessionId: f.leadSessionId,
      mensajeOrigenId: f.primerEntranteId,
    });
    if (r.resultado !== "creado") throw new Error("fixture: se esperaba 'creado'");
    await repo.completar(r.borradorId, { contenido: "Texto", origen: "ia", reglaId: null });

    const [a, b] = await Promise.all([
      repo.marcarUsado(r.borradorId, { via: "copiar", usuarioId: f.usuarioId }),
      repo.marcarUsado(r.borradorId, { via: "insertar", usuarioId: f.usuarioId }),
    ]);

    expect([a, b].sort()).toEqual(["marcado", "ya_usado"]);
  });
});
