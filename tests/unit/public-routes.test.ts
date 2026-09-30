import { describe, expect, it } from "vitest";
import { RUTAS_PUBLICAS, esRutaPublica } from "@/server/auth/public-routes";

describe("esRutaPublica", () => {
  it("expone exactamente las 3 páginas legales", () => {
    expect([...RUTAS_PUBLICAS]).toEqual(["/privacidad", "/condiciones", "/eliminacion-de-datos"]);
  });

  it.each(["/privacidad", "/condiciones", "/eliminacion-de-datos", "/privacidad/"])(
    "%s es pública",
    (ruta) => {
      expect(esRutaPublica(ruta)).toBe(true);
    },
  );

  it.each([
    "/",
    "/inbox",
    "/leads",
    "/ajustes",
    "/login",
    "/privacidad/extra",
    "/privacidades",
    "/admin/privacidad",
    "/eliminacion-de-datos-x",
  ])("%s sigue protegida", (ruta) => {
    expect(esRutaPublica(ruta)).toBe(false);
  });
});
