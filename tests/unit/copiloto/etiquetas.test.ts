import { describe, expect, test } from "vitest";
import {
  etiquetaModo,
  etiquetaOpcionModo,
  etiquetaUso,
  mensajeDeErrorBorrador,
} from "@/lib/copiloto/etiquetas";

describe("etiquetaModo", () => {
  test("nombra los tres resultados de §3.2", () => {
    expect(etiquetaModo("copiloto")).toBe("Copiloto");
    expect(etiquetaModo("automatico")).toBe("Automático");
    expect(etiquetaModo("fuera_de_horario")).toBe("Fuera de horario");
  });
});

describe("etiquetaOpcionModo", () => {
  test("'Según horario' muestra el modo efectivo: «Según horario · ahora Copiloto»", () => {
    expect(etiquetaOpcionModo("segun_horario", "copiloto")).toBe("Según horario · ahora Copiloto");
    expect(etiquetaOpcionModo("segun_horario", "fuera_de_horario")).toBe(
      "Según horario · ahora Fuera de horario",
    );
  });

  test("los fijos no dependen del horario", () => {
    expect(etiquetaOpcionModo("copiloto", "automatico")).toBe("Copiloto");
    expect(etiquetaOpcionModo("automatico", "copiloto")).toBe("Automático");
  });
});

describe("mensajeDeErrorBorrador", () => {
  test("traduce cada código a una frase accionable", () => {
    expect(mensajeDeErrorBorrador("llm_error")).toMatch(/No se pudo redactar/);
    expect(mensajeDeErrorBorrador("tope_diario")).toMatch(/tope de gasto diario/);
    expect(mensajeDeErrorBorrador("descuento_excedido")).toMatch(/descuento/);
    expect(mensajeDeErrorBorrador("ia_no_disponible")).toMatch(/pausada o escalada/);
    expect(mensajeDeErrorBorrador("escalado")).toBe(
      "La conversación está escalada a una persona: la IA no redacta.",
    );
  });

  test("un nombre del prototipo no resuelve a una función", () => {
    expect(mensajeDeErrorBorrador("constructor")).toBe("No se pudo redactar. Reintentá.");
    expect(mensajeDeErrorBorrador("toString")).toBe("No se pudo redactar. Reintentá.");
  });

  test("un código desconocido o ausente no muestra el código crudo", () => {
    expect(mensajeDeErrorBorrador("algo_nuevo")).toBe("No se pudo redactar. Reintentá.");
    expect(mensajeDeErrorBorrador(null)).toBe("No se pudo redactar. Reintentá.");
  });
});

describe("etiquetaUso", () => {
  test("dice cómo se usó, en la voz de la tarjeta", () => {
    expect(etiquetaUso("insertar")).toBe("Ya usado · insertado en WhatsApp");
    expect(etiquetaUso("copiar")).toBe("Ya usado · copiado");
    expect(etiquetaUso("abrir_web")).toBe("Ya usado · abierto en WhatsApp Web");
    expect(etiquetaUso("al_composer")).toBe("Ya usado · enviado desde el CRM");
    expect(etiquetaUso(null)).toBe("Ya usado");
  });
});
