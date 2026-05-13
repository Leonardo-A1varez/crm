import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { runLeadsContract } from "../repositories/leads.contract";
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

describe("SupabaseLeadsRepository (integration)", () => {
  runLeadsContract(() => new SupabaseLeadsRepository(client));
});
