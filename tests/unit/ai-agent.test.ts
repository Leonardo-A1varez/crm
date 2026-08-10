import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { DefaultAiAgentService } from "@/server/services/ai-agent.service";
import type { LeadSession, Intent } from "@/types/entities";
import type { IntentClassification } from "@/lib/validation/ai";
import { FakeAgentLLM } from "../mocks/llm";

async function seedSession(
  repo: InMemoryLeadSessionRepository,
  overrides: Partial<Omit<LeadSession, "id" | "started_at" | "closed_at">> = {},
): Promise<LeadSession> {
  return repo.create({
    lead_id: overrides.lead_id ?? crypto.randomUUID(),
    current_stage: overrides.current_stage ?? "nuevo",
    urgencia: overrides.urgencia ?? "media",
    consulta: overrides.consulta ?? "",
    producto_cotizado_id: null,
    codigo_interno: null,
    precio_cotizado: null,
    cantidad: null,
    bloqueador: null,
    comprobante_pago_url: null,
    metodo_pago: null,
    resultado: overrides.resultado ?? null,
    motivo_perdida: null,
    ia_pausada: overrides.ia_pausada ?? false,
  });
}

async function seedIntent(
  intents: InMemoryIntentsRepository,
  partial: Partial<Omit<Intent, "id">> & { nombre: string },
): Promise<Intent> {
  return intents.create({
    nombre: partial.nombre,
    descripcion: partial.descripcion ?? "",
    ejemplos: partial.ejemplos ?? [],
    auto_detectado: false,
    activo: partial.activo ?? true,
  });
}

function cls(intent_nombre: string | null): IntentClassification {
  return { intent_nombre, confidence: intent_nombre ? 0.9 : 0 };
}

describe("AiAgentService.respond", () => {
  let sessions: InMemoryLeadSessionRepository;
  let intents: InMemoryIntentsRepository;
  let rules: InMemoryRulesRepository;
  let productos: InMemoryProductsRepository;
  let llm: FakeAgentLLM;
  let svc: DefaultAiAgentService;

  beforeEach(() => {
    sessions = new InMemoryLeadSessionRepository();
    intents = new InMemoryIntentsRepository();
    rules = new InMemoryRulesRepository();
    productos = new InMemoryProductsRepository();
    llm = new FakeAgentLLM();
    svc = new DefaultAiAgentService(
      sessions,
      new DefaultRuleEngineService(intents, rules),
      new DefaultCatalogMatcherService(productos),
      llm,
    );
  });

  test("sesion inexistente lanza error", async () => {
    await expect(
      svc.respond({
        leadSessionId: "fake",
        conversationTurn: [],
        classification: cls(null),
      }),
    ).rejects.toThrow(/no encontrada/i);
  });

  test("sesion cerrada lanza error", async () => {
    const s = await seedSession(sessions);
    await sessions.close(s.id, { resultado: "exito" });

    await expect(
      svc.respond({
        leadSessionId: s.id,
        conversationTurn: [],
        classification: cls(null),
      }),
    ).rejects.toThrow(/cerrada/i);
  });

  test("ia_pausada retorna source=handoff sin invocar LLM", async () => {
    const s = await seedSession(sessions, { ia_pausada: true });

    const result = await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["hola"],
      classification: cls("saludo"),
    });

    expect(result.source).toBe("handoff");
    expect(result.respuesta_tipo).toBe("handoff");
    expect(result.respuesta_contenido).toMatch(/pausada/i);
    expect(llm.calls).toHaveLength(0);
  });

  test("rule match text retorna source=rule sin invocar LLM", async () => {
    const s = await seedSession(sessions, { current_stage: "nuevo" });
    const i = await seedIntent(intents, { nombre: "saludo" });
    const r = await rules.create({
      intent_id: i.id,
      condiciones_extra: null,
      respuesta_tipo: "text",
      respuesta_contenido: "Hola! ¿En qué te ayudo?",
      prioridad: 0,
      activa: true,
    });

    const result = await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["hola"],
      classification: cls("saludo"),
    });

    expect(result.source).toBe("rule");
    expect(result.respuesta_tipo).toBe("text");
    expect(result.respuesta_contenido).toBe("Hola! ¿En qué te ayudo?");
    expect(result.regla_id).toBe(r.id);
    expect(llm.calls).toHaveLength(0);
  });

  test("rule match handoff retorna source=handoff sin invocar LLM", async () => {
    const s = await seedSession(sessions);
    const i = await seedIntent(intents, { nombre: "obj_precio" });
    await rules.create({
      intent_id: i.id,
      condiciones_extra: null,
      respuesta_tipo: "handoff",
      respuesta_contenido: "Pasando a humano",
      prioridad: 0,
      activa: true,
    });

    const result = await svc.respond({
      leadSessionId: s.id,
      conversationTurn: [],
      classification: cls("obj_precio"),
    });

    expect(result.source).toBe("handoff");
    expect(result.respuesta_tipo).toBe("handoff");
    expect(result.respuesta_contenido).toBe("Pasando a humano");
    expect(llm.calls).toHaveLength(0);
  });

  test("sin rule match invoca LLM y retorna source=llm", async () => {
    const s = await seedSession(sessions);
    llm.enqueueText("Tenemos varias opciones. ¿Marca del auto?");

    const result = await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["necesito pastillas"],
      classification: cls(null),
    });

    expect(result.source).toBe("llm");
    expect(result.respuesta_tipo).toBe("text");
    expect(result.respuesta_contenido).toBe("Tenemos varias opciones. ¿Marca del auto?");
    expect(result.tool_calls).toEqual([]);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].session.id).toBe(s.id);
    expect(llm.calls[0].conversationTurn).toEqual(["necesito pastillas"]);
  });

  test("LLM puede invocar tool buscar_repuesto y registrar tool_calls", async () => {
    const s = await seedSession(sessions);
    await productos.create({
      codigo_interno: "PAS-001",
      sku_proveedor: null,
      nombre: "Pastilla freno",
      descripcion: null,
      categoria: null,
      compatibilidad: [],
      precio: 50,
      stock: 5,
      imagen_url: null,
      activo: true,
    });

    llm.enqueue(async (input) => {
      const out = await input.tools.buscar_repuesto({ query: "PAS-001" });
      return {
        text: `Encontré ${out.count} opción. Precio $${out.matches[0].precio}.`,
        toolCalls: [
          {
            name: "buscar_repuesto",
            args: { query: "PAS-001" },
            result: out as unknown as Record<string, unknown>,
          },
        ],
      };
    });

    const result = await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["tienes PAS-001?"],
      classification: cls(null),
    });

    expect(result.source).toBe("llm");
    expect(result.respuesta_contenido).toMatch(/1 opción/);
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls![0].name).toBe("buscar_repuesto");
    expect(result.tool_calls![0].args).toEqual({ query: "PAS-001" });
  });

  test("rule match con intent activo gana sobre LLM aunque classification confianza alta", async () => {
    const s = await seedSession(sessions);
    const i = await seedIntent(intents, { nombre: "saludo" });
    await rules.create({
      intent_id: i.id,
      condiciones_extra: null,
      respuesta_tipo: "text",
      respuesta_contenido: "Hola!",
      prioridad: 0,
      activa: true,
    });
    llm.enqueueText("LLM no deberia llamarse");

    const result = await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["hola"],
      classification: cls("saludo"),
    });

    expect(result.source).toBe("rule");
    expect(llm.calls).toHaveLength(0);
  });

  test("classification null pasa a LLM (sin intent identificado)", async () => {
    const s = await seedSession(sessions);
    llm.enqueueText("ok respondo libre");

    const result = await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["mensaje raro"],
      classification: cls(null),
    });

    expect(result.source).toBe("llm");
    expect(llm.calls).toHaveLength(1);
  });

  test("LLM input incluye session completa", async () => {
    const s = await seedSession(sessions, { current_stage: "cotizado", urgencia: "alta" });
    llm.enqueueText("ok");

    await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["x"],
      classification: cls(null),
    });

    expect(llm.calls[0].session.current_stage).toBe("cotizado");
    expect(llm.calls[0].session.urgencia).toBe("alta");
  });
});

describe("AiAgentService.respond — escalado §4.2", () => {
  let sessions: InMemoryLeadSessionRepository;
  let intents: InMemoryIntentsRepository;
  let rules: InMemoryRulesRepository;
  let productos: InMemoryProductsRepository;
  let llm: FakeAgentLLM;

  function armar(): DefaultAiAgentService {
    return new DefaultAiAgentService(
      sessions,
      new DefaultRuleEngineService(intents, rules),
      new DefaultCatalogMatcherService(productos),
      llm,
    );
  }

  beforeEach(() => {
    sessions = new InMemoryLeadSessionRepository();
    intents = new InMemoryIntentsRepository();
    rules = new InMemoryRulesRepository();
    productos = new InMemoryProductsRepository();
    llm = new FakeAgentLLM();
  });

  test("sin configAgente() el LLM mock no enciende nada: la config de fabrica no escala", async () => {
    const s = await seedSession(sessions);
    llm.enqueueText("respuesta normal");

    const result = await svc0(armar(), s.id, ["lead: voy a llamar a mi abogado"]);

    expect(result.source).toBe("llm");
  });

  test("una palabra de la lista pausa la IA y manda la sesion al triage", async () => {
    const s = await seedSession(sessions);
    llm.conConfig({ escalar_palabras: ["abogado"] });

    const result = await svc0(armar(), s.id, ["lead: voy a llamar a mi abogado"]);

    expect(result.source).toBe("handoff");
    expect(result.respuesta_contenido).toContain("abogado");
    expect(llm.calls).toHaveLength(0);

    const guardada = await sessions.findById(s.id);
    expect(guardada?.ia_pausada).toBe(true);
    expect(guardada?.current_stage).toBe("requiere_humano");
  });

  test("el escalado le gana a una regla IF/THEN que cubre el intent", async () => {
    const s = await seedSession(sessions);
    const i = await intents.create({
      nombre: "saludo",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    await rules.create({
      intent_id: i.id,
      condiciones_extra: null,
      respuesta_tipo: "text",
      respuesta_contenido: "Hola!",
      prioridad: 0,
      activa: true,
    });
    llm.conConfig({ escalar_palabras: ["reclamo"] });

    const result = await armar().respond({
      leadSessionId: s.id,
      conversationTurn: ["lead: hola, vengo a hacer un reclamo"],
      classification: cls("saludo"),
    });

    expect(result.source).toBe("handoff");
  });

  test("textoEntrante explicito gana sobre la ultima linea del turno", async () => {
    const s = await seedSession(sessions);
    llm.conConfig({ escalar_palabras: ["abogado"] });

    const result = await armar().respond({
      leadSessionId: s.id,
      // La ultima linea NO tiene la palabra; el texto entrante si.
      conversationTurn: ["lead: hola"],
      classification: cls(null),
      textoEntrante: "necesito un abogado",
    });

    expect(result.source).toBe("handoff");
  });

  test("un mensaje de la IA con la palabra no escala: solo cuenta lo que escribe el cliente", async () => {
    const s = await seedSession(sessions);
    llm.conConfig({ escalar_palabras: ["abogado"] });
    llm.enqueueText("respuesta normal");

    const result = await svc0(armar(), s.id, ["lead: hola", "ia: te paso con un abogado"]);

    expect(result.source).toBe("llm");
  });

  test("cotizacion sobre el tope escala en el turno siguiente", async () => {
    const s = await seedSession(sessions);
    await sessions.update(s.id, { precio_cotizado: 750_000 });
    llm.conConfig({ escalar_cotizacion_desde: 500_000 });

    const result = await svc0(armar(), s.id, ["lead: y si me lo dejas mas barato?"]);

    expect(result.source).toBe("handoff");
    expect(result.respuesta_contenido).toMatch(/750000|750\.000/);
    const guardada = await sessions.findById(s.id);
    expect(guardada?.ia_pausada).toBe(true);
  });

  test("cotizacion por debajo del tope sigue con el agente", async () => {
    const s = await seedSession(sessions);
    await sessions.update(s.id, { precio_cotizado: 120_000 });
    llm.conConfig({ escalar_cotizacion_desde: 500_000 });
    llm.enqueueText("te confirmo el precio");

    const result = await svc0(armar(), s.id, ["lead: dale"]);

    expect(result.source).toBe("llm");
  });

  test("la IA ya pausada no vuelve a escribir la sesion", async () => {
    const s = await seedSession(sessions, { ia_pausada: true });
    llm.conConfig({ escalar_palabras: ["abogado"] });

    const result = await svc0(armar(), s.id, ["lead: abogado"]);

    // Gana la guarda de ia_pausada, que va antes: el motivo es el manual.
    expect(result.respuesta_contenido).toMatch(/pausada/i);
  });
});

/** Atajo: `respond` con la clasificacion vacia, que es lo que no importa en estos casos. */
function svc0(svc: DefaultAiAgentService, leadSessionId: string, conversationTurn: string[]) {
  return svc.respond({ leadSessionId, conversationTurn, classification: cls(null) });
}
