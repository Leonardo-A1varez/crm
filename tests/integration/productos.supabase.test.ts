import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseProductsRepository } from "@/server/repositories/productos.supabase.repo";
import { runProductosContract } from "../repositories/productos.contract";
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

describe("SupabaseProductsRepository (integration)", () => {
  runProductosContract(() => new SupabaseProductsRepository(client));
});
