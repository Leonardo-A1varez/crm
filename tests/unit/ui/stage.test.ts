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
  test("las 8 etapas resuelven a un token CSS var(--stage-...)", () => {
    for (const stage of CURRENT_STAGE) {
      expect(stageColor(stage)).toMatch(/^var\(--stage-[a-z-]+\)$/);
    }
  });

  test("cada etapa apunta a su propio token: el color vive en el tema, no acá", () => {
    // El valor hex real está en globals.css (:root claro, .dark oscuro) — este
    // módulo solo referencia el token correcto por etapa, para que el tema
    // claro/oscuro pueda tener valores distintos sin tocar este archivo.
    expect(stageColor("nuevo")).toBe("var(--stage-nuevo)");
    expect(stageColor("identificando")).toBe("var(--stage-identificando)");
    expect(stageColor("cotizado")).toBe("var(--stage-cotizado)");
    expect(stageColor("negociando")).toBe("var(--stage-negociando)");
    expect(stageColor("esperando_pago")).toBe("var(--stage-esperando-pago)");
    expect(stageColor("cerrado")).toBe("var(--stage-cerrado)");
    expect(stageColor("perdido")).toBe("var(--stage-perdido)");
    expect(stageColor("requiere_humano")).toBe("var(--stage-requiere-humano)");
  });

  test("ninguna etapa comparte token con otra", () => {
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
  test("es el color de la etapa mezclado al 13% (alpha del handoff)", () => {
    expect(stageBadgeBackground("cerrado")).toBe(
      "color-mix(in srgb, var(--stage-cerrado) 13%, transparent)",
    );
  });

  test("aplica a las 8 etapas, mezclando el token de cada una", () => {
    for (const stage of CURRENT_STAGE) {
      expect(stageBadgeBackground(stage)).toBe(
        `color-mix(in srgb, ${stageColor(stage)} 13%, transparent)`,
      );
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
