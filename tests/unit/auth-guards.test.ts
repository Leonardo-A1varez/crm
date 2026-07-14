import { describe, expect, test } from "vitest";
import { rolFromUser } from "@/server/auth/guards";
import type { User } from "@supabase/supabase-js";

function fakeUser(appMetadata: Record<string, unknown>): User {
  return { app_metadata: appMetadata } as unknown as User;
}

describe("rolFromUser", () => {
  test("admin cuando app_metadata.rol = admin", () => {
    expect(rolFromUser(fakeUser({ rol: "admin" }))).toBe("admin");
  });

  test("vendedor cuando app_metadata.rol = vendedor", () => {
    expect(rolFromUser(fakeUser({ rol: "vendedor" }))).toBe("vendedor");
  });

  test("fallback vendedor cuando rol ausente", () => {
    expect(rolFromUser(fakeUser({}))).toBe("vendedor");
  });

  test("fallback vendedor cuando rol inválido", () => {
    expect(rolFromUser(fakeUser({ rol: "superuser" }))).toBe("vendedor");
  });

  test("fallback vendedor cuando user es null", () => {
    expect(rolFromUser(null)).toBe("vendedor");
  });
});
