import { describe, expect, test } from "vitest";
import { CLAVE_DIFUSION_RESPONDIDA } from "@/lib/difusion/respuesta";
import type { Grupo } from "@/lib/ui/condiciones";
import { InMemoryDifusionEnviosRepository } from "@/server/repositories/difusion-envios.repo";
import { InMemoryDifusionesRepository } from "@/server/repositories/difusiones.repo";
import { InMemoryWorkflowPlantillasSinSesionRepository } from "@/server/repositories/workflow-plantillas-sin-sesion.repo";
import { DefaultAnotarPlantillasSinSesion } from "@/server/services/workflows/plantilla-sin-sesion.service";
import {
  DefaultRespuestaDifusionService,
  type RegistrarRespuestaInput,
} from "@/server/services/difusion/respuesta.service";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemoryReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.repo";
import { InMemoryRuleExecutionsRepository } from "@/server/repositories/rule-executions.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { InMemoryTurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import { DefaultAiAgentService } from "@/server/services/ai-agent.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { DefaultIntentClassifierService } from "@/server/services/intent-classifier.service";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import {
  onMessageReceivedHandler,
  type OnMessageReceivedDeps,
} from "@/inngest/functions/on-message-received";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import { FakeAgentLLM, FakeIntentClassifierLLM } from "../mocks/llm";
import { FakeMetaApiClient } from "../mocks/meta";

/**
 * La respuesta a una difusión: el motor manda la plantilla sin sesión, y el
 * entrante que le responde la anota en el hilo y en la sesión, para que el
 * vendedor vea qué se le mandó y el agente sepa a qué responde el cliente.
 */

const TELEFONO = "5491122334455";
const ARBOL: Grupo = { id: "raiz", clase: "grupo", operador: "y", hijos: [] };
const DESCRIPCION = "«Promo frenos» · plantilla «promo_frenos_v3»";

function parsed(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    canal: "wa",
    canal_thread_id: TELEFONO,
    meta_user_id: TELEFONO,
    meta_message_id: "wamid.IN-1",
    tipo: "text",
    contenido: "hola",
    media_url: null,
    nombre_perfil: null,
    raw: { type: "text" },
    ...overrides,
  };
}

function makeDeps() {
  const conversations = new InMemoryConversationsRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const messages = new InMemoryMessagesRepository();
  const intents = new InMemoryIntentsRepository();
  const ruleEngine = new DefaultRuleEngineService(
    intents,
    new InMemoryRulesRepository(),
    new InMemoryReglasEtiquetaRepository(),
  );
  const intentLLM = new FakeIntentClassifierLLM();
  const agentLLM = new FakeAgentLLM();
  const difusiones = new InMemoryDifusionesRepository();
  const envios = new InMemoryDifusionEnviosRepository();
  const registros: RegistrarRespuestaInput[] = [];
  const emitidos: Array<{ name: string; id?: string; data: Record<string, unknown> }> = [];
  const real = new DefaultRespuestaDifusionService({ envios, difusiones, messages, sessions });
  const plantillasWf = new InMemoryWorkflowPlantillasSinSesionRepository();

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
    respuestaDifusion: {
      registrar: async (input) => {
        registros.push(input);
        return real.registrar(input);
      },
    },
    plantillasSinSesion: new DefaultAnotarPlantillasSinSesion({ repo: plantillasWf, messages }),
    configProvider: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
    emit: async (e) => {
      emitidos.push(e as { name: string; id?: string; data: Record<string, unknown> });
    },
  };

  return {
    deps,
    intentLLM,
    agentLLM,
    messages,
    sessions,
    difusiones,
    envios,
    registros,
    plantillasWf,
    emitidos,
  };
}

function turno(ctx: ReturnType<typeof makeDeps>, overrides: Partial<ParsedMessage> = {}) {
  ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
  ctx.agentLLM.enqueueText("respuesta del agente");
  return onMessageReceivedHandler({ parsed: parsed(overrides) }, ctx.deps);
}

/** Una difusión que le salió a `leadId` recién: aceptada por Meta con `wamid`. */
async function difusionA(ctx: ReturnType<typeof makeDeps>, leadId: string, wamid: string) {
  const d = await ctx.difusiones.create({
    nombre: "Promo frenos",
    audiencia: ARBOL,
    creada_por: null,
    plantilla_nombre: "promo_frenos_v3",
    plantilla_categoria: "marketing",
    plantilla_idioma: "es_AR",
    plantilla_parametros: [],
    canary_tamano: null,
  });
  const ahora = new Date();
  await ctx.envios.registrarPlan([
    {
      difusion_id: d.id,
      lead_id: leadId,
      telefono: TELEFONO,
      estado: "en_cola",
      motivo_exclusion: null,
      ruta: "plantilla",
      tanda: 0,
      programado_para: ahora,
    },
  ]);
  const [e] = await ctx.envios.pendientesParaEnviar(d.id, ahora, 1);
  await ctx.envios.reservar(e!.id, ahora);
  await ctx.envios.marcarAceptado(e!.id, wamid);
  // La respuesta llega después del envío: sin esto comparten milisegundo y el
  // orden del hilo queda librado al desempate.
  await new Promise((r) => setTimeout(r, 5));
  return d;
}

describe("on-message-received — respuesta a una difusión", () => {
  test("anota la plantilla en el hilo de la sesión que abre la respuesta", async () => {
    const ctx = makeDeps();
    const primero = await turno(ctx);
    await ctx.sessions.close(primero.sessionId, { resultado: "exito" });
    await difusionA(ctx, primero.leadId, "wamid.DIFUSION-1");

    const r = await turno(ctx, { meta_message_id: "wamid.IN-2", contenido: "me interesa" });

    expect(r.sessionCreated).toBe(true);
    expect(await ctx.messages.findByMetaMessageId("wamid.DIFUSION-1")).toMatchObject({
      lead_session_id: r.sessionId,
      conversacion_id: r.conversacionId,
      direction: "out",
      sender: "sistema",
      tipo: "template",
    });
    const sesion = await ctx.sessions.findById(r.sessionId);
    expect(sesion?.extras[CLAVE_DIFUSION_RESPONDIDA]).toBe(DESCRIPCION);
  });

  test("el agente ve la plantilla antes del mensaje del cliente, y la sesión con la difusión", async () => {
    const ctx = makeDeps();
    const primero = await turno(ctx);
    await ctx.sessions.close(primero.sessionId, { resultado: "exito" });
    await difusionA(ctx, primero.leadId, "wamid.DIFUSION-1");

    await turno(ctx, { meta_message_id: "wamid.IN-2", contenido: "me interesa" });

    const llamada = ctx.agentLLM.calls.at(-1)!;
    const lineas = llamada.conversationTurn;
    const iPlantilla = lineas.indexOf(`sistema: Difusión ${DESCRIPCION}`);
    expect(iPlantilla).toBeGreaterThanOrEqual(0);
    expect(lineas.at(-1)).toBe("lead: me interesa");
    expect(iPlantilla).toBeLessThan(lineas.length - 1);
    expect(llamada.session.extras[CLAVE_DIFUSION_RESPONDIDA]).toBe(DESCRIPCION);
  });

  test("la primera respuesta dispara «Difusión respondida» con la difusión; la segunda no", async () => {
    const ctx = makeDeps();
    const primero = await turno(ctx);
    await ctx.sessions.close(primero.sessionId, { resultado: "exito" });
    const d = await difusionA(ctx, primero.leadId, "wamid.DIFUSION-1");

    await turno(ctx, { meta_message_id: "wamid.IN-2", contenido: "me interesa" });
    await turno(ctx, { meta_message_id: "wamid.IN-3", contenido: "¿precio?" });

    const disparos = ctx.emitidos.filter(
      (e) => e.name === "workflow/disparo.recibido" && e.data.disparador === "difusion_respondida",
    );
    expect(disparos).toHaveLength(1);
    expect(disparos[0]).toMatchObject({
      id: expect.stringContaining("wamid.IN-2"),
      data: { leadId: primero.leadId, datos: { difusionId: d.id } },
    });
  });

  test("pasa lead, conversación y sesión del entrante", async () => {
    const ctx = makeDeps();
    const r = await turno(ctx);
    expect(ctx.registros).toHaveLength(1);
    expect(ctx.registros[0]).toMatchObject({
      leadId: r.leadId,
      conversacionId: r.conversacionId,
      leadSessionId: r.sessionId,
    });
  });

  test("por Instagram no busca difusiones: salen sólo por WhatsApp", async () => {
    const ctx = makeDeps();
    await turno(ctx, { canal: "ig", canal_thread_id: "ig-1", meta_user_id: "ig-1" });
    expect(ctx.registros).toEqual([]);
  });
});

describe("on-message-received — respuesta a una plantilla de un flujo sin sesión", () => {
  // "Reactivar perdidos": el flujo le mandó la plantilla a un lead con la
  // sesión cerrada, sin escribir en `mensajes`. Cuando responde, la plantilla
  // entra al hilo de la sesión nueva, antes de su mensaje.
  test("la plantilla queda en el hilo del Inbox y el agente la ve antes del entrante", async () => {
    const ctx = makeDeps();
    const primero = await turno(ctx);
    await ctx.sessions.close(primero.sessionId, { resultado: "perdido" });
    const fila = await ctx.plantillasWf.reservar({
      idempotency_key: "wf:r1:2",
      workflow_run_id: "r1",
      lead_id: primero.leadId,
      conversacion_id: primero.conversacionId,
      plantilla_nombre: "volvamos",
      plantilla_idioma: "es_AR",
      contenido: "Plantilla «volvamos»: Ana",
      parametros_cuerpo: ["Ana"],
      intento_at: new Date(),
    });
    await ctx.plantillasWf.marcarAceptado(fila.id, "wamid.WF-1");
    await new Promise((r) => setTimeout(r, 5));

    const r = await turno(ctx, { meta_message_id: "wamid.IN-2", contenido: "sigo buscando" });

    expect(await ctx.messages.findByMetaMessageId("wamid.WF-1")).toMatchObject({
      lead_session_id: r.sessionId,
      direction: "out",
      tipo: "template",
      contenido: "Plantilla «volvamos»: Ana",
    });
    const lineas = ctx.agentLLM.calls.at(-1)!.conversationTurn;
    expect(lineas.indexOf("sistema: Plantilla «volvamos»: Ana")).toBeGreaterThanOrEqual(0);
    expect(lineas.at(-1)).toBe("lead: sigo buscando");
  });
});
