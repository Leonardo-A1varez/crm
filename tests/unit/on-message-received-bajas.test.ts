import { describe, expect, test } from "vitest";
import { parsearClavesBajas } from "@/lib/difusion/claves-bajas";
import { IllegalStateError, InfraError } from "@/lib/errors";
import type { LogContext, Logger } from "@/lib/observability/logger";
import {
  HasherTelefonoBajas,
  hasherBajasDesde,
} from "@/server/repositories/difusion-supresiones.hash";
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
  CONFIRMACION_BAJA,
  onMessageReceivedHandler,
  type EmittedEvent,
  type OnMessageReceivedDeps,
  type StepRunner,
} from "@/inngest/functions/on-message-received";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import { FakeAgentLLM, FakeIntentClassifierLLM } from "../mocks/llm";
import { FakeMetaApiClient } from "../mocks/meta";

/**
 * "BAJA", "SALIR", "PARAR" y "SAIR" solos dejan una baja propia en
 * `difusion_supresiones` y, sólo si la baja es nueva, se le confirma al cliente
 * con el texto que decidió el dueño (`CONFIRMACION_BAJA`).
 */

const TELEFONO = "5491122334455";

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
  const supresiones = new InMemoryDifusionSupresionesRepository();
  const metaClient = new FakeMetaApiClient();
  const emitted: EmittedEvent[] = [];

  const deps: OnMessageReceivedDeps = {
    leads: new InMemoryLeadsRepository(),
    conversations,
    sessions,
    messages,
    metaApi: new DefaultMetaApiService(conversations, messages, metaClient),
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
    supresiones,
    configProvider: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
    emit: async (e) => {
      emitted.push(e);
    },
  };

  return { deps, emitted, intentLLM, agentLLM, messages, supresiones, metaClient };
}

function turno(ctx: ReturnType<typeof makeDeps>, overrides: Partial<ParsedMessage>) {
  ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
  ctx.agentLLM.enqueueText("respuesta del agente");
  return onMessageReceivedHandler({ parsed: parsed(overrides) }, ctx.deps);
}

describe("on-message-received — baja por palabra", () => {
  test("'BAJA' por WhatsApp deja una baja propia con la palabra y el lead", async () => {
    const ctx = makeDeps();

    const r = await turno(ctx, { contenido: "BAJA" });

    const bajas = await ctx.supresiones.activasPorTelefonos([TELEFONO]);
    expect(bajas).toHaveLength(1);
    expect(bajas[0]).toMatchObject({
      telefono: TELEFONO,
      origen: "palabra_clave",
      detalle: "BAJA",
      lead_id: r.leadId,
    });
  });

  test("tildes, mayúsculas y puntuación alrededor no cambian nada", async () => {
    const ctx = makeDeps();

    await turno(ctx, { contenido: "¡Salír!" });

    const bajas = await ctx.supresiones.activasPorTelefonos([TELEFONO]);
    expect(bajas.map((b) => b.detalle)).toEqual(["SALIR"]);
  });

  test("la palabra dentro de una frase no da de baja", async () => {
    const ctx = makeDeps();

    await turno(ctx, { contenido: "no quiero salir de la promo" });

    expect(await ctx.supresiones.contarActivas()).toBe(0);
  });

  async function salientes(ctx: ReturnType<typeof makeDeps>, conversacionId: string) {
    return (await ctx.messages.listByConversacion(conversacionId, { limit: 50 }))
      .filter((m) => m.direction === "out")
      .map((m) => m.contenido);
  }

  test("una baja nueva se confirma con el texto exacto, por el camino de las respuestas", async () => {
    const ctx = makeDeps();

    const r = await turno(ctx, { contenido: "PARAR" });

    expect(CONFIRMACION_BAJA).toBe(
      "Listo, no te enviaremos más promociones. Si fue un error, escríbenos y lo revertimos.",
    );
    const confirmacion = (await ctx.messages.listByConversacion(r.conversacionId)).find(
      (m) => m.contenido === CONFIRMACION_BAJA,
    );
    expect(confirmacion).toMatchObject({
      direction: "out",
      sender: "sistema",
      // Derivada del entrante: un reintento no la manda dos veces.
      idempotency_key: "baja:wamid.IN-1",
    });
  });

  test("una baja repetida no se vuelve a confirmar", async () => {
    const ctx = makeDeps();

    const r = await turno(ctx, { contenido: "BAJA", meta_message_id: "wamid.IN-1" });
    await turno(ctx, { contenido: "BAJA", meta_message_id: "wamid.IN-2" });
    await turno(ctx, { contenido: "baja", meta_message_id: "wamid.IN-3" });

    const confirmaciones = (await salientes(ctx, r.conversacionId)).filter(
      (c) => c === CONFIRMACION_BAJA,
    );
    expect(confirmaciones).toHaveLength(1);
    expect(await ctx.supresiones.contarActivas()).toBe(1);
  });

  test("un reintento del step de confirmación no la manda dos veces", async () => {
    const ctx = makeDeps();
    // Inngest reintenta un step que falló después de mandar: acá se corre dos
    // veces el de la confirmación.
    const step: StepRunner = {
      run: async (nombre, fn) => {
        if (nombre === "confirmar-baja") await fn();
        return fn();
      },
    };
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("ok");

    const r = await onMessageReceivedHandler(
      { parsed: parsed({ contenido: "BAJA" }) },
      ctx.deps,
      step,
    );

    const confirmaciones = (await salientes(ctx, r.conversacionId)).filter(
      (c) => c === CONFIRMACION_BAJA,
    );
    expect(confirmaciones).toHaveLength(1);
    expect(ctx.metaClient.calls.filter((m) => m.text === CONFIRMACION_BAJA)).toHaveLength(1);
  });

  test("un mensaje que no es baja no manda ninguna confirmación", async () => {
    const ctx = makeDeps();

    const r = await turno(ctx, { contenido: "no quiero salir de la promo" });

    expect(await salientes(ctx, r.conversacionId)).toEqual(["respuesta del agente"]);
  });

  test("Instagram no tiene teléfono: no registra nada y el turno sigue", async () => {
    const ctx = makeDeps();

    const r = await turno(ctx, {
      canal: "ig",
      canal_thread_id: "ig-hilo",
      meta_user_id: "ig-usuario",
      contenido: "BAJA",
    });

    expect(await ctx.supresiones.contarActivas()).toBe(0);
    expect(r.sent).toBe(true);
  });

  test("un adjunto con 'BAJA' de pie de foto no es una baja", async () => {
    const ctx = makeDeps();

    await turno(ctx, { tipo: "image", contenido: "BAJA", media_url: "media-1" });

    expect(await ctx.supresiones.contarActivas()).toBe(0);
  });

  test("la baja queda escrita antes de que los flujos se enteren del mensaje", async () => {
    const ctx = makeDeps();
    const orden: string[] = [];
    const step: StepRunner = {
      run: (nombre, fn) => {
        orden.push(nombre);
        return fn();
      },
    };
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("ok");

    await onMessageReceivedHandler({ parsed: parsed({ contenido: "SAIR" }) }, ctx.deps, step);

    expect(orden.indexOf("registrar-baja")).toBeGreaterThan(-1);
    expect(orden.indexOf("registrar-baja")).toBeLessThan(orden.indexOf("emit-workflow-mensaje"));
  });

  test("si la base no puede registrar la baja, el turno falla y Inngest lo reintenta", async () => {
    const ctx = makeDeps();
    ctx.deps.supresiones = {
      activasPorTelefonos: async () => [],
      registrar: async () => {
        throw new InfraError("postgrest caído", "supabase");
      },
    };

    await expect(turno(ctx, { contenido: "BAJA" })).rejects.toBeInstanceOf(InfraError);
  });

  // Sin las claves HMAC la baja no se puede registrar: el turno falla en voz
  // alta —y no se reintenta: es configuración, no una caída— en lugar de
  // confirmarle al cliente una baja que no quedó escrita.
  test("sin claves para hashear, la baja falla en voz alta y no se confirma", async () => {
    const ctx = makeDeps();
    ctx.deps.supresiones = new InMemoryDifusionSupresionesRepository({
      hasher: () => hasherBajasDesde({}),
    });

    await expect(turno(ctx, { contenido: "BAJA" })).rejects.toBeInstanceOf(IllegalStateError);
    expect(ctx.metaClient.calls.map((m) => m.text)).not.toContain(CONFIRMACION_BAJA);
  });

  test("ningún log de la baja incluye el teléfono ni su hash", async () => {
    // Clave de prueba: 32 bytes. No es secreto de ningún entorno.
    const hasher = new HasherTelefonoBajas(
      parsearClavesBajas(`1:${Buffer.alloc(32, 3).toString("base64")}`, 1),
    );
    const hash = hasher.alta(TELEFONO).telefono_hash;
    const ctx = makeDeps();
    ctx.deps.supresiones = new InMemoryDifusionSupresionesRepository({ hasher });
    const lineas: string[] = [];
    const capturar = (msg: string, c?: LogContext) => lineas.push(msg + JSON.stringify(c ?? {}));
    const logger: Logger = {
      debug: capturar,
      info: capturar,
      warn: capturar,
      error: capturar,
      child: () => logger,
    };
    ctx.deps.logger = logger;

    await turno(ctx, { contenido: "BAJA" });
    await turno(ctx, { contenido: "BAJA", meta_message_id: "wamid.IN-2" });

    const bajas = lineas.filter((l) => l.startsWith("baja-"));
    expect(bajas.map((l) => l.split("{")[0])).toEqual(["baja-registrada", "baja-repetida"]);
    for (const l of lineas) {
      expect(l).not.toContain(TELEFONO);
      expect(l).not.toContain(hash);
    }
  });
});
