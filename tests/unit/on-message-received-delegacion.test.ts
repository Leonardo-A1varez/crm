import { describe, expect, test, vi } from "vitest";
import { InMemoryRuleExecutionsRepository } from "@/server/repositories/rule-executions.repo";
import { InMemoryTurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemoryLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.repo";
import { InMemoryDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import { InMemoryReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { DefaultIntentClassifierService } from "@/server/services/intent-classifier.service";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { DefaultAiAgentService } from "@/server/services/ai-agent.service";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import {
  onMessageReceivedHandler,
  type EmittedEvent,
  type OnMessageReceivedDeps,
} from "@/inngest/functions/on-message-received";
import type { DelegacionActiva } from "@/server/repositories/workflow-runs.repo";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import { FakeAgentLLM, FakeIntentClassifierLLM } from "../mocks/llm";
import { FakeMetaApiClient } from "../mocks/meta";

/**
 * "Delegar al agente" visto desde el pipeline: mientras un flujo le delegó la
 * conversación, el agente contesta con las instrucciones del tramo en su
 * prompt y cada turno se avisa con `workflow/delegacion.turno`. El flujo no
 * contesta: la única respuesta al cliente es la del agente.
 */

type TurnoEmitido = Extract<EmittedEvent, { name: "workflow/delegacion.turno" }>;

function parsed(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    canal: "wa",
    canal_thread_id: "5491122334455",
    meta_user_id: "5491122334455",
    meta_message_id: "wamid.IN-1",
    tipo: "text",
    contenido: "necesito pastillas de freno",
    media_url: null,
    nombre_perfil: "Ana",
    raw: { type: "text" },
    ...overrides,
  };
}

function makeDeps(activas: DelegacionActiva[]) {
  const conversations = new InMemoryConversationsRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const messages = new InMemoryMessagesRepository();
  const intents = new InMemoryIntentsRepository();
  const intentLLM = new FakeIntentClassifierLLM();
  const agentLLM = new FakeAgentLLM();
  const reglasEtiqueta = new InMemoryReglasEtiquetaRepository();
  const ruleEngine = new DefaultRuleEngineService(
    intents,
    new InMemoryRulesRepository(),
    reglasEtiqueta,
  );
  const aiAgent = new DefaultAiAgentService(
    sessions,
    ruleEngine,
    new DefaultCatalogMatcherService(new InMemoryProductsRepository()),
    agentLLM,
  );
  const delegacionesActivas = vi.fn(async () => activas);
  const emitted: EmittedEvent[] = [];
  const deps: OnMessageReceivedDeps = {
    leads: new InMemoryLeadsRepository(),
    conversations,
    sessions,
    messages,
    metaApi: new DefaultMetaApiService(conversations, messages, new FakeMetaApiClient()),
    intentClassifier: new DefaultIntentClassifierService(intents, intentLLM),
    aiAgent,
    ruleExecutions: new InMemoryRuleExecutionsRepository(),
    turnClassifications: new InMemoryTurnClassificationsRepository(),
    ruleEngine,
    tags: new InMemoryTagsRepository(),
    intents,
    identificadores: new InMemoryLeadIdentificadoresRepository(),
    supresiones: new InMemoryDifusionSupresionesRepository(),
    respuestaDifusion: { registrar: async () => null },
    plantillasSinSesion: { registrar: async () => 0 },
    delegaciones: { delegacionesActivas },
    configProvider: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
    emit: async (e) => {
      emitted.push(e);
    },
  };
  return { deps, emitted, intentLLM, agentLLM, intents, messages, delegacionesActivas };
}

const turnos = (emitted: EmittedEvent[]) =>
  emitted.filter((e): e is TurnoEmitido => e.name === "workflow/delegacion.turno");

async function conIntent(ctx: ReturnType<typeof makeDeps>) {
  const intent = await ctx.intents.create({
    nombre: "cotizar",
    descripcion: "pide precio",
    ejemplos: [],
    auto_detectado: false,
    activo: true,
  });
  ctx.intentLLM.enqueue({ intent_nombre: "cotizar", confidence: 0.9 });
  return intent;
}

describe("on-message-received — Delegar al agente", () => {
  test("sin delegación activa no avisa nada y el prompt no cambia", async () => {
    const ctx = makeDeps([]);
    await conIntent(ctx);
    ctx.agentLLM.enqueueText("Hola");
    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);
    expect(turnos(ctx.emitted)).toHaveLength(0);
    expect(ctx.agentLLM.calls[0]?.instruccionesTramo).toBeUndefined();
  });

  test("con delegación: el agente contesta con las instrucciones del tramo y el turno se avisa", async () => {
    const ctx = makeDeps([
      { runId: "run-1", instrucciones: "Pedí el año antes de cotizar." },
      { runId: "run-2", instrucciones: null },
    ]);
    const intent = await conIntent(ctx);
    ctx.agentLLM.enqueueText("¿De qué año es tu auto?");
    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.agentLLM.calls[0]?.instruccionesTramo).toEqual(["Pedí el año antes de cotizar."]);
    // El flujo no contesta: una sola respuesta al cliente, la del agente.
    const salientes = (await ctx.messages.listByConversacion(r.conversacionId)).filter(
      (m) => m.direction === "out",
    );
    expect(salientes).toHaveLength(1);

    // El turno lo avisa el extractor cuando termina (`update-lead-twin`): así
    // la condición del Twin ve el dato de este turno y hay un solo aviso.
    expect(turnos(ctx.emitted)).toEqual([]);
    const completado = ctx.emitted.find((e) => e.name === "lead-session/turn.completed");
    expect(completado?.data).toMatchObject({
      delegacion: { runIds: ["run-1", "run-2"], intentId: intent.id, respondio: true },
    });
  });

  test("una baja durante el tramo se avisa y el agente no contesta", async () => {
    const ctx = makeDeps([{ runId: "run-1", instrucciones: null }]);
    await onMessageReceivedHandler({ parsed: parsed({ contenido: "BAJA" }) }, ctx.deps);
    expect(ctx.agentLLM.calls).toHaveLength(0);
    expect(turnos(ctx.emitted).map((e) => e.data.tipo)).toEqual(["baja"]);
  });

  test("si el turno del agente falla, el tramo se entera por Error", async () => {
    const ctx = makeDeps([{ runId: "run-1", instrucciones: null }]);
    await conIntent(ctx);
    ctx.agentLLM.enqueue(async () => {
      throw new Error("OpenAI caído");
    });
    await expect(onMessageReceivedHandler({ parsed: parsed() }, ctx.deps)).rejects.toThrow(
      "OpenAI caído",
    );
    expect(turnos(ctx.emitted)).toMatchObject([
      {
        id: expect.stringMatching(/^delegacion-error:/),
        data: { tipo: "error", runIds: ["run-1"] },
      },
    ]);
  });
});
