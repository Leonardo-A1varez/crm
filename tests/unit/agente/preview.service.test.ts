import { beforeEach, describe, expect, test, vi } from "vitest";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { NotFoundError } from "@/lib/errors";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import {
  InMemoryMessagesRepository,
  type MensajeInsert,
} from "@/server/repositories/messages.repo";
import type { AgentConfigProvider } from "@/server/services/agente/config-provider";
import { DefaultAgentePreviewService } from "@/server/services/agente/preview.service";
import type { AgentLLM, AgentLLMInput, AgentLLMResult } from "@/server/services/ai-agent.service";
import type { CatalogMatcherService } from "@/server/services/catalog-matcher.service";
import type { AgenteConfigValores } from "@/types/agente";
import type { LeadSession } from "@/types/entities";

function valores(patch: Partial<AgenteConfigValores> = {}): AgenteConfigValores {
  return { ...CONFIG_DE_FABRICA, ...patch };
}

function baseMensaje(overrides: Partial<MensajeInsert> = {}): MensajeInsert {
  return {
    conversacion_id: "conv-1",
    lead_session_id: "session-1",
    direction: "in",
    sender: "lead",
    sender_user_id: null,
    tipo: "text",
    contenido: "hola",
    media_url: null,
    meta_message_id: null,
    idempotency_key: null,
    metadata: {},
    ...overrides,
  };
}

/** Catalog falso: cuenta invocaciones sin tocar ningún repo real. */
function catalogFalso(): CatalogMatcherService & { llamadas: number } {
  return {
    llamadas: 0,
    async buscar(_input) {
      this.llamadas++;
      return { matches: [], count: 0 };
    },
  };
}

/** LLM falso: captura el input recibido y el configProvider con el que se construyó. */
function makeLlmFactory(respuesta: string): {
  capturado: { input?: AgentLLMInput; provider?: AgentConfigProvider };
  makeLlm: (configProvider: AgentConfigProvider) => AgentLLM;
} {
  const capturado: { input?: AgentLLMInput; provider?: AgentConfigProvider } = {};
  const makeLlm = (configProvider: AgentConfigProvider): AgentLLM => {
    capturado.provider = configProvider;
    return {
      async generate(input: AgentLLMInput): Promise<AgentLLMResult> {
        capturado.input = input;
        return { text: respuesta, toolCalls: [] };
      },
    };
  };
  return { capturado, makeLlm };
}

/** Sesión CERRADA (resultado != null): la clase de sesión que tiene sentido previsualizar. */
async function crearSesion(sessions: InMemoryLeadSessionRepository): Promise<LeadSession> {
  return sessions.create({
    lead_id: "00000000-0000-0000-0000-0000000000b1",
    current_stage: "identificando",
    urgencia: "media",
    consulta: "pastilla de freno",
    producto_cotizado_id: null,
    codigo_interno: null,
    precio_cotizado: null,
    cantidad: null,
    bloqueador: null,
    comprobante_pago_url: null,
    metodo_pago: null,
    resultado: "exito",
    motivo_perdida: null,
    ia_pausada: false,
  });
}

describe("DefaultAgentePreviewService", () => {
  let sessions: InMemoryLeadSessionRepository;
  let messages: InMemoryMessagesRepository;
  let catalog: ReturnType<typeof catalogFalso>;

  beforeEach(() => {
    sessions = new InMemoryLeadSessionRepository();
    messages = new InMemoryMessagesRepository();
    catalog = catalogFalso();
  });

  test("lanza NotFoundError si la sesión no existe", async () => {
    const { makeLlm } = makeLlmFactory("no debería llegar acá");
    const service = new DefaultAgentePreviewService(sessions, messages, catalog, makeLlm);

    await expect(
      service.previsualizar({ valores: valores(), leadSessionId: "no-existe" }),
    ).rejects.toThrow(NotFoundError);
  });

  test("arma conversationTurn con los últimos N mensajes según ventana_contexto_mensajes", async () => {
    const session = await crearSesion(sessions);
    for (let i = 0; i < 5; i++) {
      await messages.create(
        baseMensaje({
          lead_session_id: session.id,
          direction: i % 2 === 0 ? "in" : "out",
          sender: i % 2 === 0 ? "lead" : "ia",
          contenido: `mensaje-${i}`,
        }),
      );
    }
    const { capturado, makeLlm } = makeLlmFactory("respuesta candidata");
    const service = new DefaultAgentePreviewService(sessions, messages, catalog, makeLlm);

    await service.previsualizar({
      valores: valores({ ventana_contexto_mensajes: 2 }),
      leadSessionId: session.id,
    });

    // Solo los últimos 2 de los 5 mensajes, formateados "sender: contenido".
    expect(capturado.input?.conversationTurn).toEqual(["ia: mensaje-3", "lead: mensaje-4"]);
  });

  test("antepone el resumen previo cuando la sesión tiene context_summary", async () => {
    const session = await crearSesion(sessions);
    await sessions.update(session.id, { context_summary: "cliente busca pastillas" });
    await messages.create(baseMensaje({ lead_session_id: session.id, contenido: "hola" }));

    const { capturado, makeLlm } = makeLlmFactory("ok");
    const service = new DefaultAgentePreviewService(sessions, messages, catalog, makeLlm);

    await service.previsualizar({ valores: valores(), leadSessionId: session.id });

    expect(capturado.input?.conversationTurn[0]).toBe("[Resumen previo]: cliente busca pastillas");
  });

  test("respuestaOriginal es el último saliente de la IA, ignorando mensajes posteriores del lead", async () => {
    const session = await crearSesion(sessions);
    await messages.create(
      baseMensaje({
        lead_session_id: session.id,
        direction: "in",
        sender: "lead",
        contenido: "hola",
      }),
    );
    await messages.create(
      baseMensaje({
        lead_session_id: session.id,
        direction: "out",
        sender: "ia",
        contenido: "el saliente real",
      }),
    );
    // El cliente sigue hablando después, sin que la IA vuelva a responder
    // (sesión cerrada con el último mensaje del lead sin contestar).
    await messages.create(
      baseMensaje({
        lead_session_id: session.id,
        direction: "in",
        sender: "lead",
        contenido: "gracias",
      }),
    );

    const { makeLlm } = makeLlmFactory("candidata");
    const service = new DefaultAgentePreviewService(sessions, messages, catalog, makeLlm);

    const resultado = await service.previsualizar({
      valores: valores(),
      leadSessionId: session.id,
    });
    expect(resultado.respuestaOriginal).toBe("el saliente real");
    expect(resultado.respuesta).toBe("candidata");
  });

  test("respuestaOriginal es null cuando la sesión no tiene ningún saliente de la IA", async () => {
    const session = await crearSesion(sessions);
    await messages.create(
      baseMensaje({ lead_session_id: session.id, direction: "in", sender: "lead" }),
    );

    const { makeLlm } = makeLlmFactory("candidata");
    const service = new DefaultAgentePreviewService(sessions, messages, catalog, makeLlm);

    const resultado = await service.previsualizar({
      valores: valores(),
      leadSessionId: session.id,
    });
    expect(resultado.respuestaOriginal).toBeNull();
  });

  test("construye el LLM con un StaticAgentConfigProvider de la config candidata, no la activa", async () => {
    const session = await crearSesion(sessions);
    await messages.create(baseMensaje({ lead_session_id: session.id }));

    const { capturado, makeLlm } = makeLlmFactory("ok");
    const service = new DefaultAgentePreviewService(sessions, messages, catalog, makeLlm);

    const candidata = valores({ modelo: "gpt-4.1-mini", instrucciones: "Solo Toyota." });
    await service.previsualizar({ valores: candidata, leadSessionId: session.id });

    await expect(capturado.provider?.get()).resolves.toEqual(candidata);
  });

  test("classification es neutra: el preview no ejecuta una segunda llamada al clasificador", async () => {
    const session = await crearSesion(sessions);
    await messages.create(baseMensaje({ lead_session_id: session.id }));

    const { capturado, makeLlm } = makeLlmFactory("ok");
    const service = new DefaultAgentePreviewService(sessions, messages, catalog, makeLlm);

    await service.previsualizar({ valores: valores(), leadSessionId: session.id });

    expect(capturado.input?.classification).toEqual({ intent_nombre: null, confidence: 0 });
  });

  test("tools.buscar_repuesto delega al catalog matcher real inyectado", async () => {
    const session = await crearSesion(sessions);
    await messages.create(baseMensaje({ lead_session_id: session.id }));

    const { capturado, makeLlm } = makeLlmFactory("ok");
    const service = new DefaultAgentePreviewService(sessions, messages, catalog, makeLlm);

    await service.previsualizar({ valores: valores(), leadSessionId: session.id });

    await capturado.input?.tools.buscar_repuesto({ query: "pastilla" });
    expect(catalog.llamadas).toBe(1);
  });

  test("no escribe mensajes ni modifica la sesión: solo lecturas", async () => {
    const session = await crearSesion(sessions);
    await messages.create(baseMensaje({ lead_session_id: session.id }));

    const createSpy = vi.spyOn(messages, "create");
    const updateSpy = vi.spyOn(sessions, "update");

    const { makeLlm } = makeLlmFactory("ok");
    const service = new DefaultAgentePreviewService(sessions, messages, catalog, makeLlm);
    await service.previsualizar({ valores: valores(), leadSessionId: session.id });

    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
