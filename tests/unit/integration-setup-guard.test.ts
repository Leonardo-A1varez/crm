import { describe, expect, test } from "vitest";
import { assertBaseDeTestsAislada } from "../integration/setup";

describe("assertBaseDeTestsAislada", () => {
  test("rechaza cuando la base de tests es la misma que la de la app", () => {
    expect(() =>
      assertBaseDeTestsAislada("https://abc.supabase.co", "https://abc.supabase.co"),
    ).toThrow(/mismo proyecto Supabase/);
  });

  test("ignora diferencias de barra final y mayusculas", () => {
    expect(() =>
      assertBaseDeTestsAislada("https://ABC.supabase.co/", "https://abc.supabase.co"),
    ).toThrow(/mismo proyecto Supabase/);
  });

  test("acepta cuando son proyectos distintos", () => {
    expect(() =>
      assertBaseDeTestsAislada("https://tests.supabase.co", "https://app.supabase.co"),
    ).not.toThrow();
  });

  test("acepta cuando la url de la app no esta definida", () => {
    expect(() => assertBaseDeTestsAislada("https://tests.supabase.co", undefined)).not.toThrow();
  });
});
