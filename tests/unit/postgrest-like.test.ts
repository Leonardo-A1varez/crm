import { describe, expect, test } from "vitest";
import { ilikeContains } from "@/server/db/postgrest-like";

describe("ilikeContains", () => {
  test("envuelve en %...% con comillas dobles", () => {
    expect(ilikeContains("ana")).toBe('"%ana%"');
  });

  test("escapa wildcards LIKE (% _ \\)", () => {
    expect(ilikeContains("100%")).toBe('"%100\\\\%%"');
    expect(ilikeContains("a_b")).toBe('"%a\\\\_b%"');
  });

  test("comillas dobles internas escapadas", () => {
    expect(ilikeContains('ll"anta')).toBe('"%ll\\"anta%"');
  });

  test("coma y paréntesis quedan tal cual adentro de las comillas", () => {
    expect(ilikeContains("a,(b)")).toBe('"%a,(b)%"');
  });
});
