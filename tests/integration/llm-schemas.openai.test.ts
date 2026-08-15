import { describe, expect, test } from "vitest";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { InMemoryCostTracker } from "@/lib/observability/cost-tracker";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import { makeLlmFactory } from "@/server/services/llm/llm-factory";
import { OPENAI_PRICING } from "@/server/services/llm/pricing";
import type { TwinExtractorLLMInput } from "@/server/services/twin-extractor.service";

/**
 * Contrato schemas Zod ↔ Structured Outputs de OpenAI.
 *
 * Existe por un bug real: `update-lead-twin` falló en TODAS sus ejecuciones
 * desde Slice 1 hasta el 2026-08-07 porque `LeadTwinUpdateSchema` compila a un
 * JSON Schema que la API rechaza (`format: uri`, `propertyNames`, y campos
 * ausentes de `required`). Los tests unitarios de los impls usan
 * `MockLanguageModelV3`, que acepta cualquier schema — el mock no puede detectar
 * incompatibilidades con la API. Solo una llamada real las ve.
 *
 * Qué cubre: que cada `generateObject` del CRM sea aceptado por OpenAI con la
 * config de producción (ver `structured-output.ts`). Rompe si alguien agrega un
 * `.url()`, un `z.record()` o cambia providerOptions sin verificar.
 *
 * Qué NO cubre: la calidad de la respuesta. Solo que el request no sea rechazado
 * y que el resultado pase la validación Zod.
 *
 * Costo: 3 llamadas mínimas a gpt-4o-mini (~$0.00002 la corrida completa).
 */

const apiKey = process.env["OPENAI_API_KEY"] ?? "";
const suite = apiKey ? describe : describe.skip;

function makeBundle() {
  return makeLlmFactory({
    mode: "real",
    openaiApiKey: apiKey,
    costTracker: new InMemoryCostTracker({ pricing: OPENAI_PRICING, dailyCapUsd: 1 }),
    // Desde G1 el agente lee su modelo y su prompt de `agente_config` en cada
    // turno, y la factory exige el provider. Acá no se está probando la config
    // sino la forma del schema, así que alcanza con la de fábrica —sin esto la
    // suite entera tira ValidationError antes de llegar a OpenAI, que es como
    // estuvo desde que G1 entró: rota y sin que nadie la corriera.
    configProvider: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
  });
}

const SESSION_SNAPSHOT = {
  id: "00000000-0000-0000-0000-000000000001",
  current_stage: "nuevo",
  urgencia: "media",
  consulta: null,
  codigo_interno: null,
  precio_cotizado: null,
  cantidad: null,
  bloqueador: null,
  comprobante_pago_url: null,
  metodo_pago: null,
  resultado: null,
  motivo_perdida: null,
  extras: {},
} as unknown as TwinExtractorLLMInput["current"];

suite("schemas LLM aceptados por OpenAI (integration)", () => {
  test("LeadTwinUpdateSchema — generateObject no es rechazado", async () => {
    const result = await makeBundle().twinExtractor.extract({
      current: SESSION_SNAPSHOT,
      conversationTurn: [
        "lead: hola, necesito pastillas de freno para un Corolla 2015",
        "agente: te cotizo, son 45 dolares el juego delantero",
      ],
    });

    expect(result).toBeTypeOf("object");
    expect(result).not.toBeNull();
  });

  // Este sí mira el contenido, a diferencia del resto de la suite. Se justifica
  // porque el campo es nuevo y porque el modo de falla que cubre es silencioso:
  // un `vehiculo` que el modelo nunca devuelve no rompe nada, no loguea nada, y
  // el Twin del lead simplemente se queda sin auto para siempre. El caso es
  // inequívoco a propósito —"un Corolla 2015" no admite otra lectura—; si algún
  // día falla, es señal de que el prompt dejó de pedirlo.
  test("el vehículo del que habla el cliente vuelve en el patch", async () => {
    const result = await makeBundle().twinExtractor.extract({
      current: SESSION_SNAPSHOT,
      conversationTurn: [
        "lead: hola, necesito pastillas de freno para un Corolla 2015",
        "agente: te cotizo, son 45 dolares el juego delantero",
      ],
    });

    expect(result.vehiculo?.modelo?.toLowerCase()).toContain("corolla");
    expect(result.vehiculo?.anio).toBe(2015);
    // Placa y VIN no existen en el schema: los carga una persona.
    expect(result.vehiculo).not.toHaveProperty("placa");
  });

  test("IntentClassificationSchema — generateObject no es rechazado", async () => {
    const result = await makeBundle().intentClassifier.classify({
      text: "cuanto sale el filtro de aceite?",
      candidates: [
        {
          nombre: "consulta_precio",
          descripcion: "El lead pregunta el precio de un repuesto",
          ejemplos: ["cuanto cuesta", "que precio tiene"],
        },
      ],
    });

    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  test("DetectedIntentsWrapperSchema — generateObject no es rechazado", async () => {
    const result = await makeBundle().intentBatchDetector.detect({
      sessions: [
        {
          sessionId: "00000000-0000-0000-0000-000000000001",
          leadId: "00000000-0000-0000-0000-0000000000a1",
          messages: ["tienen filtro de aceite para Hilux?", "si, en stock"],
        },
        {
          sessionId: "00000000-0000-0000-0000-000000000002",
          leadId: "00000000-0000-0000-0000-0000000000a2",
          messages: ["tienen filtro de aire para Ranger?", "si, llega el martes"],
        },
      ],
    });

    expect(Array.isArray(result)).toBe(true);
  });
});
