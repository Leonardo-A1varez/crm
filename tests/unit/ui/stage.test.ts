import { describe, expect, test } from "vitest";
import { CURRENT_STAGE } from "@/types/domain";
import {
  esEtapaEmbudo,
  etapaAlcanzada,
  FUNNEL_LENGTH,
  FUNNEL_STAGES,
  funnelStep,
  isDetour,
  stageBadgeBackground,
  stageColor,
  stageLabel,
} from "@/lib/ui/stage";

describe("stageColor", () => {
  test("las 8 etapas tienen color hex de 6 digitos", () => {
    for (const stage of CURRENT_STAGE) {
      expect(stageColor(stage)).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  test("los colores del handoff son exactos", () => {
    expect(stageColor("nuevo")).toBe("#38BDF8");
    expect(stageColor("identificando")).toBe("#818CF8");
    expect(stageColor("cotizado")).toBe("#A78BFA");
    expect(stageColor("negociando")).toBe("#FBBF24");
    expect(stageColor("esperando_pago")).toBe("#FB923C");
    expect(stageColor("cerrado")).toBe("#34D399");
    expect(stageColor("perdido")).toBe("#F87171");
    expect(stageColor("requiere_humano")).toBe("#E879F9");
  });

  test("ninguna etapa comparte color con otra", () => {
    const colores = CURRENT_STAGE.map(stageColor);
    expect(new Set(colores).size).toBe(CURRENT_STAGE.length);
  });
});

describe("stageLabel", () => {
  test("las 8 etapas tienen label no vacio", () => {
    for (const stage of CURRENT_STAGE) {
      expect(stageLabel(stage).length).toBeGreaterThan(0);
    }
  });

  test("los slugs con guion bajo se muestran con espacio", () => {
    expect(stageLabel("esperando_pago")).toBe("Esperando pago");
    expect(stageLabel("requiere_humano")).toBe("Requiere humano");
  });
});

describe("stageBadgeBackground", () => {
  test("es el color de la etapa al 13% de alpha", () => {
    expect(stageBadgeBackground("cerrado")).toBe("#34D39921");
  });

  test("aplica a las 8 etapas", () => {
    for (const stage of CURRENT_STAGE) {
      expect(stageBadgeBackground(stage)).toBe(`${stageColor(stage)}21`);
    }
  });
});

describe("embudo", () => {
  test("el embudo son 6 etapas, no 8", () => {
    expect(FUNNEL_LENGTH).toBe(6);
    expect(FUNNEL_STAGES).toEqual([
      "nuevo",
      "identificando",
      "cotizado",
      "negociando",
      "esperando_pago",
      "cerrado",
    ]);
  });

  test("perdido y requiere_humano son desvios, no pasos 7 y 8", () => {
    expect(isDetour("perdido")).toBe(true);
    expect(isDetour("requiere_humano")).toBe(true);
    expect(funnelStep("perdido")).toBeNull();
    expect(funnelStep("requiere_humano")).toBeNull();
  });

  test("las 6 del embudo no son desvio y numeran 1..6 en orden", () => {
    expect(FUNNEL_STAGES.map(funnelStep)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const stage of FUNNEL_STAGES) {
      expect(isDetour(stage)).toBe(false);
    }
  });

  test("toda etapa es o paso del embudo o desvio, nunca ambos ni ninguno", () => {
    for (const stage of CURRENT_STAGE) {
      expect(isDetour(stage)).toBe(funnelStep(stage) === null);
    }
  });

  test("esEtapaEmbudo es la negacion exacta de isDetour", () => {
    for (const stage of CURRENT_STAGE) {
      expect(esEtapaEmbudo(stage)).toBe(!isDetour(stage));
    }
  });
});

describe("etapaAlcanzada", () => {
  test("avanzar dentro del embudo mueve el maximo", () => {
    expect(etapaAlcanzada("nuevo", "cotizado")).toBe("cotizado");
    expect(etapaAlcanzada("cotizado", "cerrado")).toBe("cerrado");
  });

  test("retroceder no borra por donde ya paso", () => {
    // El extractor puede devolver una etapa mas atras en un turno confuso; el
    // rail del Twin no puede desandar por eso.
    expect(etapaAlcanzada("cotizado", "identificando")).toBe("cotizado");
    expect(etapaAlcanzada("cerrado", "nuevo")).toBe("cerrado");
  });

  test("un desvio no avanza nada: congela lo alcanzado", () => {
    expect(etapaAlcanzada("identificando", "perdido")).toBe("identificando");
    expect(etapaAlcanzada("negociando", "requiere_humano")).toBe("negociando");
  });

  test("nunca devuelve un desvio, sea cual sea la entrada", () => {
    for (const stage of CURRENT_STAGE) {
      expect(isDetour(etapaAlcanzada("nuevo", stage))).toBe(false);
    }
  });
});
