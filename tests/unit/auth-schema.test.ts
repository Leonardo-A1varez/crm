import { describe, expect, test } from "vitest";
import { LoginSchema } from "@/lib/validation/auth.schema";

describe("LoginSchema", () => {
  test("acepta email válido y password no vacía, normaliza email a lowercase", () => {
    const parsed = LoginSchema.parse({ email: "Admin@Empresa.COM", password: "secreta123" });
    expect(parsed.email).toBe("admin@empresa.com");
  });

  test("rechaza email inválido", () => {
    expect(LoginSchema.safeParse({ email: "no-email", password: "x".repeat(8) }).success).toBe(
      false,
    );
  });

  test("rechaza password menor a 8", () => {
    expect(LoginSchema.safeParse({ email: "a@b.com", password: "corta" }).success).toBe(false);
  });

  test("rechaza password mayor a 72 (límite bcrypt)", () => {
    expect(LoginSchema.safeParse({ email: "a@b.com", password: "x".repeat(73) }).success).toBe(
      false,
    );
  });
});
