import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { crearAccionEnviarPlantilla } from "@/server/services/workflows/acciones/enviar-plantilla";
import type { Horario } from "@/types/agente";
import type { Nodo } from "@/types/workflows";

/**
 * "Plantilla HSM": manda una plantilla aprobada de Meta. Pasa por los mismos
 * topes que "Enviar mensaje" salvo la ventana de 24 h, que es justamente para
 * lo que sirven las plantillas.
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
const CERRADO_SALVO_LUNES: Horario = {
  lun: TODO_EL_DIA,
  mar: [],
  mie: [],
  jue: [],
  vie: [],
  sab: [],
  dom: [],
};

const entorno = {
  leadId: "l1",
  leadSessionId: "s1",
  runId: "r1",
  orden: 5,
  contexto: {},
  // Un martes: con CERRADO_SALVO_LUNES está cerrado.
  ahora: new Date("2026-09-22T15:00:00Z"),
};

function nodo(config: Record<string, unknown>): Nodo {
  return { id: "tpl", tipo: "msg_plantilla", config, posicion: { x: 0, y: 0 } };
}

interface Opciones {
  canal?: string;
  ultimoEntrante?: Date | null;
  etapaActiva?: string;
  bajas?: readonly string[];
  salientes?: number;
  /** Plantillas que salieron sin sesión y todavía no se anotaron en el hilo. */
  sinSesion?: number;
  horario?: Horario;
}

function deps(o: Opciones = {}) {
  const sendTemplate = vi.fn(async () => ({ id: "m-tpl" }));
  const sendOutbound = vi.fn(async () => ({ id: "m-txt" }));
  const enviarSinSesion = vi.fn(async () => ({ id: "env-1", meta_message_id: "wamid.1" }));
  return {
    sendTemplate,
    sendOutbound,
    enviarSinSesion,
    d: {
      plantillasSinSesion: {
        enviar: enviarSinSesion,
        contarNoAnotadasDesde: vi.fn(async () => o.sinSesion ?? 0),
      },
      messages: { contarSalientesAutomaticos: vi.fn(async () => o.salientes ?? 0) },
      metaApi: { sendTemplate, sendOutbound },
      conversations: {
        findActivaByLead: vi.fn(async () => ({
          id: "c1",
          canal: o.canal ?? "wa",
          ultimo_entrante_at: o.ultimoEntrante === undefined ? null : o.ultimoEntrante,
        })),
      },
      leads: {
        findById: vi.fn(async () => ({
          id: "l1",
          nombre: "Ana",
          telefono: "+5491155550000",
          email: null,
          canal_origen: "wa",
        })),
      },
      sessions: {
        findById: vi.fn(async () => ({ id: "s1", current_stage: "cotizado" })),
        findActiveByLeadId: vi.fn(async () => ({
          id: "s1",
          current_stage: o.etapaActiva ?? "cotizado",
        })),
      },
      users: { findById: vi.fn(async () => null) },
      supresiones: { activasPorTelefonos: vi.fn(async () => o.bajas ?? []) },
      configProvider: {
        activa: vi.fn(async () => ({
          max_salientes_automaticos_24h: 3,
          horario: o.horario ?? ABIERTO,
          horario_timezone: "UTC",
        })),
      },
    } as never,
  };
}

describe("enviar_plantilla", () => {
  it("manda la plantilla fuera de la ventana de 24 h, con sus variables resueltas", async () => {
    const { d, sendTemplate, sendOutbound } = deps({ ultimoEntrante: null });

    const r = await crearAccionEnviarPlantilla(d)(
      nodo({ templateName: "seguimiento", idioma: "es_AR", parametros: ["{{lead.nombre}}"] }),
      entorno,
    );

    expect(r).toEqual({ puerto: "salida", salida: { mensaje_id: "m-tpl" } });
    expect(sendOutbound).not.toHaveBeenCalled();
    expect(sendTemplate).toHaveBeenCalledWith({
      conversacionId: "c1",
      leadSessionId: "s1",
      to: "+5491155550000",
      plantilla: { nombre: "seguimiento", idioma: "es_AR", parametrosCuerpo: ["Ana"] },
      sender: "sistema",
      idempotencyKey: "wf:r1:5",
    });
  });

  it("sin tocar el idioma usa el que muestra el panel", async () => {
    const { d, sendTemplate } = deps();
    await crearAccionEnviarPlantilla(d)(nodo({ templateName: "hola" }), entorno);
    expect(sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        plantilla: { nombre: "hola", idioma: "es", parametrosCuerpo: [] },
      }),
    );
  });

  it.each([
    ["requiere humano", { etapaActiva: "requiere_humano" }, "requiere_humano"],
    ["dado de baja", { bajas: ["5491155550000"] }, "dado_de_baja"],
    ["tope de frecuencia", { salientes: 3 }, "tope_frecuencia"],
  ] as const)("%s: salta sin mandar", async (_caso, opciones, motivo) => {
    const { d, sendTemplate } = deps(opciones);
    const r = await crearAccionEnviarPlantilla(d)(nodo({ templateName: "hola" }), entorno);
    expect(r.salto?.motivo).toBe(motivo);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("fuera de horario se difiere, igual que un texto", async () => {
    const { d, sendTemplate } = deps({ horario: CERRADO_SALVO_LUNES });
    const r = await crearAccionEnviarPlantilla(d)(nodo({ templateName: "hola" }), entorno);
    expect(r.diferirHasta).toEqual(new Date("2026-09-28T00:00:00Z"));
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("una conversación que no es de WhatsApp falla sin reintento: no hay plantillas ahí", async () => {
    const { d, sendTemplate } = deps({ canal: "ig" });
    await expect(
      crearAccionEnviarPlantilla(d)(nodo({ templateName: "hola" }), entorno),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("una variable que queda vacía no manda: Meta rechazaría el parámetro", async () => {
    const { d, sendTemplate } = deps();
    await expect(
      crearAccionEnviarPlantilla(d)(
        nodo({ templateName: "hola", parametros: ["{{lead.email}}"] }),
        entorno,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  // "Reactivar perdidos": el cron no le pasa sesión a la corrida de un lead
  // cuya última sesión está cerrada (`workflow-programados.ts`). La plantilla
  // es justamente para ese lead, así que no puede exigir una sesión activa.
  it("un lead perdido, sin sesión en la corrida, recibe la plantilla igual", async () => {
    const { d, sendTemplate, enviarSinSesion } = deps();
    const sinSesion = { ...entorno, leadSessionId: undefined };

    const r = await crearAccionEnviarPlantilla(d)(
      nodo({ templateName: "volvamos", idioma: "es_AR", parametros: ["{{lead.nombre}}"] }),
      sinSesion,
    );

    expect(sendTemplate).not.toHaveBeenCalled();
    expect(enviarSinSesion).toHaveBeenCalledWith({
      idempotencyKey: "wf:r1:5",
      workflowRunId: "r1",
      leadId: "l1",
      conversacionId: "c1",
      to: "+5491155550000",
      plantilla: { nombre: "volvamos", idioma: "es_AR", parametrosCuerpo: ["Ana"] },
    });
    expect(r).toEqual({ puerto: "salida", salida: { envio_sin_sesion_id: "env-1" } });
  });

  it("las plantillas sin sesión que no están en el hilo cuentan para el tope de frecuencia", async () => {
    const { d, sendTemplate, enviarSinSesion } = deps({ salientes: 2, sinSesion: 1 });
    const r = await crearAccionEnviarPlantilla(d)(nodo({ templateName: "hola" }), entorno);
    expect(r.salto?.motivo).toBe("tope_frecuencia");
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(enviarSinSesion).not.toHaveBeenCalled();
  });

  it("sin plantilla elegida es error de config", async () => {
    const { d } = deps();
    await expect(crearAccionEnviarPlantilla(d)(nodo({}), entorno)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
