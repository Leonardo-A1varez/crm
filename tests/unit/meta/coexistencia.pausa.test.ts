import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { PAUSA_POR_RESPUESTA_HUMANA_MIN } from "@/lib/coexistencia/pausa";
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
import type { EcoCoexistencia } from "@/lib/meta/parse-coexistencia";

const PHONE = "106540352242922";
const CLIENTE = "16505551234";
const MIN = 60_000;

let leads: InMemoryLeadsRepository;
let sessions: InMemoryLeadSessionRepository;
let handoffEvents: InMemoryHandoffEventsRepository;
let handoff: DefaultHandoffService;
let ahora: Date;
let svc: DefaultCoexistenciaService;

function eco(wamid: string, at: Date, cliente = CLIENTE): EcoCoexistencia {
  return {
    phone_number_id: PHONE,
    telefono_cliente: cliente,
    mensaje: {
      meta_message_id: wamid,
      direction: "out",
      tipo: "text",
      contenido: "Llega mañana",
      at,
    },
  };
}

async function sesionDelCliente() {
  const lead = await leads.findByTelefono(CLIENTE);
  return (await sessions.findActiveByLeadId(lead!.id))!;
}

beforeEach(async () => {
  const numeros = new InMemoryWhatsAppNumerosRepository();
  leads = new InMemoryLeadsRepository();
  sessions = new InMemoryLeadSessionRepository();
  handoffEvents = new InMemoryHandoffEventsRepository(sessions);
  handoff = new DefaultHandoffService(sessions, undefined, handoffEvents);
  const llavero = llaveroDesdeEnv({ META_TOKENS_CLAVE: randomBytes(32).toString("base64") });
  await numeros.conectar({
    waba_id: "102290129340398",
    phone_number_id: PHONE,
    display_phone_number: "+1 555-078-3881",
    verified_name: "Lucky Shrub",
    modo: "coexistencia",
    token_cifrado: cifrarToken("TOKEN", PHONE, llavero),
  });
  ahora = new Date("2026-10-11T15:00:00Z");
  svc = new DefaultCoexistenciaService({
    numeros,
    graph: { leerNumero: vi.fn(), pedirSincronizacion: vi.fn() },
    credenciales: new DefaultResolverCredencialesWhatsApp({
      repo: numeros,
      llavero: () => llavero,
      ttlMs: 0,
    }),
    leads,
    identificadores: new InMemoryLeadIdentificadoresRepository(),
    conversations: new InMemoryConversationsRepository(),
    sessions,
    messages: new InMemoryMessagesRepository(),
    handoff,
    handoffEvents,
    encolarDescargaMedia: async () => {},
    ahora: () => ahora,
  });
});

describe("pausarPorRespuestaDelNegocio", () => {
  test("el negocio contesta desde el teléfono: la IA de esa sesión se pausa 2 horas, sin avisarle al cliente", async () => {
    const e = eco("wamid.E1", ahora);
    await svc.registrarEco(e);

    const pausa = await svc.pausarPorRespuestaDelNegocio(e);

    const sesion = await sesionDelCliente();
    expect(pausa).toEqual({
      sesionId: sesion.id,
      ecoMetaMessageId: "wamid.E1",
      ecoAt: ahora,
      venceAt: new Date(ahora.getTime() + PAUSA_POR_RESPUESTA_HUMANA_MIN * MIN),
    });
    expect(PAUSA_POR_RESPUESTA_HUMANA_MIN).toBe(120);
    expect(sesion.ia_pausada).toBe(true);
    const eventos = await handoffEvents.listBySessionIds([sesion.id]);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      action: "pause",
      reason_code: "respuesta_desde_telefono",
      source: "sistema",
    });
  });

  test("un segundo eco con la sesión ya pausada por esa causa la extiende: sin otra pausa, con nuevo vencimiento", async () => {
    const e1 = eco("wamid.E1", ahora);
    const e2 = eco("wamid.E2", new Date(ahora.getTime() + 30 * MIN));
    await svc.registrarEco(e1);
    await svc.pausarPorRespuestaDelNegocio(e1);
    ahora = new Date(ahora.getTime() + 30 * MIN);
    await svc.registrarEco(e2);

    const pausa2 = await svc.pausarPorRespuestaDelNegocio(e2);

    expect(pausa2?.venceAt).toEqual(new Date(e2.mensaje.at!.getTime() + 120 * MIN));
    const sesion = await sesionDelCliente();
    expect(await handoffEvents.listBySessionIds([sesion.id])).toHaveLength(1);
  });

  test("si la sesión ya estaba pausada por otra causa (pausa manual), no la adopta ni programa nada", async () => {
    const e = eco("wamid.E1", ahora);
    await svc.registrarEco(e);
    const sesion = await sesionDelCliente();
    await handoff.pause({ sessionId: sesion.id, reasonCode: "manual_pause", source: "admin" });

    expect(await svc.pausarPorRespuestaDelNegocio(e)).toBeNull();
    const eventos = await handoffEvents.listBySessionIds([sesion.id]);
    expect(eventos.map((x) => x.reason_code)).toEqual(["manual_pause"]);
  });

  test("un eco cuya ventana ya pasó (webhook tardío) no pausa nada", async () => {
    const e = eco("wamid.VIEJO", new Date(ahora.getTime() - 3 * 60 * MIN));
    await svc.registrarEco(e);

    expect(await svc.pausarPorRespuestaDelNegocio(e)).toBeNull();
    expect((await sesionDelCliente()).ia_pausada).toBe(false);
  });

  test("reentrega del mismo eco después de 'Reactivar IA': no vuelve a pausar", async () => {
    const e = eco("wamid.E1", ahora);
    await svc.registrarEco(e);
    await svc.pausarPorRespuestaDelNegocio(e);
    const sesion = await sesionDelCliente();
    await handoff.resume({ sessionId: sesion.id });

    await svc.pausarPorRespuestaDelNegocio(e);

    expect((await sesionDelCliente()).ia_pausada).toBe(false);
  });

  test("lead sin sesión activa (sólo historial): el eco abre una sesión activa nueva y esa se pausa", async () => {
    const e = eco("wamid.E1", ahora);
    await svc.importarHistorial({
      phone_number_id: PHONE,
      fase: 0,
      chunk: 1,
      progreso: 100,
      omitidos: 0,
      hilos: [
        {
          telefono_cliente: CLIENTE,
          mensajes: [
            {
              meta_message_id: "wamid.H1",
              direction: "in",
              tipo: "text",
              contenido: "hola",
              at: new Date("2026-08-01T10:00:00Z"),
            },
          ],
        },
      ],
    });
    await svc.registrarEco(e);

    const pausa = await svc.pausarPorRespuestaDelNegocio(e);

    const lead = await leads.findByTelefono(CLIENTE);
    const todas = await sessions.listByLeadId(lead!.id);
    expect(todas).toHaveLength(2);
    expect(pausa?.sesionId).toBe((await sessions.findActiveByLeadId(lead!.id))!.id);
    expect((await sessions.findActiveByLeadId(lead!.id))!.ia_pausada).toBe(true);
  });

  test("cliente desconocido: nada que pausar", async () => {
    expect(await svc.pausarPorRespuestaDelNegocio(eco("wamid.X", ahora, "16509999999"))).toBeNull();
  });
});

describe("reanudarTrasRespuestaDelNegocio", () => {
  async function pausar(wamid: string, at: Date) {
    const e = eco(wamid, at);
    await svc.registrarEco(e);
    return (await svc.pausarPorRespuestaDelNegocio(e))!;
  }

  test("vencida la ventana y sin respuestas nuevas: reanuda la IA y deja el evento del sistema", async () => {
    const pausa = await pausar("wamid.E1", ahora);
    ahora = pausa.venceAt;

    expect(await svc.reanudarTrasRespuestaDelNegocio(pausa)).toBe("reanudada");

    const sesion = await sesionDelCliente();
    expect(sesion.ia_pausada).toBe(false);
    expect(sesion.current_stage).toBe("nuevo");
    const eventos = await handoffEvents.listBySessionIds([sesion.id]);
    expect(eventos.at(-1)).toMatchObject({
      action: "resume",
      reason_code: "reanudacion_automatica",
      source: "sistema",
    });
  });

  test("hubo otro eco después: el primer vencimiento no reanuda, el último sí", async () => {
    const p1 = await pausar("wamid.E1", ahora);
    ahora = new Date(ahora.getTime() + 30 * MIN);
    const p2 = await pausar("wamid.E2", ahora);

    ahora = p1.venceAt;
    expect(await svc.reanudarTrasRespuestaDelNegocio(p1)).toBe("extendida");
    expect((await sesionDelCliente()).ia_pausada).toBe(true);

    ahora = p2.venceAt;
    expect(await svc.reanudarTrasRespuestaDelNegocio(p2)).toBe("reanudada");
    expect((await sesionDelCliente()).ia_pausada).toBe(false);
  });

  test("'Reactivar IA' a mano antes del vencimiento: el vencimiento no hace nada", async () => {
    const pausa = await pausar("wamid.E1", ahora);
    const sesion = await sesionDelCliente();
    await handoff.resume({ sessionId: sesion.id });
    const antes = (await handoffEvents.listBySessionIds([sesion.id])).length;

    ahora = pausa.venceAt;
    expect(await svc.reanudarTrasRespuestaDelNegocio(pausa)).toBe("sin_cambio");
    expect(await handoffEvents.listBySessionIds([sesion.id])).toHaveLength(antes);
  });

  test("un humano reactivó y otra causa volvió a pausar: el vencimiento viejo no pisa esa pausa", async () => {
    const pausa = await pausar("wamid.E1", ahora);
    const sesion = await sesionDelCliente();
    await handoff.resume({ sessionId: sesion.id });
    await handoff.pause({
      sessionId: sesion.id,
      reasonCode: "discount_limit",
      source: "pipeline_guard",
    });

    ahora = pausa.venceAt;
    expect(await svc.reanudarTrasRespuestaDelNegocio(pausa)).toBe("sin_cambio");
    expect((await sesionDelCliente()).ia_pausada).toBe(true);
  });

  test("sesión cerrada mientras tanto: sin error, sin cambio", async () => {
    const pausa = await pausar("wamid.E1", ahora);
    await sessions.close(pausa.sesionId, { resultado: "exito" });

    ahora = pausa.venceAt;
    expect(await svc.reanudarTrasRespuestaDelNegocio(pausa)).toBe("sin_cambio");
  });

  test("reintento del mismo vencimiento: la segunda vez no hay nada que reanudar", async () => {
    const pausa = await pausar("wamid.E1", ahora);
    ahora = pausa.venceAt;
    expect(await svc.reanudarTrasRespuestaDelNegocio(pausa)).toBe("reanudada");
    expect(await svc.reanudarTrasRespuestaDelNegocio(pausa)).toBe("sin_cambio");
  });
});
