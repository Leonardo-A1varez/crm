import { describe, expect, test } from "vitest";
import { ETIQUETA_PRINCIPAL, accionesDeTarjeta } from "@/lib/copiloto/acciones";

describe("accionesDeTarjeta (tabla de §5)", () => {
  test("app de escritorio en WhatsApp Web: Insertar, sin Al composer", () => {
    expect(accionesDeTarjeta("escritorio-whatsapp", true)).toEqual({
      principal: "insertar",
      alComposer: false,
    });
  });

  test("app de escritorio en Hilo del CRM: Insertar y Al composer", () => {
    expect(accionesDeTarjeta("escritorio-hilo", true)).toEqual({
      principal: "insertar",
      alComposer: true,
    });
  });

  test("navegador con teléfono: Abrir en WhatsApp Web", () => {
    expect(accionesDeTarjeta("navegador", true)).toEqual({
      principal: "abrir_web",
      alComposer: false,
    });
  });

  test("navegador sin teléfono válido: no hay a dónde abrir, queda Al composer", () => {
    expect(accionesDeTarjeta("navegador", false)).toEqual({ principal: null, alComposer: true });
  });

  test("mientras no se sabe dónde corre (primer render) no hay acción de envío", () => {
    expect(accionesDeTarjeta(null, true)).toEqual({ principal: null, alComposer: false });
  });

  test("los textos de las acciones principales", () => {
    expect(ETIQUETA_PRINCIPAL.insertar).toBe("Insertar en WhatsApp");
    expect(ETIQUETA_PRINCIPAL.abrir_web).toBe("Abrir en WhatsApp Web");
  });
});
