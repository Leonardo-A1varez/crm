import { beforeEach, describe, expect, test, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { InMemoryCostTracker, type PricingTable } from "@/lib/observability/cost-tracker";
import { NoopLogger, type LogContext } from "@/lib/observability/logger";
import {
  InMemoryLlmUsageRepository,
  type LlmUsageInsert,
  type LlmUsageRepository,
  type ResumenGastoSesion,
} from "@/server/repositories/llm-usage.repo";
import { PersistingCostTracker } from "@/server/services/llm/persisting-cost-tracker";
import { WORKFLOW_LLM } from "@/types/domain";
import type { LlmUsage, UUID } from "@/types/entities";

const PRICING: PricingTable = {
  "gpt-4o-mini": { inputUsdPer1M: 0.15, outputUsdPer1M: 0.6 },
};

const SESION: UUID = "11111111-1111-4111-8111-111111111111";
const MENSAJE: UUID = "22222222-2222-4222-8222-222222222222";

function makeTracker(repo: LlmUsageRepository, logger = new NoopLogger()) {
  return new PersistingCostTracker({
    inner: new InMemoryCostTracker({
      pricing: PRICING,
      dailyCapUsd: 10,
      now: () => new Date("2026-08-10T12:00:00.000Z"),
    }),
    repo,
    pricing: PRICING,
    logger,
  });
}

describe("PersistingCostTracker", () => {
  let repo: InMemoryLlmUsageRepository;
  let tracker: PersistingCostTracker;

  beforeEach(() => {
    repo = new InMemoryLlmUsageRepository();
    tracker = makeTracker(repo);
  });

  test("deja una fila por llamada con sesión, mensaje, modelo, tokens y workflow", async () => {
    await tracker.record({
      model: "gpt-4o-mini",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      sessionId: SESION,
      mensajeId: MENSAJE,
      workflow: WORKFLOW_LLM.agente,
    });

    const filas = await repo.listDesde(new Date(0));
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      lead_session_id: SESION,
      mensaje_id: MENSAJE,
      modelo: "gpt-4o-mini",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      workflow: WORKFLOW_LLM.agente,
    });
    // El mismo número que cuenta el contador de adentro: si cada uno calculara
    // por su lado, el total del día y la suma de las filas se separarían.
    expect(filas[0]?.costo_usd).toBeCloseTo(0.75, 10);
    expect(await tracker.getDailySpendUsd()).toBeCloseTo(0.75, 10);
  });

  test("la fila queda consultable por sesión: es el gasto que muestra el Twin", async () => {
    const uso = {
      model: "gpt-4o-mini",
      inputTokens: 1_000_000,
      outputTokens: 0,
      sessionId: SESION,
      workflow: WORKFLOW_LLM.agente,
    };
    await tracker.record(uso);
    await tracker.record({ ...uso, workflow: WORKFLOW_LLM.clasificador });

    expect(await repo.resumenPorLeadSession(SESION)).toEqual({ usd: 0.3, llamadas: 2 });
  });

  test("una llamada sin sesión —el detector batch— se anota igual, sin dueño", async () => {
    await tracker.record({
      model: "gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 0,
      workflow: WORKFLOW_LLM.detectorBatch,
    });

    const filas = await repo.listDesde(new Date(0));
    expect(filas[0]?.lead_session_id).toBeNull();
    expect(filas[0]?.mensaje_id).toBeNull();
  });

  test("sin workflow la fila no queda anónima: se marca como desconocido", async () => {
    await tracker.record({ model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 0 });

    const filas = await repo.listDesde(new Date(0));
    expect(filas[0]?.workflow).toBe("desconocido");
  });

  test("un modelo sin pricing corta antes de escribir: no se inventa un costo", async () => {
    await expect(
      tracker.record({ model: "modelo-fantasma", inputTokens: 10, outputTokens: 10 }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(await repo.listDesde(new Date(0))).toEqual([]);
  });

  test("si la fila de auditoría falla, el turno sigue: ya se pagó la llamada", async () => {
    const errores: { msg: string; ctx?: LogContext }[] = [];
    const logger = new NoopLogger();
    vi.spyOn(logger, "error").mockImplementation((msg: string, ctx?: LogContext) => {
      errores.push({ msg, ctx });
    });

    const roto: LlmUsageRepository = {
      async create(_input: LlmUsageInsert): Promise<LlmUsage> {
        throw new Error("PostgREST caído");
      },
      async resumenPorLeadSession(_id: UUID): Promise<ResumenGastoSesion> {
        return { usd: 0, llamadas: 0 };
      },
      async primerRegistroAt(): Promise<Date | null> {
        return null;
      },
      async listByMensajeId(_mensajeId: UUID): Promise<LlmUsage[]> {
        return [];
      },
      async listDesde(_desde: Date): Promise<LlmUsage[]> {
        return [];
      },
    };
    const conRepoRoto = makeTracker(roto, logger);

    await expect(
      conRepoRoto.record({
        model: "gpt-4o-mini",
        inputTokens: 1_000_000,
        outputTokens: 0,
        sessionId: SESION,
        workflow: WORKFLOW_LLM.agente,
      }),
    ).resolves.toBeUndefined();

    // El costo del turno igual quedó en el contador del día, que es el que
    // sostiene el corte por tope.
    expect(await conRepoRoto.getDailySpendUsd()).toBeCloseTo(0.15, 10);
    expect(errores).toHaveLength(1);
    expect(errores[0]?.msg).toBe("llm_usage.persistencia_fallida");
    // Sin PII: solo workflow, modelo y el error. Nada del contenido del mensaje.
    expect(Object.keys(errores[0]?.ctx ?? {}).sort()).toEqual([
      "error_message",
      "error_name",
      "modelo",
      "workflow",
    ]);
  });

  test("el kill switch lo sigue resolviendo el contador de adentro", async () => {
    expect(await tracker.exceedsCap()).toBe(false);

    await tracker.record({
      model: "gpt-4o-mini",
      inputTokens: 100_000_000,
      outputTokens: 0,
      workflow: WORKFLOW_LLM.agente,
    });

    expect(await tracker.exceedsCap()).toBe(true);
  });
});
