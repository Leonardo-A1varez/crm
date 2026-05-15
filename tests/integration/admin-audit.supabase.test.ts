import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseAdminAuditRepository } from "@/server/repositories/admin-audit.supabase.repo";
import type { AdminAuditContractFixtures } from "../repositories/admin-audit.contract";
import { runAdminAuditContract } from "../repositories/admin-audit.contract";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

let client: TestClient;
let fixtures: AdminAuditContractFixtures;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  fixtures = await seedFixtures(client);
});

beforeEach(async () => {
  // Cleanup admin_actions-only — preserva fixture usuarios.
  const { error } = await client
    .from("admin_actions")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup admin_actions fail: ${error.message}`);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

describe("SupabaseAdminAuditRepository (integration)", () => {
  runAdminAuditContract(
    () => new SupabaseAdminAuditRepository(client),
    () => fixtures,
  );
});

async function seedFixtures(c: TestClient): Promise<AdminAuditContractFixtures> {
  const actorUserIds = {
    user1: crypto.randomUUID(),
    u1: crypto.randomUUID(),
    u2: crypto.randomUUID(),
    u: crypto.randomUUID(),
  };

  // entity_id no tiene FK — UUIDs frescas sirven directo, no requieren seed.
  const entityIds = {
    intent1: crypto.randomUUID(),
    rule1: crypto.randomUUID(),
    i1: crypto.randomUUID(),
    i2: crypto.randomUUID(),
    r1: crypto.randomUUID(),
  };

  const usuariosRows = (Object.entries(actorUserIds) as [keyof typeof actorUserIds, string][]).map(
    ([key, id]) => ({
      id,
      nombre: `AdminAudit Fixture ${key}`,
      email: `admin-audit-${key}-${id}@test.local`,
      rol: "admin" as const,
    }),
  );
  const { error } = await c.from("usuarios").insert(usuariosRows);
  if (error) throw new Error(`seed usuarios: ${error.message}`);

  return { actorUserIds, entityIds };
}
