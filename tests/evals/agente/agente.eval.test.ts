import { createOpenAI } from "@ai-sdk/openai";
import { afterAll, describe, expect, test } from "vitest";
import { avisoSobremedida } from "@/lib/catalogo/sobremedida";
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
 *   EVAL_CONCURRENCIA     llamadas a OpenAI en paralelo (default 4). Bajarla si el
 *                         modelo tiene un TPM chico: con gpt-4.1 (30.000 TPM) 29 casos
 *                         a la vez dan 429 y la corrida mide el rate limit, no al agente.
 *
 * No entra en `npm test`: `vitest.config.ts` excluye `tests/evals/**` porque
 * cada corrida gasta plata y depende de la red.
 */

const apiKey = process.env["OPENAI_API_KEY"] ?? "";
const modelo = process.env["EVAL_AGENTE_MODELO"] || CONFIG_DE_FABRICA.modelo;
const repeticiones = Math.max(1, Number(process.env["EVAL_REPETICIONES"] ?? "1") || 1);
const umbral = Number(process.env["EVAL_UMBRAL"] ?? "1") || 1;
const filtro = process.env["EVAL_CASO"] ?? "";
const concurrencia = Math.max(1, Number(process.env["EVAL_CONCURRENCIA"] ?? "4") || 4);

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

/** Semáforo simple: a lo sumo `concurrencia` llamadas al modelo a la vez. */
let enVuelo = 0;
const cola: Array<() => void> = [];
async function conCupo<T>(f: () => Promise<T>): Promise<T> {
  if (enVuelo >= concurrencia) await new Promise<void>((ok) => cola.push(ok));
  enVuelo += 1;
  try {
    return await f();
  } finally {
    enVuelo -= 1;
    cola.shift()?.();
  }
}

const esRateLimit = (e: unknown): boolean =>
  /rate limit|429|too many requests/i.test(e instanceof Error ? e.message : String(e));

/** Reintenta los 429 con espera: un rate limit no es una falla del agente. */
async function generarConReintento(agente: OpenAiAgentLLM, input: AgentLLMInput): Promise<string> {
  for (let intento = 1; ; intento++) {
    try {
      return (await agente.generate(input)).text;
    } catch (e) {
      if (!esRateLimit(e) || intento >= 6) throw e;
      await new Promise((ok) => setTimeout(ok, 10_000 * intento));
    }
  }
}

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
        // El aviso lo calcula la misma función de producción sobre el catálogo del caso.
        const aviso = avisoSobremedida(matches);
        // Mismo orden de claves que `DefaultCatalogMatcherService`: el aviso primero.
        return {
          ...(aviso ? { aviso } : {}),
          matches,
          count: matches.length,
          ...(caso.diferencias ? { diferencias: caso.diferencias } : {}),
        };
      },
    },
  };

  let texto = "";
  const fallas: string[] = [];
  try {
    texto = await generarConReintento(agente, input);
  } catch (e) {
    fallas.push(
      `${esRateLimit(e) ? "INFRA (rate limit, no es el agente)" : "el agente tiró una excepción"}: ${e instanceof Error ? e.message : String(e)}`,
    );
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
        for (let i = 0; i < repeticiones; i++) corridas.push(await conCupo(() => correr(caso)));
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
