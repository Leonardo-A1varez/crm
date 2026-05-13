import { afterEach, describe, expect, test } from "vitest";
import {
  __resetDefaultDbClientFactoryForTests,
  defaultDbClientFactory,
  makeDbClientFactory,
} from "@/server/db/client";

const TEST_CFG = {
  url: "http://localhost:54321",
  anonKey: "test-anon-key",
  serviceRoleKey: "test-service-role-key",
};

describe("makeDbClientFactory", () => {
  test("serviceRole() retorna SupabaseClient", () => {
    const factory = makeDbClientFactory(TEST_CFG);
    const client = factory.serviceRole();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe("function");
    expect(typeof client.rpc).toBe("function");
  });

  test("serviceRole() es singleton (mismo instance entre calls)", () => {
    const factory = makeDbClientFactory(TEST_CFG);
    const a = factory.serviceRole();
    const b = factory.serviceRole();
    expect(a).toBe(b);
  });

  test("authed(jwt) retorna nuevo client per call (no singleton)", () => {
    const factory = makeDbClientFactory(TEST_CFG);
    const a = factory.authed("jwt-user-1");
    const b = factory.authed("jwt-user-2");
    expect(a).not.toBe(b);
  });

  test("authed con mismo jwt retorna distintas instances (per-request scope)", () => {
    const factory = makeDbClientFactory(TEST_CFG);
    const a = factory.authed("same-jwt");
    const b = factory.authed("same-jwt");
    // Distintas instances — cada Server Action / route handler obtiene su propio cliente.
    expect(a).not.toBe(b);
  });

  test("serviceRole vs authed retornan instances distintas", () => {
    const factory = makeDbClientFactory(TEST_CFG);
    const sr = factory.serviceRole();
    const au = factory.authed("jwt");
    expect(sr).not.toBe(au);
  });

  test("factory independiente entre instances", () => {
    const f1 = makeDbClientFactory(TEST_CFG);
    const f2 = makeDbClientFactory(TEST_CFG);
    expect(f1.serviceRole()).not.toBe(f2.serviceRole());
  });
});

describe("defaultDbClientFactory", () => {
  afterEach(() => {
    __resetDefaultDbClientFactoryForTests();
  });

  test("retorna singleton lazy", () => {
    const a = defaultDbClientFactory();
    const b = defaultDbClientFactory();
    expect(a).toBe(b);
  });

  test("reset clear singleton + permite nueva instance", () => {
    const a = defaultDbClientFactory();
    __resetDefaultDbClientFactoryForTests();
    const b = defaultDbClientFactory();
    expect(a).not.toBe(b);
  });

  test("expose serviceRole + authed", () => {
    const factory = defaultDbClientFactory();
    expect(typeof factory.serviceRole).toBe("function");
    expect(typeof factory.authed).toBe("function");

    const sr = factory.serviceRole();
    const au = factory.authed("test-jwt");
    expect(typeof sr.from).toBe("function");
    expect(typeof au.from).toBe("function");
  });
});
