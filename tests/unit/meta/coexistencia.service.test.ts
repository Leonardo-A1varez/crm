import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { InfraError, RateLimitError, ValidationError } from "@/lib/errors";
import { cifrarToken, llaveroDesdeEnv } from "@/lib/meta/token-cifrado";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryHandoffEventsRepository } from "@/server/repositories/handoff-events.repo";
import { InMemoryLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryWhatsAppNumerosRepository } from "@/server/repositories/whatsapp-numeros.repo";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultCoexistenciaService } from "@/server/services/meta/coexistencia.service";
import { DefaultResolverCredencialesWhatsApp } from "@/server/services/meta/credenciales-whatsapp.service";
import type { GraphApiOnboarding } from "@/server/services/meta/graph-api-onboarding";

const PHONE = "106540352242922";
const CLIENTE = "16505551234";

function graphFalso() {
  return {
    leerNumero: vi.fn<GraphApiOnboarding["leerNumero"]>(async (id: string) => ({
      id,
      display_phone_number: "+1 555-078-3881",
      verified_name: "Lucky Shrub",
      is_on_biz_app: true,
      platform_type: "CLOUD_API",
    })),
    pedirSincronizacion: vi.fn(async (_id: string, _t: string, tipo: string) => `req-${tipo}`),
  } satisfies Pick<GraphApiOnboarding, "leerNumero" | "pedirSincronizacion">;
}

let numeros: InMemoryWhatsAppNumerosRepository;
let leads: InMemoryLeadsRepository;
let conversations: InMemoryConversationsRepository;
let sessions: InMemoryLeadSessionRepository;
let handoffEvents: InMemoryHandoffEventsRepository;
let messages: InMemoryMessagesRepository;
let graph: ReturnType<typeof graphFalso>;
let ahora: Date;
let svc: DefaultCoexistenciaService;

beforeEach(async () => {
  numeros = new InMemoryWhatsAppNumerosRepository();
  leads = new InMemoryLeadsRepository();
  conversations = new InMemoryConversationsRepository();
  sessions = new InMemoryLeadSessionRepository();
  handoffEvents = new InMemoryHandoffEventsRepository(sessions);
  messages = new InMemoryMessagesRepository();
  graph = graphFalso();
  const llavero = llaveroDesdeEnv({ META_TOKENS_CLAVE: randomBytes(32).toString("base64") });
  await numeros.conectar({
    waba_id: "102290129340398",
    phone_number_id: PHONE,
    display_phone_number: "+1 555-078-3881",
    verified_name: "Lucky Shrub",
    modo: "coexistencia",
    token_cifrado: cifrarToken("TOKEN", PHONE, llavero),
  });
  ahora = new Date(Date.now() + 60_000);
  svc = new DefaultCoexistenciaService({
    numeros,
    graph,
    credenciales: new DefaultResolverCredencialesWhatsApp({
      repo: numeros,
      llavero: () => llavero,
      ttlMs: 0,
    }),
    leads,
    identificadores: new InMemoryLeadIdentificadoresRepository(),
    conversations,
    sessions,
    messages,
    handoff: new DefaultHandoffService(sessions, undefined, handoffEvents),
    handoffEvents,
    ahora: () => ahora,
  });
});

describe("sincronizarAlConectar", () => {
  test("verifica la coexistencia y pide contactos y después historial, una vez cada uno", async () => {
    const r = await svc.sincronizarAlConectar(PHONE);
    expect(r).toEqual({ verificado: true, contactos: "pedido", historial: "pedido" });
    expect(graph.pedirSincronizacion.mock.calls.map((c) => c[2])).toEqual([
      "smb_app_state_sync",
      "history",
    ]);
    const fila = await numeros.buscar(PHONE);
    expect(fila).toMatchObject({
      is_on_biz_app: true,
      platform_type: "CLOUD_API",
      historial_estado: "pedido",
    });
    expect(fila?.contactos_sincronizados_at).not.toBeNull();
  });

  test("reintento (o evento repetido): no vuelve a pedir lo que ya se pidió", async () => {
    await svc.sincronizarAlConectar(PHONE);
    const r = await svc.sincronizarAlConectar(PHONE);
    expect(r).toMatchObject({ contactos: "ya_pedido", historial: "ya_pedido" });
    expect(graph.pedirSincronizacion).toHaveBeenCalledTimes(2);
  });

  test("429 de Meta: libera la reserva y propaga para que Inngest reintente", async () => {
    graph.pedirSincronizacion.mockRejectedValueOnce(new RateLimitError("rate", "meta"));
    await expect(svc.sincronizarAlConectar(PHONE)).rejects.toBeInstanceOf(RateLimitError);
    expect((await numeros.buscar(PHONE))?.contactos_pedido_at).toBeNull();
    const r = await svc.sincronizarAlConectar(PHONE);
    expect(r.contactos).toBe("pedido");
  });

  test("Meta rechaza el historial (400): queda en error, visible, sin reintentar", async () => {
    graph.pedirSincronizacion
      .mockResolvedValueOnce("req-contactos")
      .mockRejectedValueOnce(new ValidationError("Meta invalid request: ya sincronizado"));
    const r = await svc.sincronizarAlConectar(PHONE);
    expect(r.historial).toBe("error");
    const fila = await numeros.buscar(PHONE);
    expect(fila?.historial_estado).toBe("error");
    expect(fila?.error).toContain("historial");
    expect(fila?.historial_pedido_at).not.toBeNull();
  });

  test("sin respuesta de Meta (red/5xx): desenlace desconocido, no se vuelve a pedir", async () => {
    graph.pedirSincronizacion.mockRejectedValueOnce(new InfraError("caido", "meta"));
    const r = await svc.sincronizarAlConectar(PHONE);
    expect(r.contactos).toBe("error");
    expect((await numeros.buscar(PHONE))?.contactos_pedido_at).not.toBeNull();
  });

  test("pasadas las 24 h de la conexión no se pide nada: historial vencido", async () => {
    ahora = new Date(Date.now() + 25 * 3600_000);
    const r = await svc.sincronizarAlConectar(PHONE);
    expect(r).toMatchObject({ contactos: "vencido", historial: "vencido" });
    expect(graph.pedirSincronizacion).not.toHaveBeenCalled();
    expect((await numeros.buscar(PHONE))?.historial_estado).toBe("vencido");
  });

  test("un número que Meta no confirma en la app Business: avisa y no sincroniza", async () => {
    graph.leerNumero.mockResolvedValueOnce({
      id: PHONE,
      display_phone_number: null,
      verified_name: null,
      is_on_biz_app: false,
      platform_type: "CLOUD_API",
    });
    const r = await svc.sincronizarAlConectar(PHONE);
    expect(r).toMatchObject({ verificado: false, contactos: "omitido", historial: "omitido" });
    expect(graph.pedirSincronizacion).not.toHaveBeenCalled();
    expect((await numeros.buscar(PHONE))?.error).toContain("is_on_biz_app");
  });
});

describe("importarContactos", () => {
  test("crea el lead con el nombre de la agenda; a uno existente sólo le llena el nombre vacío", async () => {
    const editado = await leads.create({
      nombre: "Juan (editado por el vendedor)",
      telefono: "16505550001",
      email: null,
      direccion: null,
      vehiculo_marca: null,
      vehiculo_modelo: null,
      vehiculo_anio: null,
      vehiculo_motor: null,
      empresa_id: null,
      canal_origen: "wa",
      meta_user_ids: { wa: "16505550001" },
    });
    const sinNombre = await leads.create({ ...editado, nombre: "", telefono: "16505550002" });

    const r = await svc.importarContactos([
      { phone_number_id: PHONE, telefono: "16505550001", nombre: "Juan Agenda", accion: "add" },
      { phone_number_id: PHONE, telefono: "16505550002", nombre: "Ana Agenda", accion: "add" },
      { phone_number_id: PHONE, telefono: "16505550003", nombre: "Nuevo", accion: "add" },
      { phone_number_id: PHONE, telefono: "16505550004", nombre: "Borrado", accion: "remove" },
    ]);

    expect(r).toEqual({ creados: 1, nombrados: 1, sinCambios: 1, ignorados: 1 });
    expect((await leads.findById(editado.id))?.nombre).toBe("Juan (editado por el vendedor)");
    expect((await leads.findById(sinNombre.id))?.nombre).toBe("Ana Agenda");
    expect((await leads.findByTelefono("16505550003"))?.nombre).toBe("Nuevo");
    expect(await leads.findByTelefono("16505550004")).toBeNull();
  });

  test("repetir el mismo lote no crea duplicados", async () => {
    const lote = [{ phone_number_id: PHONE, telefono: "16505550009", nombre: "X", accion: "add" }];
    await svc.importarContactos(lote);
    const r = await svc.importarContactos(lote);
    expect(r.creados).toBe(0);
    expect((await leads.list()).filter((l) => l.telefono === "16505550009")).toHaveLength(1);
  });
});

describe("importarHistorial", () => {
  const lote = {
    phone_number_id: PHONE,
    fase: 0,
    chunk: 1,
    progreso: 55,
    omitidos: 0,
    hilos: [
      {
        telefono_cliente: CLIENTE,
        mensajes: [
          {
            meta_message_id: "wamid.H1",
            direction: "out" as const,
            tipo: "text" as const,
            contenido: "Te paso el precio",
            at: new Date("2025-02-10T23:42:35Z"),
          },
          {
            meta_message_id: "wamid.H2",
            direction: "in" as const,
            tipo: "text" as const,
            contenido: "Gracias",
            at: new Date("2025-02-10T23:42:50Z"),
          },
        ],
      },
    ],
  };

  test("importa entrantes y salientes con su hora real, en la conversación del número", async () => {
    const r = await svc.importarHistorial(lote);
    expect(r).toEqual({ importados: 2, repetidos: 0 });

    const conv = await conversations.findByCanalThread("wa", CLIENTE);
    expect(conv?.whatsapp_phone_number_id).toBe(PHONE);
    expect(conv?.ultima_actividad_at.toISOString()).toBe("2025-02-10T23:42:50.000Z");
    const m1 = await messages.findByMetaMessageId("wamid.H1");
    expect(m1).toMatchObject({ direction: "out", sender: "humano", sender_user_id: null });
    expect(m1?.created_at.toISOString()).toBe("2025-02-10T23:42:35.000Z");
    expect(m1?.metadata.origen).toBe("historial_app_business");
    const m2 = await messages.findByMetaMessageId("wamid.H2");
    expect(m2).toMatchObject({ direction: "in", sender: "lead" });
    expect((await numeros.buscar(PHONE))?.historial_progreso).toBe(55);
  });

  test("idempotente por wamid: el mismo lote reentregado no duplica nada", async () => {
    await svc.importarHistorial(lote);
    const r = await svc.importarHistorial(lote);
    expect(r).toEqual({ importados: 0, repetidos: 2 });
    const conv = await conversations.findByCanalThread("wa", CLIENTE);
    expect(await messages.listByConversacion(conv!.id)).toHaveLength(2);
  });

  test("va a una sesión CERRADA e importada: no queda ninguna sesión activa en el Inbox", async () => {
    await svc.importarHistorial(lote);

    const lead = await leads.findByTelefono(CLIENTE);
    expect(await sessions.findActiveByLeadId(lead!.id)).toBeNull();
    expect(await sessions.listActive()).toEqual([]);
    const todas = await sessions.listByLeadId(lead!.id);
    expect(todas).toHaveLength(1);
    expect(todas[0]).toMatchObject({
      resultado: "perdido",
      motivo_perdida: null,
      current_stage: "perdido",
      ia_pausada: false,
      extras: { importado_historial: true },
    });
    // Se cierra a la hora del último mensaje importado, no al momento de importar.
    expect(todas[0]?.closed_at?.toISOString()).toBe("2025-02-10T23:42:50.000Z");
    const m1 = await messages.findByMetaMessageId("wamid.H1");
    expect(m1?.lead_session_id).toBe(todas[0]?.id);
  });

  test("reentrega y lotes siguientes del mismo cliente reusan la misma sesión importada", async () => {
    await svc.importarHistorial(lote);
    await svc.importarHistorial(lote);
    await svc.importarHistorial({
      ...lote,
      fase: 1,
      chunk: 2,
      hilos: [
        {
          telefono_cliente: CLIENTE,
          mensajes: [
            {
              meta_message_id: "wamid.H0",
              direction: "in" as const,
              tipo: "text" as const,
              contenido: "Hola, precio?",
              at: new Date("2025-01-05T12:00:00Z"),
            },
          ],
        },
      ],
    });

    const lead = await leads.findByTelefono(CLIENTE);
    const todas = await sessions.listByLeadId(lead!.id);
    expect(todas).toHaveLength(1);
    expect(await messages.listBySessionId(todas[0]!.id)).toHaveLength(3);
    expect(await sessions.listActive()).toEqual([]);
  });

  test("un cliente con sesión activa (escribió hace poco): el historial no la toca", async () => {
    const lead = await leads.create({
      nombre: "",
      telefono: CLIENTE,
      email: null,
      direccion: null,
      vehiculo_marca: null,
      vehiculo_modelo: null,
      vehiculo_anio: null,
      vehiculo_motor: null,
      empresa_id: null,
      canal_origen: "wa",
      meta_user_ids: { wa: CLIENTE },
    });
    const activa = await sessions.create({
      lead_id: lead.id,
      current_stage: "cotizado",
      urgencia: "media",
      consulta: "pastillas",
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

    await svc.importarHistorial(lote);

    expect((await sessions.findActiveByLeadId(lead.id))?.id).toBe(activa.id);
    expect(await messages.listBySessionId(activa.id)).toEqual([]);
    expect(await sessions.listByLeadId(lead.id)).toHaveLength(2);
  });

  test("progreso 100 deja el historial completo y un lote tardío no lo pisa", async () => {
    await svc.importarHistorial({ ...lote, progreso: 100 });
    await svc.importarHistorial({ ...lote, fase: 1, progreso: 40 });
    expect((await numeros.buscar(PHONE))?.historial_estado).toBe("completo");
  });

  test("no le pisa el número a una conversación que ya tenía otro ni le atrasa la actividad", async () => {
    const lead = await leads.create({
      nombre: "",
      telefono: CLIENTE,
      email: null,
      direccion: null,
      vehiculo_marca: null,
      vehiculo_modelo: null,
      vehiculo_anio: null,
      vehiculo_motor: null,
      empresa_id: null,
      canal_origen: "wa",
      meta_user_ids: { wa: CLIENTE },
    });
    const viva = await conversations.create({
      lead_id: lead.id,
      canal: "wa",
      canal_thread_id: CLIENTE,
      whatsapp_phone_number_id: "100000000000001",
    });
    const antes = viva.ultima_actividad_at.getTime();
    await svc.importarHistorial(lote);
    const despues = await conversations.findById(viva.id);
    expect(despues?.whatsapp_phone_number_id).toBe("100000000000001");
    expect(despues?.ultima_actividad_at.getTime()).toBe(antes);
  });
});

describe("historialRechazado", () => {
  test("2593109: el negocio no compartió el historial", async () => {
    await svc.historialRechazado({ phone_number_id: PHONE, codigo: 2593109 });
    expect((await numeros.buscar(PHONE))?.historial_estado).toBe("rechazado");
  });
});

describe("registrarEco", () => {
  test("lo que el negocio mandó desde la app entra como saliente humano, una sola vez", async () => {
    const eco = {
      phone_number_id: PHONE,
      telefono_cliente: CLIENTE,
      mensaje: {
        meta_message_id: "wamid.ECO",
        direction: "out" as const,
        tipo: "text" as const,
        contenido: "Llega mañana",
        at: new Date(),
      },
    };
    expect(await svc.registrarEco(eco)).toBe("registrado");
    expect(await svc.registrarEco(eco)).toBe("repetido");
    const m = await messages.findByMetaMessageId("wamid.ECO");
    expect(m).toMatchObject({
      direction: "out",
      sender: "humano",
      contenido: "Llega mañana",
      metadata: { origen: "eco_app_business" },
    });
    expect((await conversations.findByCanalThread("wa", CLIENTE))?.whatsapp_phone_number_id).toBe(
      PHONE,
    );
  });
});
