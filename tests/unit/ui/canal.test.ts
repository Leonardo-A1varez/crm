import { describe, expect, test } from "vitest";
import { CANAL } from "@/types/domain";
import { canalColor, canalLabel } from "@/lib/ui/canal";

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
