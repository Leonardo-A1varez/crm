import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseEventOutboxRepository } from "@/server/repositories/event-outbox.supabase.repo";
import { runEventOutboxContract } from "../repositories/event-outbox.contract";
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

describe("SupabaseEventOutboxRepository (integration)", () => {
  runEventOutboxContract(() => new SupabaseEventOutboxRepository(client));
});
