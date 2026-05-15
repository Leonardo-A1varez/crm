import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseIntentsRepository } from "@/server/repositories/intents.supabase.repo";
import { runIntentsContract } from "../repositories/intents.contract";
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

describe("SupabaseIntentsRepository (integration)", () => {
  runIntentsContract(() => new SupabaseIntentsRepository(client));
});
