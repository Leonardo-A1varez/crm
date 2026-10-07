import { describe, expect, test } from "vitest";
import { CASOS } from "../../evals/agente/casos";

/*
 * Los casos del eval del agente para el Niro no se corren contra OpenAI en la suite
 * unitaria, pero su entrada (la salida de la herramienta) sí se puede comprobar: es la
 * función de producción sobre filas reales.
 */
describe("casos del eval: amortiguadores del Kia Niro", () => {
  const caso = (id: string) => {
    const c = CASOS.find((x) => x.id === id);
    if (!c) throw new Error(`falta el caso ${id}`);
    return c;
  };

  test("la salida del caso real cotiza los dos laterales y ninguna basura", () => {
    const s = caso("real-amortiguadores-delanteros-niro-2020-sin-basura").salida;
    expect(s?.matches.map((m) => [m.codigo_interno, m.lado, m.precio])).toEqual([
      ["23868", "izquierdo", 89.55],
      ["23869", "derecho", 94.22],
    ]);
    expect(s?.encabezado).toBe("Amortiguadores delanteros Niro 2020 (IVA incluido):");
    expect(JSON.stringify(s)).not.toMatch(/emg/i);
  });

  test("la salida sin existencia no trae precios ni encabezado", () => {
    const s = caso("inv-amortiguadores-niro-sin-existencia").salida;
    expect(s?.sin_existencia).toBe(true);
    expect(s?.encabezado).toBeUndefined();
    expect(s?.matches.every((m) => m.precio === undefined)).toBe(true);
  });

  test("el caso real tiene origen real y nota de qué parte lo es", () => {
    const c = caso("real-amortiguadores-delanteros-niro-2020-sin-basura");
    expect(c.origen).toBe("real");
    expect(c.notaOrigen).toBeTruthy();
  });
});
