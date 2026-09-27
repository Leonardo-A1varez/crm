import { describe, expect, test } from "vitest";
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
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import type {
  DecisionIntercepcion,
  InterceptorTurno,
} from "@/server/services/workflows/interceptor.service";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { autoHandoffHandler } from "@/inngest/functions/auto-handoff";
import {
  onMessageReceivedHandler,
  type EmittedEvent,
  type OnMessageReceivedDeps,
} from "@/inngest/functions/on-message-received";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import type { AgenteConfig } from "@/types/agente";
import { FakeAgentLLM, FakeIntentClassifierLLM } from "../mocks/llm";
import { FakeMetaApiClient } from "../mocks/meta";

/**
 * El escalado por intents desconocidos seguidos (§4.2) de punta a punta: el
 * pipeline arma el evento y `auto-handoff` decide con él. Los tests del
 * handler solo le pasaban arrays fabricados a mano, y el pipeline mandaba
 * siempre un único elemento: con el umbral de fábrica (2) no escalaba nunca.
 */

type EvalEvent = Extract<EmittedEvent, { name: "lead-session/auto-handoff.evaluate" }>;

let seq = 0;
function parsed(contenido: string): ParsedMessage {
  seq += 1;
  return {
    canal: "wa",
    canal_thread_id: "549110",
    meta_user_id: "549110",
    meta_message_id: `wamid.AH-${seq}`,
    tipo: "text",
    contenido,
    media_url: null,
    nombre_perfil: null,
    raw: { type: "text" },
  };
}

function makeCtx(config: Partial<AgenteConfig> = {}) {
  const sessions = new InMemoryLeadSessionRepository();
  const messages = new InMemoryMessagesRepository();
  const intents = new InMemoryIntentsRepository();
  const rules = new InMemoryRulesRepository();
  const conversations = new InMemoryConversationsRepository();
  const intentLLM = new FakeIntentClassifierLLM();
  const agentLLM = new FakeAgentLLM();
  const ruleEngine = new DefaultRuleEngineService(
    intents,
    rules,
    new InMemoryReglasEtiquetaRepository(),
  );
  const configProvider = new StaticAgentConfigProvider({ ...CONFIG_DE_FABRICA, ...config });
  const emitted: EmittedEvent[] = [];
  /** Qué mensajes (por contenido) intercepta un flujo. */
  const interceptados = new Set<string>();
  const interceptor: InterceptorTurno = {
    decidir: async (input): Promise<DecisionIntercepcion> =>
      interceptados.has(String(input.datos.texto ?? ""))
        ? { tipo: "intercepta", motivo: "condicion", workflowId: "wf-1", versionId: "v-1" }
        : { tipo: "no" },
    registrar: async () => {},
  };

  const deps: OnMessageReceivedDeps = {
    leads: new InMemoryLeadsRepository(),
    conversations,
    sessions,
    messages,
    metaApi: new DefaultMetaApiService(conversations, messages, new FakeMetaApiClient()),
    intentClassifier: new DefaultIntentClassifierService(intents, intentLLM),
    aiAgent: new DefaultAiAgentService(
      sessions,
      ruleEngine,
      new DefaultCatalogMatcherService(new InMemoryProductsRepository()),
      agentLLM,
    ),
    ruleExecutions: new InMemoryRuleExecutionsRepository(),
    turnClassifications: new InMemoryTurnClassificationsRepository(),
    ruleEngine,
    tags: new InMemoryTagsRepository(),
    intents,
    identificadores: new InMemoryLeadIdentificadoresRepository(),
    supresiones: new InMemoryDifusionSupresionesRepository(),
    respuestaDifusion: { registrar: async () => null },
    plantillasSinSesion: { registrar: async () => 0 },
    configProvider,
    interceptor,
    emit: async (e) => {
      emitted.push(e);
    },
  };
  const handoff = new DefaultHandoffService(sessions, configProvider);

  /** Un turno del lead: el clasificador devuelve `intent`, contesta el LLM. */
  async function turno(contenido: string, intent: string | null) {
    intentLLM.enqueue({ intent_nombre: intent, confidence: intent ? 0.9 : 0 });
    if (!interceptados.has(contenido)) agentLLM.enqueueText("respuesta");
    return onMessageReceivedHandler({ parsed: parsed(contenido) }, deps);
  }

  /** Lo que hace `auto-handoff` con el último evaluate que emitió el pipeline. */
  async function evaluarUltimo() {
    const evals = emitted.filter(
      (e): e is EvalEvent => e.name === "lead-session/auto-handoff.evaluate",
    );
    const ultimo = evals.at(-1);
    if (!ultimo) throw new Error("el pipeline no emitió auto-handoff.evaluate");
    return autoHandoffHandler(
      {
        leadSessionId: ultimo.data.leadSessionId,
        recentClassifications: ultimo.data.recentClassifications,
        threshold: (ultimo.data as { threshold?: number }).threshold,
      },
      { handoff },
    );
  }

  return { deps, sessions, intents, rules, handoff, interceptados, turno, evaluarUltimo };
}

describe("auto-handoff por intents desconocidos, desde el pipeline", () => {
  test("umbral 2: dos turnos seguidos sin intent escalan a humano", async () => {
    const ctx = makeCtx({ escalar_umbral_intents: 2 });

    await ctx.turno("asdf", null);
    expect((await ctx.evaluarUltimo()).paused).toBe(false);

    const out = await ctx.turno("qwer", null);
    const r = await ctx.evaluarUltimo();

    expect(r.paused).toBe(true);
    expect((await ctx.sessions.findById(out.sessionId))!.ia_pausada).toBe(true);
  });

  test("umbral 3: dos no alcanzan, el tercero escala", async () => {
    const ctx = makeCtx({ escalar_umbral_intents: 3 });

    await ctx.turno("a", null);
    await ctx.turno("b", null);
    expect((await ctx.evaluarUltimo()).paused).toBe(false);

    await ctx.turno("c", null);
    expect((await ctx.evaluarUltimo()).paused).toBe(true);
  });

  test("un turno con intent (contesta el LLM) reinicia la cuenta", async () => {
    const ctx = makeCtx({ escalar_umbral_intents: 2 });
    await ctx.intents.create({
      nombre: "saludo",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });

    await ctx.turno("a", null);
    await ctx.turno("hola", "saludo");
    await ctx.turno("b", null);

    expect((await ctx.evaluarUltimo()).paused).toBe(false);
  });

  test("un turno con intent que contesta una regla también reinicia la cuenta", async () => {
    const ctx = makeCtx({ escalar_umbral_intents: 2 });
    const intent = await ctx.intents.create({
      nombre: "saludo",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    await ctx.rules.create({
      intent_id: intent.id,
      condiciones_extra: null,
      respuesta_tipo: "text",
      respuesta_contenido: "¡Hola!",
      prioridad: 0,
      activa: true,
    });

    await ctx.turno("a", null);
    const conRegla = await ctx.turno("hola", "saludo");
    expect(conRegla.agentSource).toBe("rule");
    await ctx.turno("b", null);

    expect((await ctx.evaluarUltimo()).paused).toBe(false);
  });

  test("un turno interceptado por un flujo corta la racha del agente", async () => {
    const ctx = makeCtx({ escalar_umbral_intents: 2 });
    ctx.interceptados.add("patente ABC123");

    await ctx.turno("a", null);
    await ctx.turno("patente ABC123", null);
    await ctx.turno("b", null);

    expect((await ctx.evaluarUltimo()).paused).toBe(false);
  });

  test("después del turno interceptado, dos seguidos del agente sí escalan", async () => {
    const ctx = makeCtx({ escalar_umbral_intents: 2 });
    ctx.interceptados.add("patente ABC123");

    await ctx.turno("patente ABC123", null);
    await ctx.turno("a", null);
    await ctx.turno("b", null);

    expect((await ctx.evaluarUltimo()).paused).toBe(true);
  });

  test("al reanudar la IA, un solo turno sin intent no la vuelve a pausar", async () => {
    const ctx = makeCtx({ escalar_umbral_intents: 2 });

    await ctx.turno("a", null);
    const out = await ctx.turno("b", null);
    expect((await ctx.evaluarUltimo()).paused).toBe(true);

    // Con la IA pausada el agente no contesta: el turno no alarga la racha.
    await ctx.turno("c", null);
    await ctx.handoff.resume(out.sessionId);
    await ctx.turno("d", null);

    expect((await ctx.evaluarUltimo()).paused).toBe(false);
    expect((await ctx.sessions.findById(out.sessionId))!.ia_pausada).toBe(false);
  });
});
