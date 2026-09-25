import { describe, expect, it } from "vitest";
import { TOPE_PASOS, leerTopePasos } from "@/app/(panel)/workflows/[id]/_lib/max-pasos";
import { GuardarVersionSchema } from "@/lib/validation/workflows.schema";

/**
 * El tope de pasos por corrida volvió al editor como un campo de texto. Lo que
 * se protege acá es que el campo acepte exactamente lo que acepta la action
 * —si divergen, el campo dice que está bien y "Guardar" lo rebota— y que el
 * texto a medio escribir no se convierta en un número inventado.
 */
describe("leerTopePasos", () => {
  it.each([
    ["1", 1],
    ["50", 50],
    ["500", 500],
    [" 42 ", 42],
    ["0500", 500],
  ])("«%s» se lee como %i", (texto, valor) => {
    expect(leerTopePasos(texto)).toEqual({ ok: true, valor });
  });

  it.each(["", "   ", "0", "501", "1.5", "-3", "1e2", "abc", "12 pasos", "99999999999999999999"])(
    "«%s» no es un tope válido y el error dice el rango",
    (texto) => {
      const r = leerTopePasos(texto);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain(`${TOPE_PASOS.MIN} y ${TOPE_PASOS.MAX}`);
    },
  );

  it("acepta y rechaza lo mismo que la action de guardar", () => {
    const schema = GuardarVersionSchema.shape.maxPasos;
    for (const n of [-1, 0, 1, 2, 250, 499, 500, 501, 1000]) {
      expect(leerTopePasos(String(n)).ok).toBe(schema.safeParse(n).success);
    }
  });

  it("el tope por defecto es uno que la action acepta", () => {
    expect(GuardarVersionSchema.shape.maxPasos.safeParse(TOPE_PASOS.POR_DEFECTO).success).toBe(
      true,
    );
  });
});
