import { readFileSync } from "node:fs";
import path from "node:path";
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

/**
 * `stageColor` solo mapea etapa -> nombre de token; los hex reales viven en
 * `globals.css` (`:root` claro, `.dark` oscuro) y ningún test los tocaba desde
 * que Task 4 del tema claro/oscuro reescribió las aserciones de hex literal a
 * nombre de token. Eso hizo dos cosas invisibles: (1) nada pinneaba los ocho
 * hex de `.dark` contra la fidelidad del handoff original — podían cambiar
 * sin que ningún test lo notara; (2) "ninguna etapa comparte token" pasó a
 * probar que se tipearon ocho strings distintos, no que resuelven a ocho
 * colores distintos — dos tokens con el mismo hex en `globals.css` seguirían
 * siendo "distintos" para ese test. Leer el CSS acá es legítimo: ese archivo
 * es la fuente de verdad de estos valores, no un detalle de implementación.
 */
function leerStageTokens(bloque: "root" | "dark"): Record<string, string> {
  const css = readFileSync(path.resolve(__dirname, "../../../src/app/globals.css"), "utf-8");
  const inicio = bloque === "root" ? css.indexOf("\n:root {") : css.indexOf("\n.dark {");
  const fin = css.indexOf("\n}", inicio);
  const bloqueCss = css.slice(inicio, fin);

  const tokens: Record<string, string> = {};
  const regex = /--(stage-[a-z-]+):\s*(#[0-9a-fA-F]{6});/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(bloqueCss)) !== null) {
    const nombre = m[1];
    const valor = m[2];
    if (nombre && valor) tokens[nombre] = valor;
  }
  return tokens;
}

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

describe("valores de --stage-* en globals.css", () => {
  test("oscuro coincide exactamente con la fidelidad del handoff original", () => {
    const dark = leerStageTokens("dark");
    expect(dark).toEqual({
      "stage-nuevo": "#38bdf8",
      "stage-identificando": "#818cf8",
      "stage-cotizado": "#a78bfa",
      "stage-negociando": "#fbbf24",
      "stage-esperando-pago": "#fb923c",
      "stage-cerrado": "#34d399",
      "stage-perdido": "#f87171",
      "stage-requiere-humano": "#e879f9",
    });
  });

  test("claro define las 8 y ninguna resuelve al mismo hex que otra", () => {
    const light = leerStageTokens("root");
    expect(Object.keys(light).sort()).toEqual(
      [
        "stage-nuevo",
        "stage-identificando",
        "stage-cotizado",
        "stage-negociando",
        "stage-esperando-pago",
        "stage-cerrado",
        "stage-perdido",
        "stage-requiere-humano",
      ].sort(),
    );
    expect(new Set(Object.values(light)).size).toBe(Object.values(light).length);
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
