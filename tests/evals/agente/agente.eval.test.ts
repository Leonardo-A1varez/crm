import { createOpenAI } from "@ai-sdk/openai";
import { afterAll, describe, expect, test } from "vitest";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { InMemoryCostTracker } from "@/lib/observability/cost-tracker";
import type { BuscarRepuestoOutput } from "@/lib/validation/ai";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import type { AgentLLMInput } from "@/server/services/ai-agent.service";
import { OpenAiAgentLLM } from "@/server/services/llm/openai-ai-agent";
import { OPENAI_PRICING } from "@/server/services/llm/pricing";
import type { LeadSession } from "@/types/entities";
import { CASOS, type BusquedaHecha, type CasoAgente } from "./casos";

/**
 * Eval de comportamiento del agente vendedor contra OpenAI REAL.
 *
 *   npm run test:eval:agente
 *
 * Existe porque cada regresión del agente la encontró el dueño por WhatsApp.
 * Los tests unitarios usan `MockLanguageModelV3`, que contesta lo que se le
 * programe: no puede decir si el prompt real hace que el modelo real busque con
 * el año correcto. Esto sí.
 *
 * Variables:
 *   OPENAI_API_KEY        obligatoria (sin ella la suite se saltea y lo dice).
 *   EVAL_AGENTE_MODELO    modelo del agente; default el de CONFIG_DE_FABRICA.
 *   EVAL_REPETICIONES     veces que se corre cada caso (default 1). El modelo no
 *                         es determinista: con N > 1 se informa la tasa de aciertos.
 *   EVAL_UMBRAL           fracción de repeticiones que tiene que pasar para dar
 *                         el caso por bueno (default 1 = todas).
 *   EVAL_CASO             filtro por id (substring) para correr solo algunos.
 *
 * No entra en `npm test`: `vitest.config.ts` excluye `tests/evals/**` porque
 * cada corrida gasta plata y depende de la red.
 */

const apiKey = process.env["OPENAI_API_KEY"] ?? "";
const modelo = process.env["EVAL_AGENTE_MODELO"] || CONFIG_DE_FABRICA.modelo;
const repeticiones = Math.max(1, Number(process.env["EVAL_REPETICIONES"] ?? "1") || 1);
const umbral = Number(process.env["EVAL_UMBRAL"] ?? "1") || 1;
const filtro = process.env["EVAL_CASO"] ?? "";

if (!apiKey) {
  console.warn(
    "[eval-agente] OPENAI_API_KEY ausente: el eval se saltea. Cargala en .env.local (o en el .env.local de la raíz del repo si estás en un worktree).",
  );
}
if (apiKey && !(modelo in OPENAI_PRICING)) {
  throw new Error(
    `EVAL_AGENTE_MODELO=${modelo} no tiene pricing en OPENAI_PRICING; modelos válidos: ${Object.keys(OPENAI_PRICING).join(", ")}`,
  );
}

const suite = apiKey ? describe : describe.skip;

const SESION_BASE: LeadSession = {
  id: "00000000-0000-4000-8000-0000000000aa",
  lead_id: "00000000-0000-4000-8000-0000000000bb",
  current_stage: "nuevo",
  etapa_alcanzada: "nuevo",
  urgencia: "media",
  consulta: "",
  producto_cotizado_id: null,
  codigo_interno: null,
  precio_cotizado: null,
  cantidad: null,
  bloqueador: null,
  comprobante_pago_url: null,
  metodo_pago: null,
  resultado: null,
  motivo_perdida: null,
  ia_pausada: false,
  extras: {},
  context_summary: null,
  procedencia: {},
  started_at: new Date("2026-10-01T12:00:00Z"),
  updated_at: new Date("2026-10-01T12:00:00Z"),
  closed_at: null,
} as LeadSession;

interface Corrida {
  ok: boolean;
  fallas: string[];
  costoUsd: number;
}

const resumen = new Map<string, { caso: CasoAgente; corridas: Corrida[] }>();

async function correr(caso: CasoAgente): Promise<Corrida> {
  const costTracker = new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 1000 });
  const agente = new OpenAiAgentLLM({
    provider: createOpenAI({ apiKey }),
    configProvider: new StaticAgentConfigProvider({ ...CONFIG_DE_FABRICA, modelo }),
    costTracker,
    workflow: "eval-agente",
  });

  const busquedas: BusquedaHecha[] = [];
  const input: AgentLLMInput = {
    session: { ...SESION_BASE, consulta: caso.consultaPrevia ?? "" },
    conversationTurn: caso.turno,
    classification: { intent_nombre: null, confidence: 0 },
    ...(caso.vehiculos ? { vehiculos: caso.vehiculos } : {}),
    tools: {
      // Stub determinista: cualquier búsqueda devuelve el catálogo del caso.
      buscar_repuesto: async (args): Promise<BuscarRepuestoOutput> => {
        const matches = caso.catalogo;
        busquedas.push({ args, matches });
        return { matches, count: matches.length };
      },
    },
  };

  let texto = "";
  const fallas: string[] = [];
  try {
    texto = (await agente.generate(input)).text;
  } catch (e) {
    fallas.push(`el agente tiró una excepción: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (fallas.length === 0) {
    for (const v of caso.verificaciones) {
      const motivo = v({ texto, busquedas, catalogo: caso.catalogo, turno: caso.turno });
      if (motivo) fallas.push(motivo);
    }
    if (fallas.length > 0) {
      fallas.push(
        `respuesta: «${texto}» | búsquedas: ${JSON.stringify(busquedas.map((b) => b.args))}`,
      );
    }
  }

  return { ok: fallas.length === 0, fallas, costoUsd: await costTracker.getDailySpendUsd() };
}

suite(`eval agente vendedor (modelo ${modelo}, ${repeticiones} repetición/es)`, () => {
  const casos = CASOS.filter((c) => c.id.includes(filtro));

  test("los ids de caso son únicos", () => {
    const ids = CASOS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const caso of casos) {
    test.concurrent(
      `[${caso.origen}] ${caso.id}`,
      async () => {
        const corridas: Corrida[] = [];
        for (let i = 0; i < repeticiones; i++) corridas.push(await correr(caso));
        resumen.set(caso.id, { caso, corridas });

        const aciertos = corridas.filter((c) => c.ok).length;
        const tasa = aciertos / corridas.length;
        const detalle = corridas
          .map((c, i) => (c.ok ? null : `repetición ${i + 1}:\n  - ${c.fallas.join("\n  - ")}`))
          .filter((x) => x !== null)
          .join("\n");
        expect(
          tasa,
          `${caso.proposito}\naciertos ${aciertos}/${corridas.length}\n${detalle}`,
        ).toBeGreaterThanOrEqual(umbral);
      },
      180_000,
    );
  }

  afterAll(() => {
    const filas = [...resumen.values()];
    if (filas.length === 0) return;
    const total = filas.reduce((s, f) => s + f.corridas.reduce((a, c) => a + c.costoUsd, 0), 0);
    const lineas = filas
      .sort((a, b) => a.caso.id.localeCompare(b.caso.id))
      .map(({ caso, corridas }) => {
        const ok = corridas.filter((c) => c.ok).length;
        return `${ok === corridas.length ? "PASA " : "FALLA"} ${ok}/${corridas.length}  [${caso.origen.padEnd(9)}] ${caso.id}`;
      });
    const pasan = filas.filter(({ corridas }) => corridas.every((c) => c.ok)).length;
    console.info(
      [
        "",
        `── eval agente (${modelo}) ──`,
        ...lineas,
        `casos sin falla: ${pasan}/${filas.length}`,
        `costo total: US$ ${total.toFixed(5)}`,
        "",
      ].join("\n"),
    );
  });
});
