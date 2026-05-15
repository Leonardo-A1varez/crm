import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseUsersRepository } from "@/server/repositories/users.supabase.repo";
import { runUsersContract } from "../repositories/users.contract";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

let client: TestClient;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
});

beforeEach(async () => {
  await cleanupTestDb(client);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

describe("SupabaseUsersRepository (integration)", () => {
  runUsersContract(() => new SupabaseUsersRepository(client));
});
