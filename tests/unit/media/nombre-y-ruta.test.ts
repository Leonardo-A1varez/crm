import { describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import { esRutaDeMedia, rutaDeMedia } from "@/lib/media/ruta";
import { sanearNombreArchivo } from "@/lib/media/sanear-nombre";

describe("sanearNombreArchivo", () => {
  test("deja un nombre normal como esta", () => {
    expect(sanearNombreArchivo("Cotización Corolla 2018.pdf")).toBe("Cotización Corolla 2018.pdf");
  });

  test("se queda con el ultimo tramo: sin rutas ni traversal", () => {
    expect(sanearNombreArchivo("../../etc/passwd")).toBe("passwd");
    expect(sanearNombreArchivo("C:\\Windows\\System32\\cmd.exe")).toBe("cmd.exe");
    expect(sanearNombreArchivo("a/b/../c.txt")).toBe("c.txt");
  });

  test("saca caracteres que Windows o los headers no admiten", () => {
    expect(sanearNombreArchivo('a<b>c:d"e|f?g*h.pdf')).toBe("a_b_c_d_e_f_g_h.pdf");
    expect(sanearNombreArchivo("linea1\r\nSet-Cookie: x=1.pdf")).toBe("linea1 Set-Cookie_ x=1.pdf");
    expect(sanearNombreArchivo("nul\u0000byte.pdf")).toBe("nulbyte.pdf");
  });

  test("sin puntos ni espacios al final, sin ocultos", () => {
    expect(sanearNombreArchivo("archivo. . .")).toBe("archivo");
    expect(sanearNombreArchivo("   foto.jpg   ")).toBe("foto.jpg");
    expect(sanearNombreArchivo(".htaccess")).toBe("htaccess");
  });

  test("nombres reservados de Windows se prefijan", () => {
    expect(sanearNombreArchivo("CON.txt")).toBe("_CON.txt");
    expect(sanearNombreArchivo("nul")).toBe("_nul");
    expect(sanearNombreArchivo("com1.pdf")).toBe("_com1.pdf");
    expect(sanearNombreArchivo("console.txt")).toBe("console.txt");
  });

  test("vacio o solo basura cae en 'archivo'", () => {
    expect(sanearNombreArchivo("")).toBe("archivo");
    expect(sanearNombreArchivo("...")).toBe("archivo");
    expect(sanearNombreArchivo("///")).toBe("archivo");
    expect(sanearNombreArchivo("\u0000\u0001")).toBe("archivo");
  });

  test("un nombre largo se recorta sin perder la extension", () => {
    const largo = `${"a".repeat(300)}.pdf`;
    const r = sanearNombreArchivo(largo);
    expect(r.length).toBeLessThanOrEqual(80);
    expect(r.endsWith(".pdf")).toBe(true);
  });

  test("mantiene tildes y letras no latinas (no es una lista blanca ASCII)", () => {
    expect(sanearNombreArchivo("ñandú-日本.pdf")).toBe("ñandú-日本.pdf");
  });
});

describe("rutaDeMedia", () => {
  const SESION = "0f5c1a52-3a3f-4ac9-9a4b-1f6ab3a7c2d1";
  const MENSAJE = "7d9e8a10-0bd4-4b8a-8b43-5c2e1f0a9b77";

  test("arma sesiones/<sesion>/<mensaje>.<ext>", () => {
    expect(rutaDeMedia(SESION, MENSAJE, "webp")).toBe(`sesiones/${SESION}/${MENSAJE}.webp`);
  });

  test("es la misma ruta para el mismo mensaje: reintentar sobrescribe, no duplica", () => {
    expect(rutaDeMedia(SESION, MENSAJE, "jpg")).toBe(rutaDeMedia(SESION, MENSAJE, "jpg"));
  });

  test("rechaza ids que no son uuid y extensiones raras", () => {
    expect(() => rutaDeMedia("../x", MENSAJE, "jpg")).toThrow(ValidationError);
    expect(() => rutaDeMedia(SESION, "a/b", "jpg")).toThrow(ValidationError);
    expect(() => rutaDeMedia(SESION, MENSAJE, "../jpg")).toThrow(ValidationError);
    expect(() => rutaDeMedia(SESION, MENSAJE, "")).toThrow(ValidationError);
    expect(() => rutaDeMedia(SESION, MENSAJE, "JPG")).toThrow(ValidationError);
  });

  test("esRutaDeMedia coincide con el CHECK de la base", () => {
    expect(esRutaDeMedia(`sesiones/${SESION}/${MENSAJE}.png`)).toBe(true);
    expect(esRutaDeMedia(`sesiones/${SESION}/${MENSAJE}.PNG`)).toBe(false);
    expect(esRutaDeMedia(`flujos/${MENSAJE}.png`)).toBe(false);
    expect(esRutaDeMedia(`sesiones/${SESION}/../${MENSAJE}.png`)).toBe(false);
    expect(esRutaDeMedia(`/sesiones/${SESION}/${MENSAJE}.png`)).toBe(false);
    expect(esRutaDeMedia("")).toBe(false);
  });
});
