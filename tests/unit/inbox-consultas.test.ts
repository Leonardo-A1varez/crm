import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryLlmUsageRepository } from "@/server/repositories/llm-usage.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemorySessionRecordatoriosRepository } from "@/server/repositories/session-recordatorios.repo";
import { InMemoryLeadVehiculosRepository } from "@/server/repositories/lead-vehiculos.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultInboxService } from "@/server/services/inbox/default-inbox.service";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { WORKFLOW_LLM } from "@/types/domain";
import { reposAuditoria } from "../mocks/inbox-auditoria";
import { depsRecordatorios } from "../mocks/inbox-recordatorios";
import type { MensajeInsert } from "@/server/repositories/messages.repo";
import type { UUID } from "@/types/entities";

/**
 * Cuántas consultas cuesta cada pantalla del Inbox, y en cuántas idas y vueltas.
 *
 * Este archivo no prueba comportamiento: prueba **costo**. Existe porque
 * `listActiveLeads` llegó a hacer una consulta por lead dentro de un `for` y el
 * poller la re-ejecuta cada 5 segundos, y con las 2 conversaciones de dev eso no
 * se nota en ningún test funcional. Los números de abajo son la única barrera
 * contra que vuelva a pasar.
 *
 * Se miden dos cosas distintas y las dos importan:
 *
 * - **total**: cuántas veces se toca un repo. Es lo que se paga en la base.
 * - **olas**: cuántas de esas tandas van en serie. Es lo que se paga en
 *   latencia — dos consultas dentro de un `Promise.all` son una sola ola, y por
 *   eso una pantalla de 11 consultas puede tardar lo que 3.
 *
 * `ESCENA_LEADS` es 20 a propósito: con 1 o 2 filas un N+1 y una consulta en
 * tanda dan el mismo número y el test no distingue nada.
 */

const ESCENA_LEADS = 20;

type MetodoRepo = (...args: unknown[]) => Promise<unknown>;

interface Medicion {
  total: number;
  olas: number;
  detalle: Record<string, number>;
}

/**
 * Envuelve todos los métodos de los repos y cuenta.
 *
 * Envuelve **todos** y no una lista escrita a mano: una lista se queda vieja en
 * cuanto alguien mete un `findById` nuevo adentro del loop, que es exactamente
 * el defecto que esto tiene que atrapar.
 */
function medirConsultas(repos: Record<string, object>): () => Medicion {
  let total = 0;
  let olas = 0;
  let enVuelo = 0;
  const detalle: Record<string, number> = {};

  for (const [nombreRepo, repo] of Object.entries(repos)) {
    const objeto = repo as unknown as Record<string, MetodoRepo>;
    const proto = Object.getPrototypeOf(repo) as object;
    for (const metodo of Object.getOwnPropertyNames(proto)) {
      if (metodo === "constructor") continue;
      const original = objeto[metodo];
      if (typeof original !== "function") continue;
      const clave = `${nombreRepo}.${metodo}`;
      Object.defineProperty(repo, metodo, {
        configurable: true,
        writable: true,
        value: async (...args: unknown[]): Promise<unknown> => {
          total += 1;
          detalle[clave] = (detalle[clave] ?? 0) + 1;
          // Una ola arranca cuando no había nada en vuelo: lo que sale junto
          // dentro de un `Promise.all` cuenta como una sola ida y vuelta.
          enVuelo += 1;
          if (enVuelo === 1) olas += 1;
          try {
            return await original.apply(repo, args);
          } finally {
            enVuelo -= 1;
          }
        },
      });
    }
  }

  return () => ({ total, olas, detalle: { ...detalle } });
}

function msgInsert(
  conversacionId: UUID,
  sessionId: UUID,
  overrides: Partial<MensajeInsert> = {},
): MensajeInsert {
  return {
    conversacion_id: conversacionId,
    lead_session_id: sessionId,
    direction: "in",
    sender: "lead",
    sender_user_id: null,
    tipo: "text",
    contenido: "Hola",
    media_url: null,
    meta_message_id: null,
    idempotency_key: null,
    metadata: {},
    ...overrides,
  };
}

describe("Costo en consultas del Inbox", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let convs: InMemoryConversationsRepository;
  let messages: InMemoryMessagesRepository;
  let productos: InMemoryProductsRepository;
  let tags: InMemoryTagsRepository;
  let llmUsage: InMemoryLlmUsageRepository;
  let recordatorios: InMemorySessionRecordatoriosRepository;
  let svc: DefaultInboxService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    convs = new InMemoryConversationsRepository();
    messages = new InMemoryMessagesRepository();
    productos = new InMemoryProductsRepository();
    tags = new InMemoryTagsRepository();
    llmUsage = new InMemoryLlmUsageRepository();
    recordatorios = new InMemorySessionRecordatoriosRepository();
    svc = new DefaultInboxService({
      leads,
      sessions,
      convs,
      messages,
      vehiculos: new InMemoryLeadVehiculosRepository(),
      metaApi: new DefaultMetaApiService(convs, messages, {
        sendText: async () => {
          throw new Error("sendText no debe invocarse midiendo el read path");
        },
      }),
      handoff: new DefaultHandoffService(sessions),
      productos,
      tags,
      llmUsage,
      ...reposAuditoria(),
      ...depsRecordatorios(recordatorios),
    });
  });

  /** Un lead con sesión activa, dos hilos (WhatsApp e Instagram) y 3 mensajes. */
  async function sembrarLead(n: number): Promise<UUID> {
    const lead = await leads.create({
      nombre: `Lead ${n}`,
      telefono: `+5959810${String(n).padStart(5, "0")}`,
      email: null,
      direccion: null,
      vehiculo_marca: "Toyota",
      vehiculo_modelo: "Corolla",
      vehiculo_anio: 2018,
      vehiculo_motor: null,
      empresa_id: null,
      canal_origen: "wa",
      meta_user_ids: { wa: `wa-${n}` },
    });
    const session = await sessions.create({
      lead_id: lead.id,
      current_stage: "cotizado",
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
    const wa = await convs.create({
      lead_id: lead.id,
      canal: "wa",
      canal_thread_id: `wa-${n}`,
    });
    const ig = await convs.create({
      lead_id: lead.id,
      canal: "ig",
      canal_thread_id: `ig-${n}`,
    });
    await messages.create(msgInsert(wa.id, session.id, { contenido: "hola" }));
    await messages.create(
      msgInsert(wa.id, session.id, { direction: "out", sender: "ia", contenido: "hola!" }),
    );
    await messages.create(msgInsert(ig.id, session.id, { contenido: "sigo por acá" }));
    return lead.id;
  }

  test(`listActiveLeads con ${ESCENA_LEADS} leads no paga por lead`, async () => {
    for (let n = 0; n < ESCENA_LEADS; n += 1) await sembrarLead(n);

    const medir = medirConsultas({ leads, sessions, convs, messages, tags, recordatorios });
    const items = await svc.listActiveLeads();
    const { total, olas, detalle } = medir();

    expect(items).toHaveLength(ESCENA_LEADS);

    // ANTES (medido sobre 344d2c6): 102 consultas en 102 olas — todas en serie.
    // La cuenta era `2 + 3N + N*C` con N=20 leads y C=2 conversaciones:
    // `sessions.listActive` + `recordatorios.listPorAvisar` + por cada lead un
    // `leads.findById`, un `convs.findByLeadId`, un `messages.listBySessionId`
    // y un `messages.listByConversacion` por conversación.
    //
    // AHORA: 5 consultas en 2 olas, ninguna dentro de un loop. Lo importante no
    // es el 5: es que subir ESCENA_LEADS a 200 lo deja igual en 5.
    expect(total).toBe(5);
    expect(olas).toBe(2);

    // Nada que se llame una vez por fila. Si alguna de estas aparece, se metió
    // una consulta adentro del loop.
    expect(detalle["leads.findById"]).toBeUndefined();
    expect(detalle["convs.findByLeadId"]).toBeUndefined();
    expect(detalle["messages.listByConversacion"]).toBeUndefined();
    expect(detalle["messages.listBySessionId"]).toBeUndefined();
    expect(detalle["messages.listBySessionIds"]).toBeUndefined();
    expect(detalle["messages.listRecentBySessionIds"]).toBe(1);
  });

  test("el costo de listActiveLeads no se mueve al triplicar los leads", async () => {
    for (let n = 0; n < ESCENA_LEADS; n += 1) await sembrarLead(n);
    const medirChico = medirConsultas({ leads, sessions, convs, messages, tags, recordatorios });
    await svc.listActiveLeads();
    const chico = medirChico();

    for (let n = ESCENA_LEADS; n < ESCENA_LEADS * 3; n += 1) await sembrarLead(n);
    const medirGrande = medirConsultas({ leads, sessions, convs, messages, tags, recordatorios });
    await svc.listActiveLeads();
    const grande = medirGrande();

    // La afirmación que vale: el costo es del tamaño de la pantalla, no del
    // tamaño de la base.
    expect(grande.total).toBe(chico.total);
    expect(grande.olas).toBe(chico.olas);
  });

  test("getConversation lee la ficha entera sin encadenar consultas", async () => {
    const leadId = await sembrarLead(0);
    const producto = await productos.create({
      codigo_interno: "PF-1",
      sku_proveedor: null,
      nombre: "Pastilla de freno",
      descripcion: null,
      categoria: null,
      compatibilidad: [],
      precio: 120_000,
      stock: 3,
      activo: true,
      imagen_url: null,
    });
    const sesion = await sessions.findActiveByLeadId(leadId);
    await sessions.update(sesion!.id, { producto_cotizado_id: producto.id });
    const tag = await tags.create({ nombre: "mayorista", color: "#38BDF8", descripcion: null });
    await tags.assignToLead(leadId, tag.id, "manual", null);
    await llmUsage.create({
      lead_session_id: sesion!.id,
      mensaje_id: null,
      modelo: "gpt-4o-mini",
      input_tokens: 1200,
      output_tokens: 300,
      costo_usd: 0.004,
      workflow: WORKFLOW_LLM.agente,
    });
    await recordatorios.create({
      lead_session_id: sesion!.id,
      recordar_at: new Date(Date.now() + 48 * 60 * 60 * 1000),
      nota: "lo piensa",
      creado_por: null,
    });

    const medir = medirConsultas({
      leads,
      sessions,
      convs,
      messages,
      productos,
      tags,
      llmUsage,
      recordatorios,
    });
    const view = await svc.getConversation(leadId);
    const { total, olas } = medir();

    expect(view.producto?.id).toBe(producto.id);
    expect(view.gastoIa).toEqual({ estado: "medido", usd: 0.004, llamadas: 1 });
    expect(view.recordatorio).not.toBeNull();

    // ANTES (medido sobre 344d2c6): 11 consultas en 9 olas. El total nunca fue
    // el problema acá —no hay N+1, la ficha es de un solo lead— pero las 11
    // salían casi todas de a una: lead → sesión → conversaciones → mensajes →
    // producto → (tags) → sesiones previas → (gasto) → recordatorio.
    //
    // AHORA: las mismas 11 consultas en 2 olas. No se ahorra base, se ahorra
    // latencia: 2 idas y vueltas en vez de 9.
    expect(total).toBe(11);
    expect(olas).toBe(2);
  });

  test("contarRequierenAtencion es de costo fijo: el badge se pinta en las 7 pantallas", async () => {
    for (let n = 0; n < ESCENA_LEADS; n += 1) await sembrarLead(n);

    const medir = medirConsultas({ leads, sessions, convs, messages, tags, recordatorios });
    await svc.contarRequierenAtencion();

    expect(medir().total).toBe(2);
  });
});
