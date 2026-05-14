import { describe, expect, test } from "vitest";
import { isUuid } from "@/server/db/uuid";

describe("isUuid", () => {
  test("acepta UUID v4 canonical lowercase", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  test("acepta UUID uppercase", () => {
    expect(isUuid("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });

  test("rechaza string vacío", () => {
    expect(isUuid("")).toBe(false);
  });

  test("rechaza string no-uuid (caso bug findById)", () => {
    expect(isUuid("missing-id")).toBe(false);
  });

  test("rechaza uuid sin dashes", () => {
    expect(isUuid("550e8400e29b41d4a716446655440000")).toBe(false);
  });

  test("rechaza uuid con caracter no-hex", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-44665544000z")).toBe(false);
  });

  test("rechaza uuid con largo incorrecto", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-44665544")).toBe(false);
  });
});
