import { describe, expect, test } from "vitest";
import { escaparLike, ilikeContains } from "@/server/db/postgrest-like";

describe("escaparLike", () => {
  test("neutraliza los wildcards de LIKE sin agregar comillas", () => {
    expect(escaparLike("FRE_1234")).toBe("FRE\\_1234");
    expect(escaparLike("100%")).toBe("100\\%");
    expect(escaparLike("a\\b")).toBe("a\\\\b");
  });

  test("no toca las comillas: el valor viaja como parámetro, no en el árbol de filtros", () => {
    expect(escaparLike('ll"anta')).toBe('ll"anta');
    expect(escaparLike("a,(b)")).toBe("a,(b)");
  });
});

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
