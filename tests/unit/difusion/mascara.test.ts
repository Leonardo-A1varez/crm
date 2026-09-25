import { describe, expect, test } from "vitest";
import { enmascararTelefono } from "@/lib/difusion/mascara";

// Números inventados para este archivo, con la forma de un E.164 y nada más.
describe("enmascararTelefono", () => {
  test("deja ver el prefijo y los tres últimos de un número largo", () => {
    expect(enmascararTelefono("593991234214")).toBe("+593 ••• ••• 214");
    expect(enmascararTelefono("5491122334455")).toBe("+549 ••• ••• 455");
  });

  test("en un número corto muestra menos, para no dejarlo casi entero", () => {
    expect(enmascararTelefono("123456789")).toBe("+123 ••• 89");
    expect(enmascararTelefono("1234567")).toBe("+123 •••");
  });

  test("normaliza antes de enmascarar", () => {
    expect(enmascararTelefono("+593 99 123 4214")).toBe("+593 ••• ••• 214");
  });

  test("lo que no es un número de WhatsApp no se muestra", () => {
    expect(enmascararTelefono(null)).toBe("—");
    expect(enmascararTelefono("ig:1784")).toBe("—");
  });
});
