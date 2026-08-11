import { describe, expect, test } from "vitest";
import { nombreDeRegla } from "@/lib/ui/regla";

describe("nombreDeRegla", () => {
  test("usa la primera línea de la respuesta", () => {
    expect(nombreDeRegla("Enviamos a todo el país.\nConsultá el costo.")).toBe(
      "Enviamos a todo el país.",
    );
  });

  test("recorta los espacios de la línea", () => {
    expect(nombreDeRegla("  Tenemos stock  \nsegunda")).toBe("Tenemos stock");
  });

  test("una respuesta vacía o que arranca en blanco tiene rótulo propio", () => {
    expect(nombreDeRegla("")).toBe("(sin contenido)");
    expect(nombreDeRegla("\nsegunda línea")).toBe("(sin contenido)");
  });
});
