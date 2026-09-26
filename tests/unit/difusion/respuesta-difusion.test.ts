import { describe, expect, test } from "vitest";
import {
  CLAVE_DIFUSION_RESPONDIDA,
  VENTANA_ATRIBUCION_DIAS,
  difusionRespondidaDe,
} from "@/lib/difusion/respuesta";
import type { Grupo } from "@/lib/ui/condiciones";
import { InMemoryDifusionEnviosRepository } from "@/server/repositories/difusion-envios.repo";
import { InMemoryDifusionesRepository } from "@/server/repositories/difusiones.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { DefaultRespuestaDifusionService } from "@/server/services/difusion/respuesta.service";
import type { UUID } from "@/types/entities";

const AHORA = new Date("2026-09-25T15:00:00.000Z");
const HORA = 3_600_000;
const LEAD = "00000000-0000-4000-8000-000000000001";
const OTRO = "00000000-0000-4000-8000-000000000002";
const CONV = "00000000-0000-4000-8000-00000000c001";
const ARBOL: Grupo = { id: "raiz", clase: "grupo", operador: "y", hijos: [] };

async function armar() {
  const difusiones = new InMemoryDifusionesRepository();
  const envios = new InMemoryDifusionEnviosRepository();
  const messages = new InMemoryMessagesRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const servicio = new DefaultRespuestaDifusionService({ envios, difusiones, messages, sessions });

  const d = await difusiones.create({
    nombre: "Promo frenos",
    audiencia: ARBOL,
    creada_por: null,
    plantilla_nombre: "promo_frenos_v3",
    plantilla_categoria: "marketing",
    plantilla_idioma: "es_AR",
    plantilla_parametros: [],
    canary_tamano: null,
  });

  /** Un envío de esa difusión que salió a `lead` a la hora `at`. */
  async function salio(
    lead: UUID,
    at: Date,
    wamid: string,
    telefono = "593990000001",
    comoTextoLibre = false,
  ) {
    await envios.registrarPlan([
      {
        difusion_id: d.id,
        lead_id: lead,
        telefono,
        estado: "en_cola",
        motivo_exclusion: null,
        ruta: comoTextoLibre ? "ventana_abierta" : "plantilla",
        tanda: 0,
        programado_para: at,
      },
    ]);
    const [e] = await envios.pendientesParaEnviar(d.id, at, 1);
    await envios.reservar(
      e!.id,
      at,
      comoTextoLibre ? { ruta: "ventana_abierta", contenido: "texto_libre" } : undefined,
    );
    return envios.marcarAceptado(e!.id, wamid);
  }

  async function sesion(lead: UUID = LEAD) {
    return sessions.create({
      lead_id: lead,
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
  }

  return { servicio, difusiones, envios, messages, sessions, d, salio, sesion };
}

describe("RespuestaDifusion — la primera respuesta deja la plantilla en el hilo", () => {
  test("registra la plantilla en la sesión, con la hora en que salió y su wamid", async () => {
    const m = await armar();
    const envio = await m.salio(LEAD, new Date(AHORA.getTime() - 2 * HORA), "wamid.d1");
    const s = await m.sesion();

    const r = await m.servicio.registrar({
      leadId: LEAD,
      conversacionId: CONV,
      leadSessionId: s.id,
      ahora: AHORA,
      entranteMetaMessageId: "wamid.in-1",
    });

    expect(r).toMatchObject({ difusionId: m.d.id, envioId: envio.id });
    const msg = await m.messages.findByMetaMessageId("wamid.d1");
    expect(msg).toMatchObject({
      conversacion_id: CONV,
      lead_session_id: s.id,
      direction: "out",
      sender: "sistema",
      tipo: "template",
      contenido: "Difusión «Promo frenos» · plantilla «promo_frenos_v3»",
      metadata: {
        difusion: {
          difusion_id: m.d.id,
          envio_id: envio.id,
          plantilla: "promo_frenos_v3",
          idioma: "es_AR",
        },
      },
    });
    expect(msg?.created_at.toISOString()).toBe(new Date(AHORA.getTime() - 2 * HORA).toISOString());
  });

  test("deja en la sesión a qué difusión respondió: lo leen el Twin y el agente", async () => {
    const m = await armar();
    await m.salio(LEAD, new Date(AHORA.getTime() - HORA), "wamid.d1");
    const s = await m.sesion();

    await m.servicio.registrar({
      leadId: LEAD,
      conversacionId: CONV,
      leadSessionId: s.id,
      ahora: AHORA,
      entranteMetaMessageId: "wamid.in-1",
    });

    const actual = await m.sessions.findById(s.id);
    expect(actual?.extras[CLAVE_DIFUSION_RESPONDIDA]).toBe(
      "«Promo frenos» · plantilla «promo_frenos_v3»",
    );
    expect(difusionRespondidaDe(actual!.extras)).toBe(
      "«Promo frenos» · plantilla «promo_frenos_v3»",
    );
  });

  test("conserva los otros extras de la sesión", async () => {
    const m = await armar();
    await m.salio(LEAD, new Date(AHORA.getTime() - HORA), "wamid.d1");
    const s = await m.sesion();
    await m.sessions.update(s.id, { extras: { forma_de_pago: "transferencia" } });

    await m.servicio.registrar({
      leadId: LEAD,
      conversacionId: CONV,
      leadSessionId: s.id,
      ahora: AHORA,
      entranteMetaMessageId: "wamid.in-1",
    });

    expect((await m.sessions.findById(s.id))?.extras.forma_de_pago).toBe("transferencia");
  });

  test("repetirlo (reintento del step) no duplica nada", async () => {
    const m = await armar();
    await m.salio(LEAD, new Date(AHORA.getTime() - HORA), "wamid.d1");
    const s = await m.sesion();
    const input = {
      leadId: LEAD,
      conversacionId: CONV,
      leadSessionId: s.id,
      ahora: AHORA,
      entranteMetaMessageId: "wamid.in-1",
    };

    const primero = await m.servicio.registrar(input);
    const segundo = await m.servicio.registrar(input);

    expect(segundo).toEqual(primero);
    expect(await m.messages.listBySessionId(s.id)).toHaveLength(1);
  });

  test("si la plantilla ya está en el hilo de OTRA sesión, esta respuesta no es a la difusión", async () => {
    const m = await armar();
    await m.salio(LEAD, new Date(AHORA.getTime() - 3 * 24 * HORA), "wamid.d1");
    const vieja = await m.sesion();
    await m.servicio.registrar({
      leadId: LEAD,
      conversacionId: CONV,
      leadSessionId: vieja.id,
      ahora: new Date(AHORA.getTime() - 2 * 24 * HORA),
      entranteMetaMessageId: "wamid.in-0",
    });
    await m.sessions.close(vieja.id, { resultado: "perdido", motivo_perdida: "precio" });
    const nueva = await m.sesion();

    const r = await m.servicio.registrar({
      leadId: LEAD,
      conversacionId: CONV,
      leadSessionId: nueva.id,
      ahora: AHORA,
      entranteMetaMessageId: "wamid.in-1",
    });

    expect(r).toBeNull();
    expect(difusionRespondidaDe((await m.sessions.findById(nueva.id))!.extras)).toBeNull();
  });

  test(`pasados ${VENTANA_ATRIBUCION_DIAS} días del envío ya no se atribuye`, async () => {
    const m = await armar();
    await m.salio(
      LEAD,
      new Date(AHORA.getTime() - VENTANA_ATRIBUCION_DIAS * 24 * HORA - 1),
      "wamid.viejo",
    );
    const s = await m.sesion();

    expect(
      await m.servicio.registrar({
        leadId: LEAD,
        conversacionId: CONV,
        leadSessionId: s.id,
        ahora: AHORA,
        entranteMetaMessageId: "wamid.in-1",
      }),
    ).toBeNull();
    expect(await m.messages.findByMetaMessageId("wamid.viejo")).toBeNull();
  });

  test("sin difusión a este lead no hace nada", async () => {
    const m = await armar();
    await m.salio(OTRO, new Date(AHORA.getTime() - HORA), "wamid.otro", "593990000002");
    const s = await m.sesion();
    expect(
      await m.servicio.registrar({
        leadId: LEAD,
        conversacionId: CONV,
        leadSessionId: s.id,
        ahora: AHORA,
        entranteMetaMessageId: "wamid.in-1",
      }),
    ).toBeNull();
    expect(await m.messages.listBySessionId(s.id)).toEqual([]);
  });

  test("el estado de entrega del envío pasa al mensaje: leído se ve leído", async () => {
    const m = await armar();
    await m.salio(LEAD, new Date(AHORA.getTime() - HORA), "wamid.d1");
    await m.envios.aplicarEstadoMeta("wamid.d1", "leido");
    const s = await m.sesion();

    await m.servicio.registrar({
      leadId: LEAD,
      conversacionId: CONV,
      leadSessionId: s.id,
      ahora: AHORA,
      entranteMetaMessageId: "wamid.in-1",
    });

    expect((await m.messages.findByMetaMessageId("wamid.d1"))?.estado_entrega).toBe("leido");
  });
});

describe("difusionRespondidaDe", () => {
  test("sin la clave, o con un valor que no es texto, no hay difusión", () => {
    expect(difusionRespondidaDe({})).toBeNull();
    expect(difusionRespondidaDe({ [CLAVE_DIFUSION_RESPONDIDA]: 3 })).toBeNull();
    expect(difusionRespondidaDe({ [CLAVE_DIFUSION_RESPONDIDA]: "  " })).toBeNull();
  });
});

describe("RespuestaDifusion — la primera respuesta queda en el envío", () => {
  test("marca el envío como respondido con el entrante, y dice que es la primera", async () => {
    const m = await armar();
    const envio = await m.salio(LEAD, new Date(AHORA.getTime() - HORA), "wamid.d1");
    const s = await m.sesion();
    const base = { leadId: LEAD, conversacionId: CONV, leadSessionId: s.id, ahora: AHORA };

    const r = await m.servicio.registrar({ ...base, entranteMetaMessageId: "wamid.in-1" });

    expect(r?.primera).toBe(true);
    const actual = await m.envios.findById(envio.id);
    expect(actual?.respondido_at?.toISOString()).toBe(AHORA.toISOString());
    expect(actual?.respuesta_meta_message_id).toBe("wamid.in-1");
  });

  test("el reintento del mismo entrante sigue siendo la primera; otro entrante no", async () => {
    const m = await armar();
    await m.salio(LEAD, new Date(AHORA.getTime() - HORA), "wamid.d1");
    const s = await m.sesion();
    const base = { leadId: LEAD, conversacionId: CONV, leadSessionId: s.id, ahora: AHORA };

    await m.servicio.registrar({ ...base, entranteMetaMessageId: "wamid.in-1" });
    const reintento = await m.servicio.registrar({ ...base, entranteMetaMessageId: "wamid.in-1" });
    const otro = await m.servicio.registrar({
      ...base,
      ahora: new Date(AHORA.getTime() + 60_000),
      entranteMetaMessageId: "wamid.in-2",
    });

    expect(reintento?.primera).toBe(true);
    expect(otro?.primera).toBe(false);
  });
});

describe("RespuestaDifusion — la difusión salió como texto libre", () => {
  test("sin sesión al mandar: al responder entra al hilo como texto, anotada como texto libre", async () => {
    const m = await armar();
    const envio = await m.salio(
      LEAD,
      new Date(AHORA.getTime() - HORA),
      "wamid.t1",
      undefined,
      true,
    );
    const s = await m.sesion();

    const r = await m.servicio.registrar({
      leadId: LEAD,
      conversacionId: CONV,
      leadSessionId: s.id,
      ahora: AHORA,
      entranteMetaMessageId: "wamid.in-1",
    });

    expect(r).toMatchObject({ envioId: envio.id, primera: true });
    const msg = await m.messages.findByMetaMessageId("wamid.t1");
    expect(msg).toMatchObject({
      lead_session_id: s.id,
      sender: "sistema",
      tipo: "text",
      contenido: "Difusión «Promo frenos» · texto libre",
      metadata: { difusion: { difusion_id: m.d.id, envio_id: envio.id, texto_libre: true } },
    });
    expect((await m.sessions.findById(s.id))?.extras[CLAVE_DIFUSION_RESPONDIDA]).toBe(
      "«Promo frenos» · texto libre",
    );
  });

  test("salió por el hilo de otra sesión: igual cuenta como respuesta, sin volver a anotarla", async () => {
    const m = await armar();
    const vieja = await m.sesion();
    const envio = await m.salio(
      LEAD,
      new Date(AHORA.getTime() - HORA),
      "wamid.t2",
      undefined,
      true,
    );
    // El motor lo mandó por el hilo de la sesión que estaba activa.
    const enHilo = await m.messages.create({
      conversacion_id: CONV,
      lead_session_id: vieja.id,
      direction: "out",
      sender: "sistema",
      sender_user_id: null,
      tipo: "text",
      contenido: "Hola Ana",
      media_url: null,
      meta_message_id: "wamid.t2",
      idempotency_key: `difusion:${envio.id}:1`,
      metadata: {},
      platform_created_at: null,
    });
    await m.sessions.close(vieja.id, { resultado: "exito" });
    const nueva = await m.sesion();

    const r = await m.servicio.registrar({
      leadId: LEAD,
      conversacionId: CONV,
      leadSessionId: nueva.id,
      ahora: AHORA,
      entranteMetaMessageId: "wamid.in-2",
    });

    expect(r).toEqual({
      difusionId: m.d.id,
      envioId: envio.id,
      mensajeId: enHilo.id,
      primera: true,
    });
    expect((await m.envios.findById(envio.id))?.respuesta_meta_message_id).toBe("wamid.in-2");
  });
});
