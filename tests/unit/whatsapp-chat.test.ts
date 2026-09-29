import { describe, expect, test } from "vitest";
import { chatWhatsAppDeLead, motivoLegible } from "@/lib/whatsapp/chat";

describe("chatWhatsAppDeLead", () => {
  test("un lead de WhatsApp con teléfono válido devuelve el número en E.164 sin +", () => {
    expect(chatWhatsAppDeLead({ telefono: "+593 97 993 2363" }, "wa")).toEqual({
      telefono: "593979932363",
    });
  });

  test("un lead cuya conversación activa es de otro canal no tiene chat de WhatsApp", () => {
    expect(chatWhatsAppDeLead({ telefono: "593979932363" }, "ig")).toEqual({
      motivo: "otro_canal",
    });
    expect(chatWhatsAppDeLead({ telefono: "593979932363" }, "fb")).toEqual({
      motivo: "otro_canal",
    });
  });

  test("un placeholder de Instagram o un número sin código de país no sirve", () => {
    expect(chatWhatsAppDeLead({ telefono: "ig:17841400000000" }, "wa")).toEqual({
      motivo: "sin_telefono",
    });
    expect(chatWhatsAppDeLead({ telefono: "0991234567" }, "wa")).toEqual({
      motivo: "sin_telefono",
    });
    expect(chatWhatsAppDeLead({ telefono: "" }, "wa")).toEqual({ motivo: "sin_telefono" });
  });
});

describe("motivoLegible", () => {
  test("traduce los motivos conocidos y agrupa carga_fallida", () => {
    expect(motivoLegible("telefono_invalido")).toBe(
      "El número de este lead no sirve para abrir un chat de WhatsApp.",
    );
    expect(motivoLegible("carga_fallida:ENOTFOUND")).toBe(
      "No se pudo cargar WhatsApp Web. Revisá la conexión a internet.",
    );
  });

  test("un motivo desconocido se muestra tal cual, sin inventar texto", () => {
    expect(motivoLegible("algo_nuevo")).toBe("algo_nuevo");
  });
});
