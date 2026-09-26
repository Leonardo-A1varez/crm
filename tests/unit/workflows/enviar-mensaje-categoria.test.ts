import { describe, expect, it, vi } from "vitest";
import { crearAccionEnviarMensaje } from "@/server/services/workflows/acciones/enviar-mensaje";
import { revisarConfig } from "@/lib/workflows/config-nodos";
import type { AccionHandler } from "@/server/services/workflows/acciones/registro";
import type { Horario } from "@/types/agente";
import type { Nodo } from "@/types/workflows";

/**
 * «Enviar mensaje» con categoría (decisión 1 del dueño, lado flujos):
 * - Servicio: texto libre, sólo con la ventana de 24 h abierta; cerrada, salta
 *   con `sin_ventana`.
 * - Marketing: sale con una plantilla aprobada. Con la ventana abierta y un
 *   texto libre configurado, sale el texto (gratis); si no, la plantilla.
 */

const TODO_EL_DIA = [{ desde: "00:00", hasta: "23:59" }];
const HORARIO: Horario = {
  lun: TODO_EL_DIA,
  mar: TODO_EL_DIA,
  mie: TODO_EL_DIA,
  jue: TODO_EL_DIA,
  vie: TODO_EL_DIA,
  sab: TODO_EL_DIA,
  dom: TODO_EL_DIA,
};

const entorno = { leadId: "l1", leadSessionId: "s1", runId: "r1", orden: 3, contexto: {} };

function deps(ventanaAbierta: boolean) {
  return {
    messages: { contarSalientesAutomaticos: vi.fn(async () => 0) },
    plantillasSinSesion: { contarNoAnotadasDesde: vi.fn(async () => 0) },
    metaApi: { sendOutbound: vi.fn(async () => ({ id: "m-texto" })) },
    conversations: {
      findActivaByLead: vi.fn(async () => ({
        id: "c1",
        canal: "wa",
        ultimo_entrante_at: ventanaAbierta
          ? new Date()
          : new Date(Date.now() - 30 * 60 * 60 * 1000),
      })),
    },
    leads: { findById: vi.fn(async () => ({ id: "l1", telefono: "+5215550001111" })) },
    sessions: {
      findById: vi.fn(async () => ({ id: "s1", current_stage: "considerando" })),
      findActiveByLeadId: vi.fn(async () => ({ id: "s1", current_stage: "considerando" })),
    },
    supresiones: { activasPorTelefonos: vi.fn(async () => []) },
    users: { findById: vi.fn(async () => null) },
    configProvider: {
      activa: vi.fn(async () => ({
        max_salientes_automaticos_24h: 5,
        horario: HORARIO,
        horario_timezone: "UTC",
      })),
    },
  };
}

const nodoTexto = (config: Record<string, unknown>): Nodo => ({
  id: "n2",
  tipo: "msg_texto",
  config,
  posicion: { x: 0, y: 0 },
});

function plantillaFalsa() {
  const llamadas: Nodo[] = [];
  const handler: AccionHandler = async (nodo) => {
    llamadas.push(nodo);
    return { puerto: "salida", salida: { mensaje_id: "m-plantilla" } };
  };
  return { handler, llamadas };
}

const MARKETING = {
  categoria: "marketing",
  templateName: "promo_frenos",
  idioma: "es",
  parametros: ["{{lead.nombre}}"],
};

describe("«Enviar mensaje» — categoría servicio", () => {
  it("sin categoría es servicio: con la ventana cerrada salta con sin_ventana", async () => {
    const d = deps(false);
    const r = await crearAccionEnviarMensaje(d as never, plantillaFalsa().handler)(
      nodoTexto({ mensaje: "hola" }),
      entorno,
    );
    expect(r).toMatchObject({ salto: { motivo: "sin_ventana" } });
    expect(d.metaApi.sendOutbound).not.toHaveBeenCalled();
  });
});

describe("«Enviar mensaje» — categoría marketing", () => {
  it("ventana abierta y texto libre configurado: sale el texto, no la plantilla", async () => {
    const d = deps(true);
    const plantilla = plantillaFalsa();
    const r = await crearAccionEnviarMensaje(d as never, plantilla.handler)(
      nodoTexto({ ...MARKETING, mensaje: "Esta semana, pastillas con 10 % menos" }),
      entorno,
    );
    expect(d.metaApi.sendOutbound).toHaveBeenCalledTimes(1);
    expect(plantilla.llamadas).toHaveLength(0);
    expect(r).toMatchObject({ salida: { mensaje_id: "m-texto", via: "texto_libre" } });
  });

  it("ventana cerrada: sale la plantilla aprobada", async () => {
    const d = deps(false);
    const plantilla = plantillaFalsa();
    const r = await crearAccionEnviarMensaje(d as never, plantilla.handler)(
      nodoTexto({ ...MARKETING, mensaje: "Esta semana, pastillas con 10 % menos" }),
      entorno,
    );
    expect(d.metaApi.sendOutbound).not.toHaveBeenCalled();
    expect(plantilla.llamadas).toEqual([
      expect.objectContaining({
        id: "n2",
        config: { templateName: "promo_frenos", idioma: "es", parametros: ["{{lead.nombre}}"] },
      }),
    ]);
    expect(r).toMatchObject({ salida: { mensaje_id: "m-plantilla", via: "plantilla" } });
  });

  it("ventana abierta pero sin texto libre: sale la plantilla", async () => {
    const d = deps(true);
    const plantilla = plantillaFalsa();
    await crearAccionEnviarMensaje(d as never, plantilla.handler)(nodoTexto(MARKETING), entorno);
    expect(d.metaApi.sendOutbound).not.toHaveBeenCalled();
    expect(plantilla.llamadas).toHaveLength(1);
  });
});

describe("validación del bloque", () => {
  it("servicio sin texto no se puede publicar", () => {
    expect(revisarConfig(nodoTexto({ categoria: "servicio" }))?.errores).toContain(
      "El mensaje no puede estar vacío",
    );
  });

  it("marketing sin plantilla no se puede publicar; el texto libre es opcional", () => {
    expect(revisarConfig(nodoTexto({ categoria: "marketing" }))?.errores).toEqual([
      "Un mensaje de marketing necesita una plantilla aprobada para cuando la ventana de 24 h esté cerrada",
    ]);
    expect(revisarConfig(nodoTexto(MARKETING))?.errores).toEqual([]);
  });
});
