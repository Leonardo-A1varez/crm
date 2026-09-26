import { beforeEach, describe, expect, test } from "vitest";
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
import {
  StaticAgentConfigProvider,
  type AgentConfigProvider,
} from "@/server/services/agente/config-provider";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import {
  onMessageReceivedHandler,
  type EmittedEvent,
  type OnMessageReceivedDeps,
} from "@/inngest/functions/on-message-received";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import { DIAS_SEMANA, type Horario } from "@/types/agente";
import { FakeAgentLLM, FakeIntentClassifierLLM } from "../mocks/llm";
import { FakeMetaApiClient } from "../mocks/meta";

/**
 * Corte 3 de la Fase 0: `workflow/disparo.recibido` tenía consumidor y ningún
 * emisor. El pipeline de mensajes emite dos: `mensaje_recibido` por cada
 * mensaje nuevo, y `etiqueta_asignada` por cada etiqueta que una regla deja
 * puesta en el turno.
 */

type Disparo = Extract<EmittedEvent, { name: "workflow/disparo.recibido" }>;

function horarioCerradoSiempre(): Horario {
  const horario = {} as Horario;
  for (const dia of DIAS_SEMANA) horario[dia] = [];
  return horario;
}

function parsed(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    canal: "wa",
    canal_thread_id: "549110",
    meta_user_id: "549110",
    meta_message_id: "wamid.IN-1",
    tipo: "text",
    contenido: "hola",
    media_url: null,
    nombre_perfil: null,
    raw: { type: "text" },
    ...overrides,
  };
}

function makeDeps(
  configProvider: AgentConfigProvider = new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
) {
  const leads = new InMemoryLeadsRepository();
  const conversations = new InMemoryConversationsRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const messages = new InMemoryMessagesRepository();
  const intents = new InMemoryIntentsRepository();
  const rules = new InMemoryRulesRepository();
  const reglasEtiqueta = new InMemoryReglasEtiquetaRepository();
  const tags = new InMemoryTagsRepository();

  const intentLLM = new FakeIntentClassifierLLM();
  const agentLLM = new FakeAgentLLM();

  const metaApi = new DefaultMetaApiService(conversations, messages, new FakeMetaApiClient());
  const ruleEngine = new DefaultRuleEngineService(intents, rules, reglasEtiqueta);
  const aiAgent = new DefaultAiAgentService(
    sessions,
    ruleEngine,
    new DefaultCatalogMatcherService(new InMemoryProductsRepository()),
    agentLLM,
  );

  const emitted: EmittedEvent[] = [];
  const deps: OnMessageReceivedDeps = {
    leads,
    conversations,
    sessions,
    messages,
    metaApi,
    intentClassifier: new DefaultIntentClassifierService(intents, intentLLM),
    aiAgent,
    ruleExecutions: new InMemoryRuleExecutionsRepository(),
    turnClassifications: new InMemoryTurnClassificationsRepository(),
    ruleEngine,
    tags,
    intents,
    identificadores: new InMemoryLeadIdentificadoresRepository(),
    supresiones: new InMemoryDifusionSupresionesRepository(),
    respuestaDifusion: { registrar: async () => null },
    plantillasSinSesion: { registrar: async () => 0 },
    configProvider,
    emit: async (e) => {
      emitted.push(e);
    },
  };

  return { deps, emitted, intentLLM, agentLLM, intents, tags, reglasEtiqueta, messages };
}

function disparos(emitted: EmittedEvent[], disparador: string): Disparo[] {
  return emitted.filter(
    (e): e is Disparo => e.name === "workflow/disparo.recibido" && e.data.disparador === disparador,
  );
}

describe("on-message-received — disparo mensaje_recibido", () => {
  let ctx: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeDeps();
  });

  test("un mensaje nuevo emite el disparo con lead, sesión, contexto y los datos del mensaje", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("hola");

    const r = await onMessageReceivedHandler(
      { parsed: parsed({ contenido: "¿tienen pastillas de freno?", nombre_perfil: "Ana" }) },
      ctx.deps,
    );

    const inbound = (await ctx.messages.listByConversacion(r.conversacionId)).find(
      (m) => m.direction === "in",
    )!;
    expect(disparos(ctx.emitted, "mensaje_recibido")).toEqual([
      {
        name: "workflow/disparo.recibido",
        // Determinístico por el mensaje entrante: Inngest deduplica la reentrega.
        id: `workflow-disparo:mensaje:${inbound.id}`,
        data: {
          disparador: "mensaje_recibido",
          leadId: r.leadId,
          leadSessionId: r.sessionId,
          contexto: {
            lead: { etapa: "nuevo", nombre: "Ana", canal: "wa" },
            // El clasificador no reconoció ningún intent: el turno no tiene.
            sesion: {
              tiene_cotizacion: false,
              respondio: true,
              intent: null,
              intent_mensaje_at: inbound.created_at.toISOString(),
            },
          },
          datos: { canal: "wa", tipoMensaje: "text", texto: "¿tienen pastillas de freno?" },
        },
      },
    ]);
  });

  test("la reentrega del mismo mensaje de Meta no vuelve a disparar", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("hola");

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);
    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(disparos(ctx.emitted, "mensaje_recibido")).toHaveLength(1);
  });

  test("fuera de horario dispara igual: el flujo decide, no el horario del agente", async () => {
    const local = makeDeps(
      new StaticAgentConfigProvider({
        ...CONFIG_DE_FABRICA,
        horario: horarioCerradoSiempre(),
        plantilla_fuera_horario: "",
      }),
    );

    const r = await onMessageReceivedHandler({ parsed: parsed() }, local.deps);

    expect(r.sent).toBe(false);
    expect(disparos(local.emitted, "mensaje_recibido")).toHaveLength(1);
  });
});

describe("on-message-received — el disparo lleva el intent de su turno", () => {
  // La carrera: el disparo salía antes de clasificar, y la condición "Intent
  // detectado" leía de la base el turno ANTERIOR (este se escribe después de
  // que contesta el agente).
  test("sale después de clasificar, con el id del intent y la hora del mensaje", async () => {
    const ctx = makeDeps();
    const precio = await ctx.intents.create({
      nombre: "precio",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    ctx.intentLLM.enqueue({ intent_nombre: "precio", confidence: 0.9 });
    ctx.agentLLM.enqueueText("ok");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    const inbound = (await ctx.messages.listByConversacion(r.conversacionId)).find(
      (m) => m.direction === "in",
    )!;
    const [d] = disparos(ctx.emitted, "mensaje_recibido");
    expect(d?.data.contexto.sesion).toMatchObject({
      intent: precio.id,
      intent_mensaje_at: inbound.created_at.toISOString(),
    });
  });

  test("si la clasificación falla, dispara igual (sin intent) y el turno sigue fallando", async () => {
    const ctx = makeDeps();
    const falla = new Error("clasificador caído");
    ctx.deps.intentClassifier = {
      classify: async () => {
        throw falla;
      },
    };

    await expect(onMessageReceivedHandler({ parsed: parsed() }, ctx.deps)).rejects.toBe(falla);

    const ds = disparos(ctx.emitted, "mensaje_recibido");
    expect(ds).toHaveLength(1);
    expect(ds[0]?.data.contexto.sesion).toMatchObject({ intent: null });
  });

  test("fuera de horario no clasifica: dispara con el turno sin intent", async () => {
    const local = makeDeps(
      new StaticAgentConfigProvider({
        ...CONFIG_DE_FABRICA,
        horario: horarioCerradoSiempre(),
        plantilla_fuera_horario: "",
      }),
    );

    await onMessageReceivedHandler({ parsed: parsed() }, local.deps);

    expect(local.intentLLM.calls).toHaveLength(0);
    const [d] = disparos(local.emitted, "mensaje_recibido");
    expect(d?.data.contexto.sesion).toMatchObject({ intent: null });
  });
});

describe("on-message-received — disparo lead_creado", () => {
  test("el primer mensaje de un lead nuevo dispara una vez, ya con la sesión abierta", async () => {
    const ctx = makeDeps();
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("hola");

    const r = await onMessageReceivedHandler(
      { parsed: parsed({ nombre_perfil: "Ana" }) },
      ctx.deps,
    );

    expect(disparos(ctx.emitted, "lead_creado")).toEqual([
      {
        name: "workflow/disparo.recibido",
        // Un lead nace una sola vez: su id alcanza como clave.
        id: `workflow-disparo:lead-creado:${r.leadId}`,
        data: {
          disparador: "lead_creado",
          leadId: r.leadId,
          leadSessionId: r.sessionId,
          contexto: {
            lead: { etapa: "nuevo", nombre: "Ana", canal: "wa" },
            sesion: { tiene_cotizacion: false, respondio: true },
          },
          datos: { canal: "wa" },
        },
      },
    ]);
  });

  test("el segundo mensaje del mismo lead no vuelve a disparar", async () => {
    const ctx = makeDeps();
    for (const id of ["wamid.IN-1", "wamid.IN-2"]) {
      ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
      ctx.agentLLM.enqueueText("hola");
      await onMessageReceivedHandler({ parsed: parsed({ meta_message_id: id }) }, ctx.deps);
    }

    expect(disparos(ctx.emitted, "lead_creado")).toHaveLength(1);
  });
});

describe("on-message-received — disparo etiqueta_asignada", () => {
  let ctx: ReturnType<typeof makeDeps>;
  let tagId: string;
  let intentId: string;

  beforeEach(async () => {
    ctx = makeDeps();
    const intent = await ctx.intents.create({
      nombre: "factura",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    const tag = await ctx.tags.create({
      nombre: "Pide factura",
      color: "#112233",
      descripcion: null,
    });
    tagId = tag.id;
    intentId = intent.id;
    await ctx.reglasEtiqueta.create({
      intent_id: intent.id,
      tag_id: tag.id,
      condiciones_extra: null,
      activa: true,
    });
  });

  function turno(metaMessageId: string) {
    ctx.intentLLM.enqueue({ intent_nombre: "factura", confidence: 0.9 });
    ctx.agentLLM.enqueueText("ok");
    return onMessageReceivedHandler(
      { parsed: parsed({ meta_message_id: metaMessageId }) },
      ctx.deps,
    );
  }

  test("una etiqueta que pone una regla dispara una vez, con la etiqueta en los datos", async () => {
    const r = await turno("wamid.IN-1");

    const inbound = (await ctx.messages.listByConversacion(r.conversacionId)).find(
      (m) => m.direction === "in",
    )!;
    const ds = disparos(ctx.emitted, "etiqueta_asignada");
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({
      id: `workflow-disparo:etiqueta:${r.leadId}:${tagId}:${inbound.id}`,
      data: { leadId: r.leadId, leadSessionId: r.sessionId, datos: { tagId } },
    });
  });

  // La misma carrera que «Mensaje recibido»: la base recién tiene el intent
  // cuando contesta el agente, y una condición «Intent detectado» en un flujo
  // de «Etiqueta asignada» leería el turno anterior.
  test("el disparo lleva el intent del turno que puso la etiqueta", async () => {
    const r = await turno("wamid.IN-1");

    const inbound = (await ctx.messages.listByConversacion(r.conversacionId)).find(
      (m) => m.direction === "in",
    )!;
    const [d] = disparos(ctx.emitted, "etiqueta_asignada");
    expect(d?.data.contexto.sesion).toMatchObject({
      intent: intentId,
      intent_mensaje_at: inbound.created_at.toISOString(),
    });
  });

  test("una etiqueta que el lead ya tenía no vuelve a disparar en el mensaje siguiente", async () => {
    await turno("wamid.IN-1");
    await turno("wamid.IN-2");

    expect(disparos(ctx.emitted, "etiqueta_asignada")).toHaveLength(1);
  });

  test("una etiqueta que una persona sacó no la revive la regla, y por eso no dispara", async () => {
    const r = await turno("wamid.IN-1");
    await ctx.tags.removeFromLead(r.leadId, tagId, null);

    await turno("wamid.IN-2");

    expect(disparos(ctx.emitted, "etiqueta_asignada")).toHaveLength(1);
  });
});

describe("on-message-received — respuesta a botones o lista", () => {
  type Respuesta = Extract<EmittedEvent, { name: "workflow/respuesta.interactiva" }>;
  const respuestas = (emitted: EmittedEvent[]) =>
    emitted.filter((e): e is Respuesta => e.name === "workflow/respuesta.interactiva");
  // Fuera de horario: el agente no corre, y lo que se prueba es el aviso al flujo.
  const sinAgente = () =>
    makeDeps(
      new StaticAgentConfigProvider({
        ...CONFIG_DE_FABRICA,
        horario: horarioCerradoSiempre(),
        plantilla_fuera_horario: "",
      }),
    );

  test("emite la opción elegida, del lead y del mensaje al que responde", async () => {
    const ctx = sinAgente();
    const r = await onMessageReceivedHandler(
      {
        parsed: parsed({
          meta_message_id: "wamid.IN-OPC",
          contenido: "Sí",
          respuesta_interactiva: { id: "si", titulo: "Sí", responde_a: "wamid.OUT-1" },
        }),
      },
      ctx.deps,
    );
    expect(respuestas(ctx.emitted)).toEqual([
      {
        name: "workflow/respuesta.interactiva",
        id: "respuesta-interactiva:wamid.IN-OPC",
        data: { leadId: r.leadId, respondeA: "wamid.OUT-1", opcionId: "si", titulo: "Sí" },
      },
    ]);
  });

  test("un texto común no emite nada de esto", async () => {
    const ctx = sinAgente();
    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);
    expect(respuestas(ctx.emitted)).toEqual([]);
  });
});
