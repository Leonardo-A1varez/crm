import { describe, expect, test, vi } from "vitest";
import { RateLimitError, ValidationError } from "@/lib/errors";
import type { CategoriaPlantilla } from "@/lib/difusion/modelo";
import type { EstadoConversacional } from "@/lib/difusion/planificador";
import type { ParametroPlantilla } from "@/lib/difusion/parametros";
import { NoopLogger } from "@/lib/observability/logger";
import type { Grupo } from "@/lib/ui/condiciones";
import type { DatosInterpolacion } from "@/lib/workflows/variables";
import {
  InMemoryDifusionEnviosRepository,
  type DifusionEnvioInsert,
} from "@/server/repositories/difusion-envios.repo";
import { hasherBajasDesde } from "@/server/repositories/difusion-supresiones.hash";
import { InMemoryDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import { InMemoryDifusionesRepository } from "@/server/repositories/difusiones.repo";
import {
  DefaultMotorDifusionService,
  type MotorDifusionDeps,
} from "@/server/services/difusion/motor.service";
import type { LecturaTope } from "@/server/services/difusion/difusion.service";
import type {
  MetaSendTemplateInput,
  MetaSendTextInput,
  SendOutboundInput,
} from "@/server/services/meta-api.service";
import type { AltasDinamicasService } from "@/server/services/difusion/altas-dinamicas.service";
import type { Difusion } from "@/lib/difusion/modelo";
import type { Mensaje } from "@/types/entities";

const AHORA = new Date("2026-09-25T15:00:00.000Z");
// La misma audiencia que usa `difusion-service.test.ts`.
const ARBOL: Grupo = {
  id: "raiz",
  clase: "grupo",
  operador: "y",
  hijos: [
    {
      id: "r1",
      clase: "regla",
      campoId: "canal",
      comparador: "tiene",
      valor: { tipo: "opciones", valores: ["wa"] },
    },
  ],
};

function tel(n: number): string {
  return `59399000${String(n).padStart(4, "0")}`;
}
function leadId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

interface Opciones {
  tope?: LecturaTope;
  usado24h?: number;
  categoria?: CategoriaPlantilla;
  parametros?: ParametroPlantilla[];
  canary?: number | null;
  /** Qué hace Meta con cada envío. Por defecto, lo acepta. */
  meta?: (input: MetaSendTemplateInput, n: number) => Promise<{ meta_message_id: string }>;
  datos?: (leadId: string) => DatosInterpolacion;
  /** Estado conversacional de cada lead al momento de mandar. Por defecto, nadie hablando. */
  conversacional?: Record<string, EstadoConversacional>;
  /** La versión en texto libre de la difusión. */
  textoLibre?: string | null;
  /** La ruta con que se planificó cada fila. Por defecto, plantilla. */
  rutaPlan?: "plantilla" | "ventana_abierta";
  /** El hilo (conversación + sesión activa) de cada lead. Por defecto, ninguno. */
  hilos?: Record<string, { conversacionId: string; leadSessionId: string }>;
  modo?: "congelada" | "dinamica";
  /** Qué hace la re-evaluación de una audiencia dinámica. Por defecto, no suma nadie. */
  altas?: AltasDinamicasService["sumar"];
}

/** Hace un entrante de hace `h` horas, sin sesión abierta: ventana abierta, nadie hablando. */
function conVentana(h: number): EstadoConversacional {
  return { etapa: null, ultimoEntranteAt: new Date(AHORA.getTime() - h * 3_600_000) };
}

async function armar(filas: number, o: Opciones = {}) {
  const difusiones = new InMemoryDifusionesRepository();
  const envios = new InMemoryDifusionEnviosRepository();
  // Sin hasher: una clave al azar por instancia, que es lo que hace el in-memory.
  const supresiones = new InMemoryDifusionSupresionesRepository();
  let reloj = AHORA;
  const enviados: MetaSendTemplateInput[] = [];
  const meta = vi.fn(async (input: MetaSendTemplateInput) => {
    enviados.push(input);
    if (o.meta) return o.meta(input, enviados.length);
    return { meta_message_id: `wamid.${enviados.length}` };
  });
  const esperar = vi.fn(async (_ms: number) => {});
  const consultasConversacionales: { ids: string[]; entranteDesde: Date }[] = [];
  const textos: MetaSendTextInput[] = [];
  const sendText = vi.fn(async (input: MetaSendTextInput) => {
    textos.push(input);
    return { meta_message_id: `wamid.texto.${textos.length}` };
  });
  const salientes: SendOutboundInput[] = [];
  const sendOutbound = vi.fn(async (input: SendOutboundInput): Promise<Mensaje> => {
    salientes.push(input);
    return {
      id: `msg-${salientes.length}`,
      meta_message_id: `wamid.hilo.${salientes.length}`,
    } as Mensaje;
  });
  const llamadasAltas: { difusionId: string; tanda: number }[] = [];

  const d = await difusiones.create({
    nombre: "Promo frenos",
    audiencia: ARBOL,
    creada_por: null,
    plantilla_nombre: "promo_frenos_v3",
    plantilla_categoria: o.categoria ?? "marketing",
    plantilla_idioma: "es_AR",
    plantilla_parametros: o.parametros ?? [],
    canary_tamano: o.canary ?? null,
    texto_libre: o.textoLibre ?? null,
    audiencia_modo: o.modo ?? "congelada",
  });
  await difusiones.update(d.id, { estado: "programada", programada_para: AHORA });
  const plan: DifusionEnvioInsert[] = Array.from({ length: filas }, (_, i) => ({
    difusion_id: d.id,
    lead_id: leadId(i + 1),
    telefono: tel(i + 1),
    estado: "en_cola",
    motivo_exclusion: null,
    ruta: o.rutaPlan ?? "plantilla",
    tanda: 0,
    programado_para: AHORA,
  }));
  await envios.registrarPlan(plan);

  const deps: MotorDifusionDeps = {
    difusiones,
    envios,
    supresiones,
    usoCupoDesde: async () => o.usado24h ?? 0,
    meta: { sendTemplate: meta, sendText },
    metaApi: { sendOutbound },
    hiloActivo: async (id) => o.hilos?.[id] ?? null,
    altas: {
      sumar: async (dif: Difusion, tanda: number, at: Date) => {
        llamadasAltas.push({ difusionId: dif.id, tanda });
        return o.altas ? o.altas(dif, tanda, at) : { coinciden: 0, nuevos: 0, sumadas: 0 };
      },
    },
    leerTopeMensajeria: async () => o.tope ?? { estado: "ok", tope: 2000 },
    datosDelLead: async (id) => o.datos?.(id) ?? {},
    estadoConversacional: async (ids, entranteDesde) => {
      consultasConversacionales.push({ ids: [...ids], entranteDesde });
      const r = new Map<string, EstadoConversacional>();
      for (const id of ids) {
        const e = o.conversacional?.[id];
        if (e) r.set(id, e);
      }
      return r;
    },
    esperar,
    logger: new NoopLogger(),
    ahora: () => reloj,
  };
  const motor = new DefaultMotorDifusionService(deps);
  return {
    motor,
    d,
    difusiones,
    envios,
    supresiones,
    meta,
    enviados,
    esperar,
    consultasConversacionales,
    textos,
    sendText,
    salientes,
    sendOutbound,
    llamadasAltas,
    avanzar: (ms: number) => {
      reloj = new Date(reloj.getTime() + ms);
    },
    filas: () => envios.listarPorDifusion(d.id, { limite: 1000 }),
  };
}

function rechazo(codigo: number): ValidationError {
  return new ValidationError(`Meta invalid request (wa.sendTemplate): x`, {
    operation: "wa.sendTemplate",
    status: 400,
    code: codigo,
  });
}

describe("MotorDifusion — drenar", () => {
  test("manda lo que está en cola: aceptado con wamid, y la difusión pasa a enviando", async () => {
    const m = await armar(3);

    const r = await m.motor.drenarLote();

    expect(r).toMatchObject({ tipo: "enviado", difusionId: m.d.id, aceptados: 3 });
    const filas = await m.filas();
    expect(filas.map((f) => f.estado)).toEqual(["aceptado", "aceptado", "aceptado"]);
    expect(filas.every((f) => f.meta_message_id?.startsWith("wamid."))).toBe(true);
    const d = await m.difusiones.findById(m.d.id);
    expect(d?.estado).toBe("enviando");
    expect(d?.iniciada_at?.toISOString()).toBe(AHORA.toISOString());
    // Dentro de una tanda el orden es por id: no se asume cuál sale primero.
    expect(m.enviados.find((e) => e.to === tel(1))).toEqual({
      to: tel(1),
      plantilla: { nombre: "promo_frenos_v3", idioma: "es_AR", parametrosCuerpo: [] },
    });
  });

  test("con la cola vacía la completa, y después no hay trabajo", async () => {
    const m = await armar(1);
    await m.motor.drenarLote();

    expect(await m.motor.drenarLote()).toEqual({ tipo: "sin_trabajo" });
    const d = await m.difusiones.findById(m.d.id);
    expect(d?.estado).toBe("completada");
    expect(d?.finalizada_at).not.toBeNull();
  });

  test("una programada para más tarde no se toca", async () => {
    const m = await armar(1);
    await m.difusiones.update(m.d.id, { programada_para: new Date(AHORA.getTime() + 60_000) });

    expect(await m.motor.drenarLote()).toEqual({ tipo: "sin_trabajo" });
    expect(m.meta).not.toHaveBeenCalled();
  });

  test("respeta el ritmo: espera entre envíos, nunca más de 20 por segundo", async () => {
    const m = await armar(4);
    await m.motor.drenarLote();
    expect(m.esperar).toHaveBeenCalledTimes(3);
    for (const [ms] of m.esperar.mock.calls) expect(ms).toBeGreaterThanOrEqual(50);
  });
});

describe("MotorDifusion — la baja gana", () => {
  test("una baja registrada entre la programación y el envío excluye la fila y no llama a Meta", async () => {
    const m = await armar(2);
    await m.supresiones.registrar({
      telefono: `+${tel(1)}`,
      origen: "palabra_clave",
      detalle: "BAJA",
    });

    await m.motor.drenarLote();

    const filas = await m.filas();
    const uno = filas.find((f) => f.lead_id === leadId(1));
    expect(uno?.estado).toBe("excluido");
    expect(uno?.motivo_exclusion).toBe("baja_propia");
    expect(m.enviados.map((e) => e.to)).toEqual([tel(2)]);
  });

  test("una baja de Meta excluye como baja_meta", async () => {
    const m = await armar(1);
    await m.supresiones.registrar({ telefono: tel(1), origen: "meta_preferencias" });
    await m.motor.drenarLote();
    expect((await m.filas())[0]?.motivo_exclusion).toBe("baja_meta");
    expect(m.meta).not.toHaveBeenCalled();
  });

  test("sin claves de la lista de bajas no manda nada: falla cerrado", async () => {
    const m = await armar(1);
    const sinClaves = new InMemoryDifusionSupresionesRepository({
      hasher: () => hasherBajasDesde({}),
    });
    const motor = new DefaultMotorDifusionService({
      difusiones: m.difusiones,
      envios: m.envios,
      supresiones: sinClaves,
      usoCupoDesde: async () => 0,
      meta: { sendTemplate: m.meta, sendText: m.sendText },
      metaApi: { sendOutbound: m.sendOutbound },
      hiloActivo: async () => null,
      altas: { sumar: async () => ({ coinciden: 0, nuevos: 0, sumadas: 0 }) },
      leerTopeMensajeria: async () => ({ estado: "ok", tope: 2000 }),
      datosDelLead: async () => ({}),
      estadoConversacional: async () => new Map(),
      esperar: async () => {},
      logger: new NoopLogger(),
      ahora: () => AHORA,
    });
    await expect(motor.drenarLote()).rejects.toThrow();
    expect(m.meta).not.toHaveBeenCalled();
  });
});

describe("MotorDifusion — revalida el estado conversacional al mandar", () => {
  test("un lead que pasó a requiere_humano después de programar queda excluido con su motivo", async () => {
    const m = await armar(2, {
      conversacional: { [leadId(1)]: { etapa: "requiere_humano", ultimoEntranteAt: null } },
    });

    const r = await m.motor.drenarLote();

    expect(r).toMatchObject({ tipo: "enviado", aceptados: 1, excluidos: 1 });
    const uno = (await m.filas()).find((f) => f.lead_id === leadId(1));
    expect(uno?.estado).toBe("excluido");
    expect(uno?.motivo_exclusion).toBe("requiere_humano");
    expect(m.enviados.map((e) => e.to)).toEqual([tel(2)]);
  });

  test("un lead que empezó a hablar (sesión abierta, entrante hace 30 min) no recibe", async () => {
    const m = await armar(1, {
      conversacional: {
        [leadId(1)]: {
          etapa: "cotizado",
          ultimoEntranteAt: new Date(AHORA.getTime() - 30 * 60_000),
        },
      },
    });

    await m.motor.drenarLote();

    expect((await m.filas())[0]?.motivo_exclusion).toBe("conversacion_activa");
    expect(m.meta).not.toHaveBeenCalled();
  });

  test("con un entrante de hace más de una hora sale igual: misma regla que el planificador", async () => {
    const m = await armar(1, {
      conversacional: {
        [leadId(1)]: {
          etapa: "cotizado",
          ultimoEntranteAt: new Date(AHORA.getTime() - 61 * 60_000),
        },
      },
    });

    await m.motor.drenarLote();

    expect((await m.filas())[0]?.estado).toBe("aceptado");
  });

  test("pide los entrantes de la ventana de 24 h, para los leads del lote", async () => {
    // Con el último entrante de las 24 h sale la ventana, y con el mismo dato
    // la regla de conversación activa (que mira sólo la última hora).
    const m = await armar(2);
    await m.motor.drenarLote();
    expect(m.consultasConversacionales).toHaveLength(1);
    expect(m.consultasConversacionales[0]?.ids.sort()).toEqual([leadId(1), leadId(2)]);
    expect(m.consultasConversacionales[0]?.entranteDesde.toISOString()).toBe(
      new Date(AHORA.getTime() - 24 * 3_600_000).toISOString(),
    );
  });

  test("la baja gana sobre requiere_humano: es la de mayor precedencia", async () => {
    const m = await armar(1, {
      conversacional: { [leadId(1)]: { etapa: "requiere_humano", ultimoEntranteAt: null } },
    });
    await m.supresiones.registrar({ telefono: tel(1), origen: "palabra_clave", detalle: "BAJA" });
    await m.motor.drenarLote();
    expect((await m.filas())[0]?.motivo_exclusion).toBe("baja_propia");
  });
});

describe("MotorDifusion — pausar y detener", () => {
  test("pausar frena en el lote siguiente: lo que queda sigue en cola", async () => {
    const m = await armar(60);
    const primero = await m.motor.drenarLote();
    expect(primero).toMatchObject({ tipo: "enviado", aceptados: 25 });

    await m.difusiones.update(m.d.id, { estado: "en_revision" });
    expect(await m.motor.drenarLote()).toEqual({ tipo: "sin_trabajo" });

    expect(m.meta).toHaveBeenCalledTimes(25);
    const filas = await m.filas();
    expect(filas.filter((f) => f.estado === "en_cola")).toHaveLength(35);
  });

  test("detener entre lotes no manda nada más", async () => {
    const m = await armar(30);
    await m.motor.drenarLote();
    await m.difusiones.update(m.d.id, {
      estado: "detenida",
      motivo_detencion: "Lo frenó una persona",
      finalizada_at: AHORA,
    });
    await m.envios.cancelarPendientes(m.d.id);
    expect(await m.motor.drenarLote()).toEqual({ tipo: "sin_trabajo" });
    expect(m.meta).toHaveBeenCalledTimes(25);
  });
});

describe("MotorDifusion — un reintento no duplica", () => {
  test("una fila reservada no se vuelve a mandar, aunque el lote se repita", async () => {
    const m = await armar(2);
    // El proceso muere después de que Meta aceptó y antes de anotarlo.
    const marcar = m.envios.marcarAceptado.bind(m.envios);
    let caida = true;
    m.envios.marcarAceptado = async (id, wamid) => {
      if (caida) {
        caida = false;
        throw new Error("se cortó la conexión con la base");
      }
      return marcar(id, wamid);
    };

    await expect(m.motor.drenarLote()).rejects.toThrow("se cortó");
    expect(m.meta).toHaveBeenCalledTimes(1);

    const primero = m.enviados[0]?.to;

    // El reintento del step: la fila reservada no sale de nuevo.
    await m.motor.drenarLote();
    expect(m.enviados).toHaveLength(2);
    expect(m.enviados[1]?.to).not.toBe(primero);
  });

  test("una reserva vieja sin desenlace se cierra como fallida, sin reenviar", async () => {
    const m = await armar(1);
    const [fila] = await m.filas();
    await m.envios.reservar(fila!.id, AHORA);

    m.avanzar(11 * 60_000);
    await m.motor.drenarLote();

    const leida = await m.envios.findById(fila!.id);
    expect(leida?.estado).toBe("fallido");
    expect(leida?.error_codigo).toBe("desenlace_desconocido");
    expect(m.meta).not.toHaveBeenCalled();
  });
});

describe("MotorDifusion — cupo", () => {
  test("respeta el cupo del día: manda lo que entra y espera por el resto", async () => {
    // Tope 100 → reserva 15 → entran 85; ya se usaron 83 → quedan 2.
    const m = await armar(5, { tope: { estado: "ok", tope: 100 }, usado24h: 83 });

    const r = await m.motor.drenarLote();
    expect(r).toMatchObject({ tipo: "enviado", aceptados: 2 });
    expect(m.meta).toHaveBeenCalledTimes(2);
  });

  test("sin cupo no llama a Meta y dice que espera", async () => {
    const m = await armar(3, { tope: { estado: "ok", tope: 100 }, usado24h: 85 });
    expect(await m.motor.drenarLote()).toEqual({ tipo: "esperando_cupo", difusionId: m.d.id });
    expect(m.meta).not.toHaveBeenCalled();
  });

  test("sin el nivel de Meta no manda plantillas: no se inventa un cupo", async () => {
    const m = await armar(1, { tope: { estado: "sin-dato", motivo: "timeout" } });
    expect(await m.motor.drenarLote()).toEqual({ tipo: "esperando_cupo", difusionId: m.d.id });
    expect(m.meta).not.toHaveBeenCalled();
  });
});

describe("MotorDifusion — 6 s por persona", () => {
  test("a quien recibió algo hace menos de 6 s no se le manda en este lote", async () => {
    const m = await armar(2);
    m.envios.registrarSalienteExterno(leadId(1), new Date(AHORA.getTime() - 2_000));

    await m.motor.drenarLote();
    expect(m.enviados.map((e) => e.to)).toEqual([tel(2)]);

    m.avanzar(7_000);
    await m.motor.drenarLote();
    expect(m.enviados.map((e) => e.to)).toEqual([tel(2), tel(1)]);
  });
});

describe("MotorDifusion — reacciones a Meta al mandar", () => {
  test("131050 marca la fila y deja una baja de Meta irreversible", async () => {
    const m = await armar(2, {
      meta: async (i, n) => {
        if (i.to === tel(1)) throw rechazo(131050);
        return { meta_message_id: `wamid.${n}` };
      },
    });

    await m.motor.drenarLote();

    const uno = (await m.filas()).find((f) => f.lead_id === leadId(1));
    expect(uno?.estado).toBe("fallido");
    expect(uno?.error_codigo).toBe("131050");
    const bajas = await m.supresiones.activasPorTelefonos([tel(1)]);
    expect(bajas).toHaveLength(1);
    expect(bajas[0]?.origen).toBe("meta_131050");
    expect(bajas[0]?.difusion_id).toBe(m.d.id);
  });

  test("131056 devuelve la fila a la cola: no salió", async () => {
    const m = await armar(1, {
      meta: async (_i, n) => {
        if (n === 1) throw rechazo(131056);
        return { meta_message_id: `wamid.${n}` };
      },
    });
    await m.motor.drenarLote();
    const [fila] = await m.filas();
    expect(fila?.estado).toBe("en_cola");
    expect(fila?.intento_at).toBeNull();
  });

  test("un 429 corta el lote y devuelve la fila a la cola", async () => {
    const m = await armar(3, {
      meta: async () => {
        throw new RateLimitError("Meta rate-limited", "meta", undefined, { status: 429 });
      },
    });
    expect(await m.motor.drenarLote()).toEqual({ tipo: "ritmo", difusionId: m.d.id });
    expect(m.meta).toHaveBeenCalledTimes(1);
    expect((await m.filas()).every((f) => f.estado === "en_cola" && f.intento_at === null)).toBe(
      true,
    );
  });

  test("132015 pausa la difusión en voz alta y deja de mandar", async () => {
    const m = await armar(3, {
      meta: async () => {
        throw rechazo(132015);
      },
    });
    const r = await m.motor.drenarLote();
    expect(r.tipo).toBe("frenada");
    expect(m.meta).toHaveBeenCalledTimes(1);
    const d = await m.difusiones.findById(m.d.id);
    expect(d?.estado).toBe("en_revision");
    expect(d?.motivo_revision).toContain("132015");
  });

  test("368 detiene la difusión, cancela lo pendiente y lo dice", async () => {
    const m = await armar(3, {
      meta: async () => {
        throw rechazo(368);
      },
    });
    await m.motor.drenarLote();
    const d = await m.difusiones.findById(m.d.id);
    expect(d?.estado).toBe("detenida");
    expect(d?.detenida_por).toBeNull();
    expect(d?.motivo_detencion).toContain("368");
    const estados = (await m.filas()).map((f) => f.estado).sort();
    expect(estados).toEqual(["cancelado", "cancelado", "fallido"]);
  });

  // El frenado automático que muestra la pantalla de envío: los tres códigos.
  test.each([368, 131031, 131048])(
    "%i al mandar detiene la difusión y cancela lo pendiente",
    async (codigo) => {
      const m = await armar(3, {
        meta: async () => {
          throw rechazo(codigo);
        },
      });
      await m.motor.drenarLote();
      const d = await m.difusiones.findById(m.d.id);
      expect(d?.estado).toBe("detenida");
      expect(d?.motivo_detencion).toContain(String(codigo));
      expect((await m.filas()).filter((f) => f.estado === "en_cola")).toEqual([]);
    },
  );

  test("un token vencido no quema filas: la fila vuelve a la cola y el error sube", async () => {
    const m = await armar(2, {
      meta: async () => {
        throw new ValidationError("Meta auth error", { status: 401, code: 190 });
      },
    });
    await expect(m.motor.drenarLote()).rejects.toThrow("Meta auth error");
    expect((await m.filas()).every((f) => f.estado === "en_cola" && f.intento_at === null)).toBe(
      true,
    );
  });
});

describe("MotorDifusion — plantilla y variables", () => {
  const parametros = [
    { valor: "{{lead.nombre}}", respaldo: "" },
    { valor: "{{lead.vehiculo_modelo}}", respaldo: "tu vehículo" },
  ];

  test("cada destinatario recibe sus variables resueltas, con respaldo si falta el dato", async () => {
    const m = await armar(2, {
      parametros,
      datos: (id) =>
        id === leadId(1)
          ? { lead: { nombre: "Ana", vehiculo_modelo: "Aveo" } }
          : { lead: { nombre: "Luis" } },
    });
    await m.motor.drenarLote();
    const porTelefono = new Map(m.enviados.map((e) => [e.to, e.plantilla.parametrosCuerpo]));
    expect(porTelefono.get(tel(1))).toEqual(["Ana", "Aveo"]);
    expect(porTelefono.get(tel(2))).toEqual(["Luis", "tu vehículo"]);
  });

  test("una variable sin dato ni respaldo no manda: la fila falla con motivo y sin llamar a Meta", async () => {
    const m = await armar(1, { parametros, datos: () => ({ lead: {} }) });
    await m.motor.drenarLote();
    const [fila] = await m.filas();
    expect(fila?.estado).toBe("fallido");
    expect(fila?.error_codigo).toBe("parametro_vacio");
    expect(m.meta).not.toHaveBeenCalled();
  });
});

describe("MotorDifusion — muestra (canary)", () => {
  test("manda la muestra y se frena a revisar; al reanudar sigue sin volver a frenar", async () => {
    const m = await armar(5, { canary: 2 });

    expect(await m.motor.drenarLote()).toMatchObject({ tipo: "enviado", aceptados: 2 });
    const r = await m.motor.drenarLote();
    expect(r.tipo).toBe("frenada");
    let d = await m.difusiones.findById(m.d.id);
    expect(d?.estado).toBe("en_revision");
    expect(d?.motivo_revision).toMatch(/muestra/i);

    await m.difusiones.update(m.d.id, { estado: "enviando", motivo_revision: null });
    expect(await m.motor.drenarLote()).toMatchObject({ tipo: "enviado", aceptados: 3 });
    d = await m.difusiones.findById(m.d.id);
    expect(d?.estado).toBe("enviando");
  });
});

describe("MotorDifusion — estados por webhook", () => {
  test("entregado y leído avanzan la fila por wamid", async () => {
    const m = await armar(1);
    await m.motor.drenarLote();

    await m.motor.aplicarEstadoWebhook({ wamid: "wamid.1", estado: "entregado" });
    expect((await m.filas())[0]?.estado).toBe("entregado");
    await m.motor.aplicarEstadoWebhook({ wamid: "wamid.1", estado: "leido" });
    expect((await m.filas())[0]?.estado).toBe("leido");
  });

  test("un wamid que no es de una difusión no hace nada", async () => {
    const m = await armar(0);
    expect(await m.motor.aplicarEstadoWebhook({ wamid: "wamid.x", estado: "entregado" })).toBe(
      false,
    );
  });

  test("131050 por webhook marca la fila y registra la baja", async () => {
    const m = await armar(1);
    await m.motor.drenarLote();

    await m.motor.aplicarEstadoWebhook({
      wamid: "wamid.1",
      estado: "fallido",
      codigo: "131050",
      detalle: "Unable to deliver the message.",
    });

    const [fila] = await m.filas();
    expect(fila?.estado).toBe("fallido");
    expect(fila?.error_codigo).toBe("131050");
    const bajas = await m.supresiones.activasPorTelefonos([tel(1)]);
    expect(bajas.map((b) => b.origen)).toEqual(["meta_131050"]);
  });

  test("131049 por webhook deja al teléfono saturado para el planificador", async () => {
    const m = await armar(1);
    await m.motor.drenarLote();
    await m.motor.aplicarEstadoWebhook({ wamid: "wamid.1", estado: "fallido", codigo: "131049" });
    const saturados = await m.envios.saturadosDesde([tel(1)], new Date(0));
    expect(saturados.has(tel(1))).toBe(true);
  });

  test("131048 por webhook detiene la difusión en curso", async () => {
    const m = await armar(30);
    await m.motor.drenarLote();
    await m.motor.aplicarEstadoWebhook({ wamid: "wamid.1", estado: "fallido", codigo: "131048" });
    const d = await m.difusiones.findById(m.d.id);
    expect(d?.estado).toBe("detenida");
    expect(d?.motivo_detencion).toContain("131048");
    expect((await m.filas()).filter((f) => f.estado === "en_cola")).toHaveLength(0);
  });

  test("un fallido sin código se guarda igual, con un código que lo dice", async () => {
    const m = await armar(1);
    await m.motor.drenarLote();
    await m.motor.aplicarEstadoWebhook({ wamid: "wamid.1", estado: "fallido" });
    expect((await m.filas())[0]?.error_codigo).toBe("sin_codigo");
  });
});

describe("MotorDifusion — invariante M ≤ N antes de la primera llamada", () => {
  test("si el plan persistido es el programado, sigue", async () => {
    const m = await armar(3);
    expect(
      await m.motor.verificarPlan({ difusionId: m.d.id, audienciaInicial: 3, destinatarios: 3 }),
    ).toBe(true);
    expect((await m.difusiones.findById(m.d.id))?.estado).toBe("programada");
  });

  test("si el plan no es el programado, se detiene sin llamar a Meta", async () => {
    const m = await armar(3);
    expect(
      await m.motor.verificarPlan({ difusionId: m.d.id, audienciaInicial: 2, destinatarios: 2 }),
    ).toBe(false);

    const d = await m.difusiones.findById(m.d.id);
    expect(d?.estado).toBe("detenida");
    expect(d?.motivo_detencion).toMatch(/plan persistido/);
    expect(await m.motor.drenarLote()).toEqual({ tipo: "sin_trabajo" });
    expect(m.meta).not.toHaveBeenCalled();
  });
});

describe("MotorDifusion — texto libre a quien tiene la ventana abierta (§7.3.5)", () => {
  const TEXTO = "Hola {{lead.nombre}}, llegaron pastillas de freno";

  test("con la ventana abierta y hilo activo, sale el texto libre por el hilo con las variables resueltas", async () => {
    const m = await armar(2, {
      textoLibre: TEXTO,
      conversacional: { [leadId(1)]: conVentana(2) },
      hilos: { [leadId(1)]: { conversacionId: "conv-1", leadSessionId: "ses-1" } },
      datos: (id) => ({ lead: { nombre: id === leadId(1) ? "Ana" : "Beto" } }),
    });

    const r = await m.motor.drenarLote();

    expect(r).toMatchObject({ tipo: "enviado", aceptados: 2 });
    expect(m.salientes).toEqual([
      expect.objectContaining({
        conversacionId: "conv-1",
        leadSessionId: "ses-1",
        canal: "wa",
        to: tel(1),
        contenido: "Hola Ana, llegaron pastillas de freno",
        sender: "sistema",
      }),
    ]);
    // El otro no tiene la ventana abierta: plantilla.
    expect(m.enviados.map((e) => e.to)).toEqual([tel(2)]);
    const uno = (await m.filas()).find((f) => f.lead_id === leadId(1));
    expect(uno).toMatchObject({
      estado: "aceptado",
      ruta: "ventana_abierta",
      salio_como: "texto_libre",
      meta_message_id: "wamid.hilo.1",
    });
    const dos = (await m.filas()).find((f) => f.lead_id === leadId(2));
    expect(dos).toMatchObject({ ruta: "plantilla", salio_como: "plantilla" });
  });

  test("la idempotencia del hilo es por reserva del envío", async () => {
    const m = await armar(1, {
      textoLibre: TEXTO,
      conversacional: { [leadId(1)]: conVentana(2) },
      hilos: { [leadId(1)]: { conversacionId: "conv-1", leadSessionId: "ses-1" } },
    });
    await m.motor.drenarLote();
    const [fila] = await m.filas();
    expect(m.salientes[0]?.idempotencyKey).toBe(`difusion:${fila!.id}:${AHORA.getTime()}`);
  });

  test("sin sesión activa el texto libre sale por el cliente de Meta, como la plantilla sin sesión", async () => {
    const m = await armar(1, {
      textoLibre: TEXTO,
      conversacional: { [leadId(1)]: conVentana(3) },
      datos: () => ({ lead: { nombre: "Ana" } }),
    });

    await m.motor.drenarLote();

    expect(m.sendOutbound).not.toHaveBeenCalled();
    expect(m.meta).not.toHaveBeenCalled();
    expect(m.textos).toEqual([
      { canal: "wa", to: tel(1), text: "Hola Ana, llegaron pastillas de freno" },
    ]);
    expect((await m.filas())[0]).toMatchObject({
      estado: "aceptado",
      salio_como: "texto_libre",
      meta_message_id: "wamid.texto.1",
    });
  });

  test("sin texto libre, la ventana abierta recibe la plantilla, como antes", async () => {
    const m = await armar(1, { conversacional: { [leadId(1)]: conVentana(2) } });
    await m.motor.drenarLote();
    expect(m.enviados.map((e) => e.to)).toEqual([tel(1)]);
    expect(m.textos).toEqual([]);
    expect((await m.filas())[0]).toMatchObject({
      ruta: "ventana_abierta",
      salio_como: "plantilla",
    });
  });

  test("la ventana se mira al mandar: planificada abierta pero ya cerrada, sale la plantilla y consume cupo", async () => {
    const m = await armar(1, {
      textoLibre: TEXTO,
      rutaPlan: "ventana_abierta",
      // Cierra en 30 min: dentro del margen se trata como cerrada.
      conversacional: {
        [leadId(1)]: {
          etapa: null,
          ultimoEntranteAt: new Date(AHORA.getTime() - (24 * 60 - 30) * 60_000),
        },
      },
    });
    await m.motor.drenarLote();
    expect(m.textos).toEqual([]);
    expect(m.enviados.map((e) => e.to)).toEqual([tel(1)]);
    expect((await m.filas())[0]).toMatchObject({ ruta: "plantilla", salio_como: "plantilla" });
  });

  test("el texto libre no consume cupo: sale aunque no quede cupo para plantillas", async () => {
    // Tope 100 → reserva 15 → entran 85; ya se usaron 85 → no queda nada.
    const m = await armar(2, {
      textoLibre: TEXTO,
      tope: { estado: "ok", tope: 100 },
      usado24h: 85,
      conversacional: { [leadId(1)]: conVentana(1) },
    });
    const r = await m.motor.drenarLote();
    expect(r).toMatchObject({ tipo: "enviado", aceptados: 1 });
    expect(m.textos.map((t) => t.to)).toEqual([tel(1)]);
    expect(m.meta).not.toHaveBeenCalled();
  });

  test("un saturado con la ventana abierta recibe el texto libre: el 131049 es de plantillas de marketing", async () => {
    const m = await armar(1, {
      textoLibre: TEXTO,
      conversacional: { [leadId(1)]: conVentana(2) },
    });
    await m.envios.registrarPlan([
      {
        difusion_id: (
          await m.difusiones.create({
            nombre: "Anterior",
            audiencia: ARBOL,
            creada_por: null,
          })
        ).id,
        lead_id: leadId(1),
        telefono: tel(1),
        estado: "en_cola",
        motivo_exclusion: null,
        ruta: "plantilla",
        tanda: 0,
        programado_para: AHORA,
      },
    ]);
    await saturar(m, leadId(1));

    await m.motor.drenarLote();

    const fila = (await m.filas()).find((f) => f.lead_id === leadId(1));
    expect(fila).toMatchObject({ estado: "aceptado", salio_como: "texto_libre" });
  });

  test("un saturado con la ventana abierta y sin texto libre no recibe la plantilla de marketing", async () => {
    const m = await armar(1, { conversacional: { [leadId(1)]: conVentana(2) } });
    await m.envios.registrarPlan([
      {
        difusion_id: (
          await m.difusiones.create({
            nombre: "Anterior",
            audiencia: ARBOL,
            creada_por: null,
          })
        ).id,
        lead_id: leadId(1),
        telefono: tel(1),
        estado: "en_cola",
        motivo_exclusion: null,
        ruta: "plantilla",
        tanda: 0,
        programado_para: AHORA,
      },
    ]);
    await saturar(m, leadId(1));

    await m.motor.drenarLote();

    expect((await m.filas())[0]).toMatchObject({
      estado: "excluido",
      motivo_exclusion: "saturado_meta",
    });
  });
});

/** Deja un 131049 reciente para ese lead en otra difusión (la fila en cola que no es de `m.d`). */
async function saturar(m: Awaited<ReturnType<typeof armar>>, lead: string): Promise<void> {
  const todas = await Promise.all(
    (await m.difusiones.list({ limite: 10 })).map((d) =>
      m.envios.listarPorDifusion(d.id, { limite: 10 }),
    ),
  );
  const ajena = todas.flat().find((e) => e.difusion_id !== m.d.id && e.lead_id === lead);
  if (!ajena) throw new Error("no hay fila ajena para saturar");
  await m.envios.reservar(ajena.id, new Date(AHORA.getTime() - 3_600_000));
  await m.envios.marcarFallido(ajena.id, { codigo: "131049" });
}

describe("MotorDifusion — audiencia dinámica", () => {
  test("antes de la primera tanda re-evalúa la audiencia y manda también a los que se sumaron", async () => {
    const m = await armar(1, {
      modo: "dinamica",
      altas: async (dif, tanda) => {
        await m.envios.sumarAltas([
          {
            difusion_id: dif.id,
            lead_id: leadId(2),
            telefono: tel(2),
            estado: "en_cola",
            motivo_exclusion: null,
            ruta: "plantilla",
            tanda,
            programado_para: AHORA,
          },
        ]);
        return { coinciden: 2, nuevos: 1, sumadas: 1 };
      },
    });

    const r = await m.motor.drenarLote();

    expect(m.llamadasAltas).toEqual([{ difusionId: m.d.id, tanda: 0 }]);
    expect(r).toMatchObject({ tipo: "enviado", aceptados: 2 });
    expect(m.enviados.map((e) => e.to).sort()).toEqual([tel(1), tel(2)]);
    expect((await m.difusiones.findById(m.d.id))?.audiencia_tanda_evaluada).toBe(0);
  });

  test("una vez por tanda: el lote siguiente de la misma tanda no vuelve a re-evaluar", async () => {
    const m = await armar(30, { modo: "dinamica" });
    await m.motor.drenarLote();
    await m.motor.drenarLote();
    expect(m.llamadasAltas).toHaveLength(1);
  });

  test("cuando vence la tanda siguiente, re-evalúa otra vez con ese número", async () => {
    const m = await armar(1, { modo: "dinamica" });
    const manana = new Date(AHORA.getTime() + 24 * 3_600_000);
    await m.envios.registrarPlan([
      {
        difusion_id: m.d.id,
        lead_id: leadId(9),
        telefono: tel(9),
        estado: "en_cola",
        motivo_exclusion: null,
        ruta: "plantilla",
        tanda: 1,
        programado_para: manana,
      },
    ]);
    await m.motor.drenarLote();
    expect(m.llamadasAltas.map((l) => l.tanda)).toEqual([0]);

    m.avanzar(24 * 3_600_000);
    await m.motor.drenarLote();
    expect(m.llamadasAltas.map((l) => l.tanda)).toEqual([0, 1]);
  });

  test("una congelada nunca se re-evalúa", async () => {
    const m = await armar(2);
    await m.motor.drenarLote();
    expect(m.llamadasAltas).toEqual([]);
  });

  test("si la re-evaluación falla, la tanda sale igual con lo que ya estaba", async () => {
    const m = await armar(1, {
      modo: "dinamica",
      altas: async () => {
        throw new Error("la base no respondió");
      },
    });
    const r = await m.motor.drenarLote();
    expect(r).toMatchObject({ tipo: "enviado", aceptados: 1 });
  });
});
