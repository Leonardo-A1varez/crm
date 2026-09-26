import { describe, expect, it, vi } from "vitest";
import {
  CLAVE_RESPUESTA_DE_TURNO,
  RESPUESTA_DE_TURNO_CONSUMIDA,
  conRespuestaDeTurno,
} from "@/lib/workflows/interceptar";
import {
  envioRequiereVentana,
  revisarTopesDeEnvio,
  ventanaAbierta,
} from "@/server/services/workflows/acciones/topes-de-envio";
import { crearAccionEnviarMensaje } from "@/server/services/workflows/acciones/enviar-mensaje";
import { crearAccionEnviarPlantilla } from "@/server/services/workflows/acciones/enviar-plantilla";
import { crearAccionesDeMensajeriaRica } from "@/server/services/workflows/acciones/enviar-rico";
import type { Horario } from "@/types/agente";
import type { Nodo } from "@/types/workflows";

/**
 * La respuesta de un flujo que interceptó al agente: el interceptor revisó los
 * topes al decidir el turno (`interceptor.service.ts`). Entre esa decisión y el
 * envío, otro flujo disparado por el mismo mensaje puede llenar el tope de
 * frecuencia; si el envío lo volviera a contar, saltaría y el cliente se
 * quedaría sin respuesta. La marca `$respuesta_de_turno` dice "este envío ya fue
 * autorizado por el turno": salta la frecuencia —un contador que se comparte—,
 * NO los topes del lead, y se consume con el primer envío.
 */

const TODO_EL_DIA = [{ desde: "00:00", hasta: "23:59" }];
const ABIERTO: Horario = {
  lun: TODO_EL_DIA,
  mar: TODO_EL_DIA,
  mie: TODO_EL_DIA,
  jue: TODO_EL_DIA,
  vie: TODO_EL_DIA,
  sab: TODO_EL_DIA,
  dom: TODO_EL_DIA,
};
const AHORA = new Date("2026-09-22T15:00:00Z");

function deps(o: { salientes?: number; bajas?: string[]; etapa?: string } = {}) {
  const sendOutbound = vi.fn(async () => ({ id: "m-out" }));
  const sendTemplate = vi.fn(async () => ({ id: "m-tpl" }));
  const sendRico = vi.fn(async () => ({ id: "m-rico", meta_message_id: "wamid.OUT" }));
  const d = {
    messages: { contarSalientesAutomaticos: vi.fn(async () => o.salientes ?? 0) },
    plantillasSinSesion: {
      contarNoAnotadasDesde: vi.fn(async () => 0),
      enviar: vi.fn(async () => ({ id: "ps-1" })),
    },
    metaApi: { sendOutbound, sendTemplate, sendRico },
    conversations: {
      findActivaByLead: vi.fn(async () => ({
        id: "c1",
        canal: "wa",
        ultimo_entrante_at: new Date("2026-09-22T14:59:00Z"),
      })),
    },
    leads: { findById: vi.fn(async () => ({ id: "l1", telefono: "+5215550001111" })) },
    sessions: {
      findById: vi.fn(async () => ({ id: "s1", current_stage: "considerando" })),
      findActiveByLeadId: vi.fn(async () => ({
        id: "s1",
        current_stage: o.etapa ?? "considerando",
      })),
    },
    supresiones: {
      activasPorTelefonos: vi.fn(async (tels: readonly string[]) =>
        (o.bajas ?? []).filter((b) => tels.includes(b)).map((telefono) => ({ id: "b", telefono })),
      ),
    },
    users: { findById: vi.fn(async () => null) },
    configProvider: {
      activa: vi.fn(async () => ({
        max_salientes_automaticos_24h: 3,
        horario: ABIERTO,
        horario_timezone: "UTC",
      })),
    },
    imagenesDeFlujo: { urlFirmada: vi.fn(async () => "https://x/firmada.png") },
  };
  return { d: d as never, sendOutbound, sendTemplate, sendRico };
}

const entorno = (contexto: Record<string, unknown>) => ({
  leadId: "l1",
  leadSessionId: "s1",
  runId: "r1",
  orden: 2,
  contexto,
  ahora: AHORA,
});

const nodo = (tipo: Nodo["tipo"], config: Record<string, unknown>): Nodo => ({
  id: "n1",
  tipo,
  config,
  posicion: { x: 0, y: 0 },
});

describe("revisarTopesDeEnvio — respuesta de un turno interceptado", () => {
  it("sin la marca, el tope de frecuencia lleno salta", async () => {
    const { d } = deps({ salientes: 3 });
    const r = await revisarTopesDeEnvio(d, entorno({}), AHORA, "enviar_mensaje");
    expect(r).toMatchObject({ tipo: "salto", salto: { motivo: "tope_frecuencia" } });
  });

  it("con la marca, el tope de frecuencia no la frena: el turno ya la autorizó", async () => {
    const { d } = deps({ salientes: 3 });
    const r = await revisarTopesDeEnvio(
      d,
      entorno(conRespuestaDeTurno({})),
      AHORA,
      "enviar_mensaje",
    );
    expect(r.tipo).toBe("sigue");
  });

  it("con la marca, un lead dado de baja sigue saltando", async () => {
    const { d } = deps({ bajas: ["5215550001111"] });
    const r = await revisarTopesDeEnvio(
      d,
      entorno(conRespuestaDeTurno({})),
      AHORA,
      "enviar_mensaje",
    );
    expect(r).toMatchObject({ tipo: "salto", salto: { motivo: "dado_de_baja" } });
  });

  it("con la marca, un lead en «requiere humano» sigue saltando", async () => {
    const { d } = deps({ etapa: "requiere_humano" });
    const r = await revisarTopesDeEnvio(
      d,
      entorno(conRespuestaDeTurno({})),
      AHORA,
      "enviar_mensaje",
    );
    expect(r).toMatchObject({ tipo: "salto", salto: { motivo: "requiere_humano" } });
  });
});

describe("la marca se consume con el primer envío", () => {
  it("enviar_mensaje manda con el tope lleno y deja la marca consumida", async () => {
    const { d, sendOutbound } = deps({ salientes: 3 });
    const r = await crearAccionEnviarMensaje(d)(
      nodo("msg_texto", { mensaje: "Abrimos de 9 a 18" }),
      entorno(conRespuestaDeTurno({})),
    );
    expect(sendOutbound).toHaveBeenCalledTimes(1);
    expect(r.contexto).toEqual(RESPUESTA_DE_TURNO_CONSUMIDA);
  });

  it("enviar_plantilla también la consume", async () => {
    const { d, sendTemplate } = deps({ salientes: 3 });
    const r = await crearAccionEnviarPlantilla(d)(
      nodo("msg_plantilla", { templateName: "horario", idioma: "es", parametros: [] }),
      entorno(conRespuestaDeTurno({})),
    );
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect(r.contexto).toEqual(RESPUESTA_DE_TURNO_CONSUMIDA);
  });

  it("una imagen también la consume", async () => {
    const { d, sendRico } = deps({ salientes: 3 });
    const r = await crearAccionesDeMensajeriaRica(d).enviar_imagen(
      nodo("msg_imagen", { tipoMedia: "url", url: "https://x/a.png", caption: "" }),
      entorno(conRespuestaDeTurno({})),
    );
    expect(sendRico).toHaveBeenCalledTimes(1);
    expect(r.contexto).toEqual(RESPUESTA_DE_TURNO_CONSUMIDA);
  });

  it("unos botones la consumen junto con la espera que dejan", async () => {
    const { d, sendRico } = deps({ salientes: 3 });
    const r = await crearAccionesDeMensajeriaRica(d).enviar_botones(
      nodo("msg_botones", {
        mensaje: "¿Te cotizo?",
        botones: [{ id: "si", texto: "Sí" }],
        timeout: 1,
        unidadTimeout: "horas",
      }),
      entorno(conRespuestaDeTurno({})),
    );
    expect(sendRico).toHaveBeenCalledTimes(1);
    expect(r.contexto).toMatchObject(RESPUESTA_DE_TURNO_CONSUMIDA);
    expect(r.contexto?.["$espera_opcion"]).toMatchObject({ nodoId: "n1" });
  });

  it("sin la marca, el envío no toca el contexto", async () => {
    const { d } = deps();
    const r = await crearAccionEnviarMensaje(d)(
      nodo("msg_texto", { mensaje: "hola" }),
      entorno({}),
    );
    expect(r.contexto?.[CLAVE_RESPUESTA_DE_TURNO]).toBeUndefined();
  });
});

describe("ventana de 24 h, una sola regla", () => {
  it("abierta hasta 24 h después del último entrante; cerrada sin entrante", () => {
    expect(ventanaAbierta(new Date("2026-09-21T15:00:01Z"), AHORA)).toBe(true);
    expect(ventanaAbierta(new Date("2026-09-21T14:59:59Z"), AHORA)).toBe(false);
    expect(ventanaAbierta(null, AHORA)).toBe(false);
  });

  it("qué bloques necesitan la ventana: texto de servicio y mensajes ricos sí; plantilla y marketing no", () => {
    expect(envioRequiereVentana(nodo("msg_texto", { mensaje: "hola" }))).toBe(true);
    expect(
      envioRequiereVentana(
        nodo("msg_texto", {
          mensaje: "promo",
          categoria: "marketing",
          templateName: "promo",
          idioma: "es",
          parametros: [],
        }),
      ),
    ).toBe(false);
    expect(
      envioRequiereVentana(
        nodo("msg_plantilla", { templateName: "t", idioma: "es", parametros: [] }),
      ),
    ).toBe(false);
    expect(envioRequiereVentana(nodo("msg_imagen", { tipoMedia: "url", url: "https://x" }))).toBe(
      true,
    );
    expect(envioRequiereVentana(nodo("int_notif_vendedor", {}))).toBeNull();
  });
});
