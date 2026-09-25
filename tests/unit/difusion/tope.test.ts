import { describe, expect, test } from "vitest";
import { topeDesdeLimite } from "@/server/services/difusion/tope";

// La forma de `SaludWhatsApp.limite` (salud-whatsapp.service.ts), armada a mano.
describe("topeDesdeLimite", () => {
  test("el escalón que Meta devolvió es el tope", () => {
    expect(
      topeDesdeLimite({ estado: "ok", valor: { crudo: "TIER_250", destinatarios: 250 } }),
    ).toEqual({ estado: "ok", tope: 250 });
    expect(
      topeDesdeLimite({
        estado: "ok",
        valor: { crudo: "TIER_UNLIMITED", destinatarios: "ilimitado" },
      }),
    ).toEqual({ estado: "ok", tope: "ilimitado" });
  });

  test("un escalón que no se sabe leer no se adivina", () => {
    const r = topeDesdeLimite({
      estado: "ok",
      valor: { crudo: "TIER_NOT_SET", destinatarios: null },
    });
    expect(r.estado).toBe("sin-dato");
    expect(r.estado === "sin-dato" ? r.motivo : "").toMatch(/TIER_NOT_SET/);
  });

  test("si la lectura falló o Meta no lo expone, se dice por qué", () => {
    const error = topeDesdeLimite({ estado: "error", mensaje: "timeout de 8 s" });
    expect(error.estado === "sin-dato" ? error.motivo : "").toMatch(/timeout de 8 s/);

    expect(
      topeDesdeLimite({ estado: "no-expuesto", motivo: "Meta respondió sin el campo." }),
    ).toEqual({ estado: "sin-dato", motivo: "Meta respondió sin el campo." });
  });
});
