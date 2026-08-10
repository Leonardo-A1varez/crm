import { describe, expect, test } from "vitest";
import { esTagColor, TAG_COLORS, TAG_COLOR_VALUES, tagColorLabel } from "@/lib/ui/tag-color";

/**
 * Los seis colores con los que `crearYAsignarEtiqueta` pinta las etiquetas
 * creadas al vuelo desde la conversación (`COLORES_ETIQUETA` en
 * `src/server/services/inbox/default-inbox.service.ts`, que es privado del
 * módulo y por eso se repite acá).
 *
 * Si la paleta de /tags dejara alguno afuera, la etiqueta que el vendedor creó
 * desde el Twin no se podría guardar en la pantalla de administración sin
 * cambiarle el color — el formulario la rechazaría por color inválido.
 */
const COLORES_DEL_TWIN = ["#FFAF3A", "#34D399", "#7FB3F5", "#E879F9", "#FB923C", "#38BDF8"];

describe("paleta de etiquetas", () => {
  test("todos los colores cumplen el CHECK hex de la tabla tags", () => {
    for (const c of TAG_COLORS) {
      expect(c.value).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  test("no hay colores ni nombres repetidos", () => {
    expect(new Set(TAG_COLORS.map((c) => c.value)).size).toBe(TAG_COLORS.length);
    expect(new Set(TAG_COLORS.map((c) => c.label)).size).toBe(TAG_COLORS.length);
  });

  test("cubre los colores que el Twin genera al crear etiquetas al vuelo", () => {
    for (const color of COLORES_DEL_TWIN) {
      expect(esTagColor(color)).toBe(true);
    }
  });

  test("TAG_COLOR_VALUES tiene los mismos valores y el mismo orden que TAG_COLORS", () => {
    expect([...TAG_COLOR_VALUES]).toEqual(TAG_COLORS.map((c) => c.value));
  });

  test("esTagColor rechaza el gris por defecto de la tabla y un hex arbitrario", () => {
    // `tags.color` default es '#888888': gris sobre gris, que es justo lo que
    // la paleta existe para evitar.
    expect(esTagColor("#888888")).toBe(false);
    expect(esTagColor("#000000")).toBe(false);
    expect(esTagColor("no-es-color")).toBe(false);
  });

  test("tagColorLabel devuelve el hex crudo cuando el color no es de la paleta", () => {
    expect(tagColorLabel("#FFAF3A")).toBe("Ámbar");
    expect(tagColorLabel("#888888")).toBe("#888888");
  });
});
