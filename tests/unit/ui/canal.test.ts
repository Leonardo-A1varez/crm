import { describe, expect, test } from "vitest";
import { CANAL } from "@/types/domain";
import { canalColor, canalesDeFila, canalesDelLead, canalLabel } from "@/lib/ui/canal";

describe("canalColor", () => {
  test("los colores de marca del handoff son exactos", () => {
    expect(canalColor("wa")).toBe("#25D366");
    expect(canalColor("ig")).toBe("#E1306C");
    expect(canalColor("fb")).toBe("#1877F2");
  });

  test("los 3 canales tienen color distinto", () => {
    const colores = CANAL.map(canalColor);
    expect(new Set(colores).size).toBe(CANAL.length);
  });
});

describe("canalLabel", () => {
  test("usa el nombre publico de cada plataforma", () => {
    expect(canalLabel("wa")).toBe("WhatsApp");
    expect(canalLabel("ig")).toBe("Instagram");
    expect(canalLabel("fb")).toBe("Messenger");
  });
});

describe("canalesDeFila", () => {
  test("el activo va primero: la fila no cambia de glifo líder sola", () => {
    expect(canalesDeFila(["wa", "ig", "fb"], "fb", true).canales).toEqual(["fb", "wa", "ig"]);
  });

  test("sin canal activo conserva el orden recibido", () => {
    expect(canalesDeFila(["ig", "wa"], null, true).canales).toEqual(["ig", "wa"]);
  });

  test("no repite el activo cuando ya viene en la lista", () => {
    const { canales } = canalesDeFila(["wa", "ig"], "wa", true);
    expect(canales).toEqual(["wa", "ig"]);
    expect(new Set(canales).size).toBe(canales.length);
  });

  test("un activo ausente de la lista igual encabeza la tira", () => {
    expect(canalesDeFila(["ig"], "wa", true).canales).toEqual(["wa", "ig"]);
  });

  test("el nombre del canal solo entra cuando hay uno solo", () => {
    // Con dos nombres al lado del glifo el nombre del lead queda en dos letras:
    // es la decisión de ancho que sostiene la fila de 322px.
    expect(canalesDeFila(["wa"], "wa", true).conEtiqueta).toBe(true);
    expect(canalesDeFila(["wa", "ig"], "wa", true).conEtiqueta).toBe(false);
  });

  test("quien no permite etiqueta nunca la recibe, ni con un solo canal", () => {
    expect(canalesDeFila(["wa"], "wa", false).conEtiqueta).toBe(false);
  });

  test("sin canales no hay nada que dibujar", () => {
    expect(canalesDeFila([], null, true).canales).toEqual([]);
  });

  test("no muta el array que recibe", () => {
    const original: (typeof CANAL)[number][] = ["wa", "ig"];
    canalesDeFila(original, "ig", true);
    expect(original).toEqual(["wa", "ig"]);
  });
});

describe("canalesDelLead", () => {
  test("el canal de origen está siempre, aunque no haya nada más", () => {
    expect(canalesDelLead({ canal_origen: "ig", meta_user_ids: {} })).toEqual(["ig"]);
  });

  test("suma los canales con id de Meta vinculado", () => {
    // El caso del dueño: WhatsApp e Instagram en el mismo lead.
    expect(canalesDelLead({ canal_origen: "wa", meta_user_ids: { ig: "ig-123" } })).toEqual([
      "wa",
      "ig",
    ]);
  });

  test("suma los canales con conversación aunque no tengan id de Meta", () => {
    expect(canalesDelLead({ canal_origen: "wa", meta_user_ids: {} }, ["fb"])).toEqual(["wa", "fb"]);
  });

  test("no repite: el mismo canal por las tres vías sigue siendo uno", () => {
    const canales = canalesDelLead({ canal_origen: "wa", meta_user_ids: { wa: "wa-1" } }, ["wa"]);
    expect(canales).toEqual(["wa"]);
  });

  test("el origen encabeza y el resto sigue el orden de CANAL: la tira no se reordena sola", () => {
    const canales = canalesDelLead({ canal_origen: "fb", meta_user_ids: { ig: "i", wa: "w" } }, [
      "ig",
    ]);
    expect(canales).toEqual(["fb", "wa", "ig"]);
  });

  test("un id de Meta vacío no cuenta como canal vinculado", () => {
    expect(canalesDelLead({ canal_origen: "wa", meta_user_ids: { ig: "" } })).toEqual(["wa"]);
  });
});
