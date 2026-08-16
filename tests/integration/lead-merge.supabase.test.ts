import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { SupabaseLeadMergeRepository } from "@/server/repositories/lead-merge.supabase.repo";
import { sembrarLead, sembrarSesion } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";
import type { Database } from "@/server/db/types.gen";
import type { UUID } from "@/types/entities";

/**
 * Este repo no tiene contrato compartido y no es un olvido.
 *
 * `approve` y `revert` son envoltorios finos sobre dos funciones PL/pgSQL que
 * mueven filas de varias tablas dentro de una transacción. Una impl in-memory
 * que imitara eso no probaría nada de lo que puede fallar —el orden de los
 * UPDATE, los CASCADE, el rollback— y daría verde mientras la de verdad se
 * rompe. Acá la prueba solo tiene sentido contra Postgres.
 *
 * Corre con un cliente **autenticado como admin** y no con service-role: las
 * dos funciones exigen `is_admin()`, que lee el rol del JWT. Con service-role
 * no hay `auth.uid()` y las dos rechazan.
 *
 * `revert_lead_merge` está en la base desde el 2026-08-14 y **nunca se había
 * ejecutado**: este archivo es la primera vez que corre.
 */

const EMAIL_ADMIN = "merge-admin-test@crm.local";
const PASSWORD = "test-password-merge-123";

let service: TestClient;
let admin: SupabaseClient<Database>;
let repo: SupabaseLeadMergeRepository;
let adminUserId: string | undefined;

beforeAll(async () => {
  service = makeTestSupabaseClient();
  await cleanupTestDb(service);

  const { data: creado } = await service.auth.admin.createUser({
    email: EMAIL_ADMIN,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { rol: "admin" },
  });
  adminUserId = creado?.user?.id;
  if (!adminUserId) {
    // Ya existía de una corrida anterior: se recupera y se le asegura el rol.
    const { data: lista } = await service.auth.admin.listUsers();
    const existente = lista?.users.find((u) => u.email === EMAIL_ADMIN);
    if (!existente) throw new Error("no se pudo crear ni encontrar el usuario admin de prueba");
    adminUserId = existente.id;
    await service.auth.admin.updateUserById(adminUserId, {
      password: PASSWORD,
      app_metadata: { rol: "admin" },
    });
  }

  const url = process.env["SUPABASE_TEST_URL"];
  const anonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !anonKey) {
    throw new Error("lead-merge tests requieren SUPABASE_TEST_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  admin = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { error } = await admin.auth.signInWithPassword({
    email: EMAIL_ADMIN,
    password: PASSWORD,
  });
  if (error) throw new Error(`login admin de prueba: ${error.message}`);

  repo = new SupabaseLeadMergeRepository(admin as unknown as TestClient);
});

beforeEach(async () => {
  // No se usa `cleanupTestDb`: borra `usuarios`, y aunque el rol sale del JWT
  // el borrado en cascada se lleva por delante las filas de auditoría que este
  // test necesita comparar. Se limpia solo lo que se ensucia.
  for (const tabla of ["admin_actions", "merge_candidates", "lead_session", "leads"] as const) {
    const { error } = await service
      .from(tabla)
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw new Error(`cleanup ${tabla}: ${error.message}`);
  }
});

afterAll(async () => {
  await cleanupTestDb(service);
  if (adminUserId) await service.auth.admin.deleteUser(adminUserId);
});

/** Dos leads y el candidato que los propone como duplicados. */
async function armarPar(): Promise<{ ganador: UUID; perdedor: UUID; candidatoId: UUID }> {
  const ganador = await sembrarLead(service, "merge-ganador");
  const perdedor = await sembrarLead(service, "merge-perdedor");
  const candidatoId = crypto.randomUUID();
  const { error } = await service.from("merge_candidates").insert({
    id: candidatoId,
    src_lead_id: perdedor,
    dst_lead_id: ganador,
    similarity_score: 0.95,
    reasons: { tipos: ["telefono"] },
    status: "pending",
  });
  if (error) throw new Error(`seed merge_candidates: ${error.message}`);
  return { ganador, perdedor, candidatoId };
}

describe("SupabaseLeadMergeRepository (integration)", () => {
  test("approve devuelve el ganador y el perdedor deja de existir", async () => {
    const { ganador, perdedor, candidatoId } = await armarPar();

    const r = await repo.approve({ candidateId: candidatoId, keepLeadId: ganador });

    expect(r.ganadorId).toBe(ganador);

    const { data: sobreviviente } = await service.from("leads").select("id").eq("id", ganador);
    const { data: absorbido } = await service.from("leads").select("id").eq("id", perdedor);
    expect(sobreviviente).toHaveLength(1);
    expect(absorbido).toHaveLength(0);
  });

  // Es lo que hace la fusión reversible: sin auditoría no hay a qué volver.
  test("approve deja la fusión registrada en el lead ganador", async () => {
    const { ganador, perdedor, candidatoId } = await armarPar();

    await repo.approve({ candidateId: candidatoId, keepLeadId: ganador });

    const fusiones = await repo.listByLeadId(ganador);

    expect(fusiones).toHaveLength(1);
    expect(fusiones[0]?.perdedor.id).toBe(perdedor);
    // `payload_version` 4: la auditoría guarda qué se movió, que es lo que
    // hace la fusión deshacible.
    expect(fusiones[0]?.reversible).toBe(true);
    expect(fusiones[0]?.revertida).toBe(false);
  });

  test("un lead sin fusiones devuelve lista vacía", async () => {
    const solo = await sembrarLead(service, "merge-solo");

    expect(await repo.listByLeadId(solo)).toEqual([]);
  });

  // Las sesiones del lead absorbido tienen que quedar colgando del ganador: si
  // se perdieran, la fusión borraría el historial de conversaciones.
  test("las sesiones del perdedor pasan al ganador", async () => {
    const { ganador, perdedor, candidatoId } = await armarPar();
    const sesionDelPerdedor = await sembrarSesion(service, perdedor, "merge-sesion");

    await repo.approve({ candidateId: candidatoId, keepLeadId: ganador });

    const { data } = await service
      .from("lead_session")
      .select("lead_id")
      .eq("id", sesionDelPerdedor);
    expect(data?.[0]?.lead_id).toBe(ganador);
  });

  describe("revert", () => {
    test("resucita al lead absorbido", async () => {
      const { ganador, perdedor, candidatoId } = await armarPar();
      await repo.approve({ candidateId: candidatoId, keepLeadId: ganador });
      const [fusion] = await repo.listByLeadId(ganador);

      const r = await repo.revert(fusion!.accionId);

      expect(r.perdedorId).toBe(perdedor);
      const { data } = await service.from("leads").select("id").eq("id", perdedor);
      expect(data).toHaveLength(1);
    });

    test("devuelve las sesiones a su lead original", async () => {
      const { ganador, perdedor, candidatoId } = await armarPar();
      const sesionDelPerdedor = await sembrarSesion(service, perdedor, "merge-revert-sesion");
      await repo.approve({ candidateId: candidatoId, keepLeadId: ganador });
      const [fusion] = await repo.listByLeadId(ganador);

      await repo.revert(fusion!.accionId);

      const { data } = await service
        .from("lead_session")
        .select("lead_id")
        .eq("id", sesionDelPerdedor);
      expect(data?.[0]?.lead_id).toBe(perdedor);
    });

    // La fusión NO desaparece del historial: queda marcada. Borrarla dejaría al
    // lead sin rastro de que alguna vez absorbió a otro, y esa es justamente la
    // información que hace falta para entender por qué tiene los datos que tiene.
    test("después de deshacerla queda marcada, no borrada", async () => {
      const { ganador, candidatoId } = await armarPar();
      await repo.approve({ candidateId: candidatoId, keepLeadId: ganador });
      const [fusion] = await repo.listByLeadId(ganador);

      await repo.revert(fusion!.accionId);

      const despues = await repo.listByLeadId(ganador);
      expect(despues).toHaveLength(1);
      expect(despues[0]?.revertida).toBe(true);
    });

    // Deshacer dos veces resucitaría un lead que ya existe. La función tiene
    // que negarse, no duplicarlo.
    test("deshacer dos veces la misma fusión falla la segunda", async () => {
      const { ganador, candidatoId } = await armarPar();
      await repo.approve({ candidateId: candidatoId, keepLeadId: ganador });
      const [fusion] = await repo.listByLeadId(ganador);
      await repo.revert(fusion!.accionId);

      await expect(repo.revert(fusion!.accionId)).rejects.toThrow();
    });

    test("una acción que no existe no resucita nada", async () => {
      await expect(repo.revert(crypto.randomUUID())).rejects.toThrow(NotFoundError);
    });
  });
});
