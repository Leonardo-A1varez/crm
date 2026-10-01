import { describe, expect, test } from "vitest";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { BudgetExceededError } from "@/lib/errors";
import {
  copilotoBorradorHandler,
  type CopilotoBorradorDeps,
} from "@/inngest/functions/copiloto-borrador";
import type { StepRunner } from "@/inngest/functions/on-message-received";
import { InMemoryBorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemoryReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { InMemoryTurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import { DefaultAiAgentService } from "@/server/services/ai-agent.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { DefaultIntentClassifierService } from "@/server/services/intent-classifier.service";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import type { AgenteConfigValores } from "@/types/agente";
import { FakeAgentLLM, FakeIntentClassifierLLM } from "../mocks/llm";

const TEL = "5491155551234";

async function makeCtx(
  config: Partial<AgenteConfigValores> = {},
  delegaciones?: CopilotoBorradorDeps["delegaciones"],
) {
  const leads = new InMemoryLeadsRepository();
  const conversations = new InMemoryConversationsRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const messages = new InMemoryMessagesRepository();
  const intents = new InMemoryIntentsRepository();
  const rules = new InMemoryRulesRepository();
  const turnClassifications = new InMemoryTurnClassificationsRepository();
  const intentLLM = new FakeIntentClassifierLLM();
  // El escalado (palabras, cotización) lo lee el agente de `configAgente()`.
  const agentLLM = new FakeAgentLLM().conConfig(config);
  const borradores = new InMemoryBorradoresIaRepository(async (conversacionId) => {
    const entrantes = (await messages.listByConversacion(conversacionId, { limit: 200 })).filter(
      (m) => m.direction === "in",
    );
    const tope = entrantes[0]?.created_at.getTime();
    return entrantes.filter((m) => m.created_at.getTime() === tope).at(-1)?.id ?? null;
  });

  const lead = await leads.create({
    nombre: "Ana",
    telefono: TEL,
    email: null,
    direccion: null,
    vehiculo_marca: "",
    vehiculo_modelo: "",
    vehiculo_anio: 0,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: "wa",
    meta_user_ids: { wa: TEL },
  });
  const sesion = await sessions.create({
    lead_id: lead.id,
    current_stage: "nuevo",
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
  });
  const conv = await conversations.create({ lead_id: lead.id, canal: "wa", canal_thread_id: TEL });

  async function entrante(contenido: string, wamid: string) {
    return messages.create({
      conversacion_id: conv.id,
      lead_session_id: sesion.id,
      direction: "in",
      sender: "lead",
      sender_user_id: null,
      tipo: "text",
      contenido,
      media_url: null,
      meta_message_id: wamid,
      idempotency_key: null,
      metadata: {},
    });
  }
  const origen = await entrante("Busco filtro de aceite", "wamid.IN-1");

  /** Un borrador ya generado para ese entrante, en el estado pedido. */
  async function borradorEn(estado: "listo" | "error" | "usado", leadSessionId = sesion.id) {
    const r = await borradores.iniciar({
      conversacionId: conv.id,
      leadSessionId,
      mensajeOrigenId: origen.id,
    });
    if (r.resultado !== "creado") throw new Error("fixture");
    if (estado === "error") {
      await borradores.marcarError(r.borradorId, "llm_error");
    } else {
      await borradores.completar(r.borradorId, {
        contenido: "Borrador viejo",
        origen: "ia",
        reglaId: null,
      });
      if (estado === "usado") {
        await borradores.marcarUsado(r.borradorId, { via: "copiar", usuarioId: null });
      }
    }
    return r.borradorId;
  }

  const ruleEngine = new DefaultRuleEngineService(
    intents,
    rules,
    new InMemoryReglasEtiquetaRepository(),
  );
  const deps: CopilotoBorradorDeps = {
    borradores,
    conversations,
    sessions,
    messages,
    turnClassifications,
    intentClassifier: new DefaultIntentClassifierService(intents, intentLLM),
    aiAgent: new DefaultAiAgentService(
      sessions,
      ruleEngine,
      new DefaultCatalogMatcherService(new InMemoryProductsRepository()),
      agentLLM,
    ),
    configProvider: new StaticAgentConfigProvider({ ...CONFIG_DE_FABRICA, ...config }),
    ...(delegaciones ? { delegaciones } : {}),
  };
  /**
   * Con al menos un intent activo el clasificador SÍ llama al LLM; sin ninguno
   * devuelve "sin intent" sin llamarlo, y un `calls` en 0 no probaría nada.
   */
  async function sembrarIntent() {
    return intents.create({
      nombre: "consulta_stock",
      descripcion: "pregunta por disponibilidad",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
  }

  return {
    deps,
    conv,
    sesion,
    origen,
    sembrarIntent,
    borradores,
    borradorEn,
    entrante,
    intentLLM,
    agentLLM,
    turnClassifications,
    sessions,
    intents,
    rules,
  };
}

describe("copilotoBorradorHandler (Regenerar / Reintentar)", () => {
  test("regenera: descarta el borrador anterior y deja uno nuevo con el texto nuevo", async () => {
    const ctx = await makeCtx();
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Texto nuevo.");

    const r = await copilotoBorradorHandler(
      { borradorId: viejo, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    expect(r).toEqual({ estado: "listo" });
    expect((await ctx.borradores.findById(viejo))?.estado).toBe("descartado");
    const actual = await ctx.borradores.findActualByConversacion(ctx.conv.id);
    expect(actual).toMatchObject({ estado: "listo", contenido: "Texto nuevo.", origen: "ia" });
    expect(actual?.id).not.toBe(viejo);
    expect(ctx.agentLLM.calls).toHaveLength(1);
  });

  test("el agente recibe el mismo turno que el pipeline: mensajes de la conversación", async () => {
    const ctx = await makeCtx();
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Ok.");

    await copilotoBorradorHandler({ borradorId: viejo, conversacionId: ctx.conv.id }, ctx.deps);

    expect(ctx.agentLLM.calls[0]?.conversationTurn).toEqual(["lead: Busco filtro de aceite"]);
    expect(ctx.agentLLM.calls[0]?.mensajeOrigenId).toBe(ctx.origen.id);
  });

  test("reusa la clasificación ya auditada del turno y no vuelve a llamar al clasificador", async () => {
    const ctx = await makeCtx();
    await ctx.sembrarIntent();
    await ctx.turnClassifications.create({
      mensaje_id: ctx.origen.id,
      intent_id: null,
      intent_nombre: null,
      confidence: 0.42,
    });
    const viejo = await ctx.borradorEn("listo");
    ctx.agentLLM.enqueueText("Sin volver a clasificar.");

    await copilotoBorradorHandler({ borradorId: viejo, conversacionId: ctx.conv.id }, ctx.deps);

    expect(ctx.intentLLM.calls).toHaveLength(0);
    expect(ctx.agentLLM.calls[0]?.classification).toEqual({
      intent_nombre: null,
      confidence: 0.42,
    });
  });

  test("sin clasificación auditada, vuelve a clasificar el mensaje de origen", async () => {
    const ctx = await makeCtx();
    await ctx.sembrarIntent();
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0.1 });
    ctx.agentLLM.enqueueText("Con clasificación nueva.");

    await copilotoBorradorHandler({ borradorId: viejo, conversacionId: ctx.conv.id }, ctx.deps);

    expect(ctx.intentLLM.calls).toHaveLength(1);
    expect(ctx.intentLLM.calls[0]?.mensajeId).toBe(ctx.origen.id);
  });

  test("las instrucciones de un tramo delegado vivo llegan al agente (mismo input que el pipeline)", async () => {
    const ctx = await makeCtx(
      {},
      {
        delegacionesActivas: async () => [
          { runId: "run-1", instrucciones: "Pedile la patente al cliente" },
        ],
      },
    );
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Con tramo.");

    await copilotoBorradorHandler({ borradorId: viejo, conversacionId: ctx.conv.id }, ctx.deps);

    expect(ctx.agentLLM.calls[0]?.instruccionesTramo).toEqual(["Pedile la patente al cliente"]);
  });

  test("sin tramos delegados no hay instruccionesTramo", async () => {
    const ctx = await makeCtx({}, { delegacionesActivas: async () => [] });
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Sin tramo.");

    await copilotoBorradorHandler({ borradorId: viejo, conversacionId: ctx.conv.id }, ctx.deps);

    expect(ctx.agentLLM.calls[0]?.instruccionesTramo).toBeUndefined();
  });

  test("una regla IF/THEN que cubre el intent queda como borrador con origen regla", async () => {
    const ctx = await makeCtx();
    const intent = await ctx.intents.create({
      nombre: "horario",
      descripcion: "pregunta por el horario",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    const regla = await ctx.rules.create({
      intent_id: intent.id,
      condiciones_extra: null,
      respuesta_tipo: "text",
      respuesta_contenido: "Abrimos de 9 a 18",
      prioridad: 0,
      activa: true,
    });
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: "horario", confidence: 0.9 });

    await copilotoBorradorHandler({ borradorId: viejo, conversacionId: ctx.conv.id }, ctx.deps);

    expect(await ctx.borradores.findActualByConversacion(ctx.conv.id)).toMatchObject({
      estado: "listo",
      contenido: "Abrimos de 9 a 18",
      origen: "regla",
      regla_id: regla.id,
    });
    expect(ctx.agentLLM.calls).toHaveLength(0);
  });

  test("Reintentar desde un borrador en error", async () => {
    const ctx = await makeCtx();
    const fallido = await ctx.borradorEn("error");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Esta vez salió.");

    const r = await copilotoBorradorHandler(
      { borradorId: fallido, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    expect(r.estado).toBe("listo");
    expect((await ctx.borradores.findActualByConversacion(ctx.conv.id))?.contenido).toBe(
      "Esta vez salió.",
    );
  });

  test("un borrador ya usado no se regenera", async () => {
    const ctx = await makeCtx();
    const usado = await ctx.borradorEn("usado");

    const r = await copilotoBorradorHandler(
      { borradorId: usado, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    expect(r).toEqual({ estado: "omitido", motivo: "borrador_no_vigente" });
    expect((await ctx.borradores.findById(usado))?.estado).toBe("usado");
    expect(ctx.agentLLM.calls).toHaveLength(0);
  });

  test("un borrador de otra conversación no se regenera", async () => {
    const ctx = await makeCtx();
    const viejo = await ctx.borradorEn("listo");

    const r = await copilotoBorradorHandler(
      { borradorId: viejo, conversacionId: crypto.randomUUID() },
      ctx.deps,
    );

    expect(r).toEqual({ estado: "omitido", motivo: "conversacion_distinta" });
    expect((await ctx.borradores.findById(viejo))?.estado).toBe("listo");
  });

  test("si la sesión del borrador ya no es la activa, se omite", async () => {
    const ctx = await makeCtx();
    const deOtraSesion = await ctx.borradorEn("listo", crypto.randomUUID());

    const r = await copilotoBorradorHandler(
      { borradorId: deOtraSesion, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    expect(r).toEqual({ estado: "omitido", motivo: "sesion_cerrada" });
    expect((await ctx.borradores.findById(deOtraSesion))?.estado).toBe("listo");
  });

  test("si llegó otro mensaje del cliente, el pedido es obsoleto y no toca nada", async () => {
    const ctx = await makeCtx();
    const viejo = await ctx.borradorEn("listo");
    await ctx.entrante("¿y en stock?", "wamid.IN-2");

    const r = await copilotoBorradorHandler(
      { borradorId: viejo, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    expect(r).toEqual({ estado: "omitido", motivo: "obsoleto" });
    expect((await ctx.borradores.findById(viejo))?.estado).toBe("listo");
    expect(ctx.agentLLM.calls).toHaveLength(0);
  });

  test("un error del modelo deja el borrador nuevo en error con llm_error y la función falla", async () => {
    const ctx = await makeCtx();
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueue(async () => {
      throw new Error("proveedor caído");
    });

    await expect(
      copilotoBorradorHandler({ borradorId: viejo, conversacionId: ctx.conv.id }, ctx.deps),
    ).rejects.toThrow("proveedor caído");

    const actual = await ctx.borradores.findActualByConversacion(ctx.conv.id);
    expect(actual).toMatchObject({ estado: "error", error_codigo: "llm_error" });
    expect(JSON.stringify(actual)).not.toContain("proveedor");
  });

  test("el tope diario deja tope_diario", async () => {
    const ctx = await makeCtx();
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueue(async () => {
      throw new BudgetExceededError("tope", "llm_diario");
    });

    await expect(
      copilotoBorradorHandler({ borradorId: viejo, conversacionId: ctx.conv.id }, ctx.deps),
    ).rejects.toBeInstanceOf(BudgetExceededError);

    expect((await ctx.borradores.findActualByConversacion(ctx.conv.id))?.error_codigo).toBe(
      "tope_diario",
    );
  });

  test("con la IA pausada no hay borrador: queda en error ia_no_disponible para que se vea por qué", async () => {
    const ctx = await makeCtx();
    const viejo = await ctx.borradorEn("listo");
    await ctx.sessions.update(ctx.sesion.id, { ia_pausada: true });
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });

    const r = await copilotoBorradorHandler(
      { borradorId: viejo, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    expect(r).toEqual({ estado: "error", motivo: "ia_no_disponible" });
    expect(await ctx.borradores.findActualByConversacion(ctx.conv.id)).toMatchObject({
      estado: "error",
      error_codigo: "ia_no_disponible",
    });
    expect(ctx.agentLLM.calls).toHaveLength(0);
  });

  test("una cotización sobre el tope escalaría: error escalado y la sesión no se toca", async () => {
    const ctx = await makeCtx({ escalar_cotizacion_desde: 500_000 });
    await ctx.sessions.update(ctx.sesion.id, { precio_cotizado: 750_000 });
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });

    const r = await copilotoBorradorHandler(
      { borradorId: viejo, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    expect(r).toEqual({ estado: "error", motivo: "escalado" });
    expect(await ctx.borradores.findActualByConversacion(ctx.conv.id)).toMatchObject({
      estado: "error",
      error_codigo: "escalado",
    });
    // Sin `soloRedactar` el agente pausaría la sesión (y en producción avisaría al cliente).
    expect(await ctx.sessions.findById(ctx.sesion.id)).toMatchObject({
      ia_pausada: false,
      current_stage: "nuevo",
    });
    expect(ctx.agentLLM.calls).toHaveLength(0);
  });

  test("una regla de tipo handoff: error escalado y la sesión no se toca", async () => {
    const ctx = await makeCtx();
    const intent = await ctx.intents.create({
      nombre: "reclamo",
      descripcion: "reclamos",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    await ctx.rules.create({
      intent_id: intent.id,
      condiciones_extra: null,
      respuesta_tipo: "handoff",
      respuesta_contenido: "Pasando a humano",
      prioridad: 0,
      activa: true,
    });
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: "reclamo", confidence: 0.9 });

    const r = await copilotoBorradorHandler(
      { borradorId: viejo, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    expect(r).toEqual({ estado: "error", motivo: "escalado" });
    expect((await ctx.borradores.findActualByConversacion(ctx.conv.id))?.error_codigo).toBe(
      "escalado",
    );
    expect((await ctx.sessions.findById(ctx.sesion.id))?.ia_pausada).toBe(false);
  });

  test("si el borrador deja de estar redactando durante respond, se omite como obsoleto y no queda listo", async () => {
    const ctx = await makeCtx();
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueue(async () => {
      // Llega otro mensaje y el pipeline descarta lo vigente mientras se redacta.
      await ctx.borradores.descartarVigentes(ctx.conv.id);
      return { text: "Texto que ya nadie necesita.", toolCalls: [] };
    });

    const r = await copilotoBorradorHandler(
      { borradorId: viejo, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    expect(r).toEqual({ estado: "omitido", motivo: "obsoleto" });
    expect(await ctx.borradores.findActualByConversacion(ctx.conv.id)).toBeNull();
  });

  test("un descuento por encima del tope queda en error descuento_excedido", async () => {
    const ctx = await makeCtx({ descuento_max_pct: 5 });
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Te hago un 20% de descuento.");

    const r = await copilotoBorradorHandler(
      { borradorId: viejo, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    expect(r).toEqual({ estado: "error", motivo: "descuento_excedido" });
    expect(await ctx.borradores.findActualByConversacion(ctx.conv.id)).toMatchObject({
      estado: "error",
      error_codigo: "descuento_excedido",
    });
  });

  test("si el borrador deja de estar redactando y el resultado era un error, marcarError devuelve null: se omite como obsoleto", async () => {
    const ctx = await makeCtx({ descuento_max_pct: 5 });
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueue(async () => {
      // Llega otro mensaje y el pipeline descarta lo vigente mientras se redacta.
      await ctx.borradores.descartarVigentes(ctx.conv.id);
      return { text: "Te hago un 20% de descuento.", toolCalls: [] };
    });

    const r = await copilotoBorradorHandler(
      { borradorId: viejo, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    // No es "error": el borrador ya no era de este pedido y no hay nada que marcar.
    expect(r).toEqual({ estado: "omitido", motivo: "obsoleto" });
    expect(await ctx.borradores.findActualByConversacion(ctx.conv.id)).toBeNull();
  });

  test("cada step lleva el id explícito que arma quien llama, sin repetirse", async () => {
    const ctx = await makeCtx();
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Texto.");
    const nombres: string[] = [];
    const step: StepRunner = {
      run: (nombre, fn) => {
        nombres.push(nombre);
        return fn();
      },
    };

    await copilotoBorradorHandler(
      { borradorId: viejo, conversacionId: ctx.conv.id },
      ctx.deps,
      step,
      (paso) => `copiloto-borrador-2026-09-30-${viejo}-${paso}`,
    );

    expect(nombres.length).toBeGreaterThanOrEqual(6);
    expect(nombres.every((n) => n.startsWith(`copiloto-borrador-2026-09-30-${viejo}-`))).toBe(true);
    expect(new Set(nombres).size).toBe(nombres.length);
  });
});
