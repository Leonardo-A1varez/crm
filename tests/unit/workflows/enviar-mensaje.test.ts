import { describe, expect, it, vi } from "vitest";
import { crearAccionEnviarMensaje } from "@/server/services/workflows/acciones/enviar-mensaje";
import { IllegalStateError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Horario } from "@/types/agente";

const entorno = { leadId: "l1", leadSessionId: "s1", runId: "r1", orden: 7, contexto: {} };
const nodo = {
  id: "env",
  tipo: "accion" as const,
  config: { accion: "enviar_mensaje", texto: "hola" },
  posicion: { x: 0, y: 0 },
};

const RANGO_TODO_EL_DIA = { desde: "00:00", hasta: "23:59" };

function horarioSiempreAbierto(): Horario {
  return {
    lun: [RANGO_TODO_EL_DIA],
    mar: [RANGO_TODO_EL_DIA],
    mie: [RANGO_TODO_EL_DIA],
    jue: [RANGO_TODO_EL_DIA],
    vie: [RANGO_TODO_EL_DIA],
    sab: [RANGO_TODO_EL_DIA],
    dom: [RANGO_TODO_EL_DIA],
  };
}

function horarioSinRangos(): Horario {
  return { lun: [], mar: [], mie: [], jue: [], vie: [], sab: [], dom: [] };
}

const DIAS_UTC = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"] as const;

/**
 * Cerrado "ahora" sin importar a qué hora real corra el test: el día de HOY
 * (en UTC, calculado en el momento de construir el horario) queda sin
 * rangos, y un día distinto sí los tiene -- así `proximaApertura` nunca
 * devuelve `null` (hay un día con rango dentro de la semana) ni depende de
 * la hora del reloj de quien corre la suite.
 */
function horarioCerradoHoyAbiertoOtroDia(): Horario {
  const vacio = horarioSinRangos();
  const otroDia = DIAS_UTC[(new Date().getUTCDay() + 1) % 7]!;
  return { ...vacio, [otroDia]: [RANGO_TODO_EL_DIA] };
}

/**
 * Deps del brief original (Step 1), con el horario 24/7 agregado. Sin el
 * agregado, `configProvider.activa()` no traía `horario`/`horario_timezone`
 * en absoluto -- eso solo no crasheaba porque la acción los toleraba
 * ausentes; el fix-round-1 la hizo fallar en voz alta si faltan (ver el
 * Minor del review), así que estas dos deps ahora necesitan un horario
 * completo para poder seguir probando SOLO el tope, que es lo que miden.
 */
function deps(salientesPrevios: number) {
  return {
    messages: { contarSalientesAutomaticos: vi.fn(async () => salientesPrevios) },
    plantillasSinSesion: { contarNoAnotadasDesde: vi.fn(async () => 0) },
    metaApi: { sendOutbound: vi.fn(async () => ({ id: "m1" })) },
    conversations: {
      findActivaByLead: vi.fn(async () => ({
        id: "c1",
        canal: "whatsapp",
        ultimo_entrante_at: new Date(),
      })),
    },
    leads: { findById: vi.fn(async () => ({ id: "l1", telefono: "+5215550001111" })) },
    sessions: {
      findById: vi.fn(async () => ({ id: "s1", current_stage: "considerando" })),
      findActiveByLeadId: vi.fn(async () => ({ id: "s1", current_stage: "considerando" })),
    },
    supresiones: { activasPorTelefonos: vi.fn(async () => []) },
    users: { findById: vi.fn(async () => ({ id: "u1", nombre: "Juan" })) },
    configProvider: {
      activa: vi.fn(async () => ({
        max_salientes_automaticos_24h: 3,
        horario: horarioSiempreAbierto(),
        horario_timezone: "UTC",
      })),
    },
  } as never;
}

type MockDeps = {
  supresiones: { activasPorTelefonos: { mock: { calls: unknown[][] } } };
  messages: { contarSalientesAutomaticos: { mock: { calls: unknown[][] } } };
  metaApi: { sendOutbound: { mock: { calls: unknown[][] } } };
  conversations: { findActivaByLead: { mock: { calls: unknown[][] } } };
  leads: { findById: { mock: { calls: unknown[][] } } };
};

function asMock(d: unknown): MockDeps {
  return d as never as MockDeps;
}

interface DepsOverrides {
  salientesPrevios?: number;
  max?: number;
  horario?: Horario;
  horarioTimezone?: string;
  conversacion?: { id: string; canal: string; ultimo_entrante_at: Date | null } | null;
  lead?: { id: string; telefono: string; [key: string]: unknown } | null;
  /** Etapa de la sesión activa del lead. `null` = no tiene sesión activa. */
  etapaActiva?: string | null;
  /** Teléfonos (normalizados) con una baja activa. */
  bajas?: string[];
  /** `false` = el puerto de bajas no está cableado. */
  conSupresiones?: boolean;
}

/**
 * Factory más configurable para los casos nuevos de este fix-round: horario
 * cerrado, ventana de Meta cerrada, conversación/lead ausentes. Por defecto
 * arma un escenario "manda sin problema" (mismo espíritu que `deps()`) para
 * que cada test sólo tenga que overridear el campo que le importa.
 */
function construirDeps(overrides: DepsOverrides = {}) {
  return {
    messages: { contarSalientesAutomaticos: vi.fn(async () => overrides.salientesPrevios ?? 0) },
    plantillasSinSesion: { contarNoAnotadasDesde: vi.fn(async () => 0) },
    metaApi: { sendOutbound: vi.fn(async () => ({ id: "m1" })) },
    conversations: {
      findActivaByLead: vi.fn(async () =>
        overrides.conversacion === undefined
          ? { id: "c1", canal: "whatsapp", ultimo_entrante_at: new Date() }
          : overrides.conversacion,
      ),
    },
    leads: {
      findById: vi.fn(async () =>
        overrides.lead === undefined ? { id: "l1", telefono: "+5215550001111" } : overrides.lead,
      ),
    },
    sessions: {
      findById: vi.fn(async () => ({ id: "s1", current_stage: "considerando" })),
      findActiveByLeadId: vi.fn(async () =>
        overrides.etapaActiva === null
          ? null
          : { id: "s1", current_stage: overrides.etapaActiva ?? "considerando" },
      ),
    },
    ...(overrides.conSupresiones === false
      ? {}
      : {
          supresiones: {
            activasPorTelefonos: vi.fn(async (tels: readonly string[]) =>
              (overrides.bajas ?? [])
                .filter((b) => tels.includes(b))
                .map((telefono) => ({ id: `baja-${telefono}`, telefono })),
            ),
          },
        }),
    users: { findById: vi.fn(async () => ({ id: "u1", nombre: "Juan" })) },
    configProvider: {
      activa: vi.fn(async () => ({
        max_salientes_automaticos_24h: overrides.max ?? 3,
        horario: overrides.horario ?? horarioSiempreAbierto(),
        horario_timezone: overrides.horarioTimezone ?? "UTC",
      })),
    },
  } as never;
}

describe("enviar_mensaje", () => {
  it("manda cuando esta bajo el tope, con idempotency key derivada del paso", async () => {
    const d = deps(1);
    const r = await crearAccionEnviarMensaje(d)(nodo, entorno);
    expect(r.puerto).toBe("salida");
    // La key es lo que evita el duplicado si Inngest reentrega el step.
    expect(asMock(d).metaApi.sendOutbound.mock.calls[0]![0]).toMatchObject({
      idempotencyKey: "wf:r1:7",
      sender: "sistema",
    });
  });

  it("la idempotency key sale de runId/orden de la corrida, no esta hardcodeada", async () => {
    const d = construirDeps();
    const otroEntorno = {
      leadId: "l9",
      leadSessionId: "s9",
      runId: "run-xyz",
      orden: 3,
      contexto: {},
    };
    await crearAccionEnviarMensaje(d)(nodo, otroEntorno);
    expect(asMock(d).metaApi.sendOutbound.mock.calls[0]![0]).toMatchObject({
      idempotencyKey: "wf:run-xyz:3",
    });
  });

  it("fuera de horario difiere y NO manda", async () => {
    const d = construirDeps({ horario: horarioCerradoHoyAbiertoOtroDia() });
    const r = await crearAccionEnviarMensaje(d)(nodo, entorno);
    expect(r.puerto).toBe("salida");
    expect(r.diferirHasta).toBeInstanceOf(Date);
    expect(r.salida).toEqual({ diferido: true });
    expect(asMock(d).metaApi.sendOutbound.mock.calls).toHaveLength(0);
    // El horario se chequea antes de buscar la conversación: cerrado, ni
    // siquiera llega a mirarla. El lead sí se lee antes: un dado de baja no
    // queda diferido horas para saltarse recién al despertar.
    expect(asMock(d).conversations.findActivaByLead.mock.calls).toHaveLength(0);
  });

  it("horario sin ningun rango es ValidationError, no un diferir infinito", async () => {
    const d = construirDeps({ horario: horarioSinRangos() });
    await expect(crearAccionEnviarMensaje(d)(nodo, entorno)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(asMock(d).metaApi.sendOutbound.mock.calls).toHaveLength(0);
  });

  it("sin conversacion activa es NotFoundError", async () => {
    const d = construirDeps({ conversacion: null });
    await expect(crearAccionEnviarMensaje(d)(nodo, entorno)).rejects.toBeInstanceOf(NotFoundError);
    expect(asMock(d).metaApi.sendOutbound.mock.calls).toHaveLength(0);
  });

  it("sin lead es NotFoundError", async () => {
    const d = construirDeps({ lead: null });
    await expect(crearAccionEnviarMensaje(d)(nodo, entorno)).rejects.toBeInstanceOf(NotFoundError);
    expect(asMock(d).metaApi.sendOutbound.mock.calls).toHaveLength(0);
  });

  it("sin texto en el nodo es ValidationError", async () => {
    const d = construirDeps();
    const nodoSinTexto = { ...nodo, config: { accion: "enviar_mensaje" } };
    await expect(crearAccionEnviarMensaje(d)(nodoSinTexto, entorno)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(asMock(d).metaApi.sendOutbound.mock.calls).toHaveLength(0);
  });

  // El canvas escribe el texto en `mensaje` (`ConfigMensajeria.tsx`), no en
  // `texto` como el nodo legacy. Mismo handler para los dos.
  it("msg_texto del canvas manda el texto de config.mensaje, interpolado", async () => {
    const d = construirDeps({
      lead: { id: "l1", telefono: "+5215550001111", nombre: "María", canal_origen: "wa" },
    });
    const nodoCanvas = {
      id: "m",
      tipo: "msg_texto" as const,
      config: { mensaje: "Hola {{lead.nombre}}" },
      posicion: { x: 0, y: 0 },
    };
    await crearAccionEnviarMensaje(d)(nodoCanvas, entorno);
    expect(asMock(d).metaApi.sendOutbound.mock.calls[0]![0]).toMatchObject({
      contenido: "Hola María",
    });
  });

  it("un canal elegido en el nodo que no es el de la conversación activa falla y NO manda", async () => {
    const d = construirDeps({
      conversacion: { id: "c1", canal: "wa", ultimo_entrante_at: new Date() },
    });
    const nodoInstagram = {
      id: "m",
      tipo: "msg_texto" as const,
      config: { mensaje: "hola", canal: "instagram" },
      posicion: { x: 0, y: 0 },
    };
    await expect(crearAccionEnviarMensaje(d)(nodoInstagram, entorno)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(asMock(d).metaApi.sendOutbound.mock.calls).toHaveLength(0);
  });

  it("el canal 'whatsapp' elegido en el nodo coincide con una conversación de WhatsApp", async () => {
    const d = construirDeps({
      conversacion: { id: "c1", canal: "wa", ultimo_entrante_at: new Date() },
    });
    const nodoWa = {
      id: "m",
      tipo: "msg_texto" as const,
      config: { mensaje: "hola", canal: "whatsapp" },
      posicion: { x: 0, y: 0 },
    };
    await crearAccionEnviarMensaje(d)(nodoWa, entorno);
    expect(asMock(d).metaApi.sendOutbound.mock.calls).toHaveLength(1);
  });

  it("el horario y el tope se miden con el reloj del entorno, no con el reloj real", async () => {
    // Abierto sólo los lunes. El reloj del entorno cae un domingo: tiene que
    // diferir aunque el test corra un lunes. Es lo que deja que "Probar" y el
    // simulador salteen esperas con un reloj virtual.
    const soloLunes: Horario = { ...horarioSinRangos(), lun: [RANGO_TODO_EL_DIA] };
    const domingo = new Date("2026-09-13T15:00:00Z");
    const d = construirDeps({ horario: soloLunes });
    const r = await crearAccionEnviarMensaje(d)(nodo, { ...entorno, ahora: domingo });
    expect(r.diferirHasta?.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(asMock(d).messages.contarSalientesAutomaticos.mock.calls[0]![1]).toEqual(
      new Date(domingo.getTime() - 24 * 60 * 60 * 1000),
    );
  });

  it("interpola variables en el texto antes de enviar", async () => {
    const d = construirDeps({
      lead: { id: "l1", telefono: "+5215550001111", nombre: "María", canal_origen: "whatsapp" },
    });
    const nodoConVariables = {
      ...nodo,
      config: { accion: "enviar_mensaje", texto: "Hola {{lead.nombre}}" },
    };
    const r = await crearAccionEnviarMensaje(d)(nodoConVariables, entorno);
    expect(r.puerto).toBe("salida");
    // Verificar que metaApi.sendOutbound recibe el texto interpolado
    expect(asMock(d).metaApi.sendOutbound.mock.calls[0]![0]).toMatchObject({
      contenido: "Hola María",
    });
  });
});

/**
 * PRD §6.6: un tope que salta un mensaje NO es un fallo. La acción devuelve
 * `salto` con el motivo, no manda nada y no tira: el ejecutor saca al lead del
 * flujo y la corrida termina con ese motivo.
 */
describe("enviar_mensaje — topes de seguridad (PRD §6.6)", () => {
  it("tope_frecuencia: con el cupo de 24 h gastado salta, no manda y no tira", async () => {
    const d = construirDeps({ salientesPrevios: 3, max: 3 });
    const r = await crearAccionEnviarMensaje(d)(nodo, entorno);
    expect(r.salto?.motivo).toBe("tope_frecuencia");
    expect(r.diferirHasta).toBeUndefined();
    expect(asMock(d).metaApi.sendOutbound.mock.calls).toHaveLength(0);
  });

  it("sin_ventana: con la ventana de 24 h de Meta cerrada salta y no degrada a plantilla", async () => {
    const haceDosDias = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const d = construirDeps({
      conversacion: { id: "c1", canal: "whatsapp", ultimo_entrante_at: haceDosDias },
    });
    const r = await crearAccionEnviarMensaje(d)(nodo, entorno);
    expect(r.salto?.motivo).toBe("sin_ventana");
    expect(asMock(d).metaApi.sendOutbound.mock.calls).toHaveLength(0);
  });

  it("sin_ventana: una conversación sin ningún entrante también salta", async () => {
    const d = construirDeps({
      conversacion: { id: "c1", canal: "whatsapp", ultimo_entrante_at: null },
    });
    const r = await crearAccionEnviarMensaje(d)(nodo, entorno);
    expect(r.salto?.motivo).toBe("sin_ventana");
    expect(asMock(d).metaApi.sendOutbound.mock.calls).toHaveLength(0);
  });

  it("requiere_humano: con la sesión activa en requiere_humano salta antes de todo", async () => {
    const d = construirDeps({ etapaActiva: "requiere_humano" });
    const r = await crearAccionEnviarMensaje(d)(nodo, entorno);
    expect(r.salto?.motivo).toBe("requiere_humano");
    expect(asMock(d).metaApi.sendOutbound.mock.calls).toHaveLength(0);
    // Ni gasta una lectura del tope: una persona está a cargo y punto.
    expect(asMock(d).messages.contarSalientesAutomaticos.mock.calls).toHaveLength(0);
  });

  it("un lead sin sesión activa no cuenta como requiere_humano", async () => {
    const d = construirDeps({ etapaActiva: null });
    const r = await crearAccionEnviarMensaje(d)(nodo, entorno);
    expect(r.salto).toBeUndefined();
    expect(asMock(d).metaApi.sendOutbound.mock.calls).toHaveLength(1);
  });

  it("dado_de_baja: busca la baja por el teléfono normalizado, salta y no manda", async () => {
    const d = construirDeps({
      lead: { id: "l1", telefono: "+52 1 555 000 1111" },
      bajas: ["5215550001111"],
    });
    const r = await crearAccionEnviarMensaje(d)(nodo, entorno);
    expect(r.salto?.motivo).toBe("dado_de_baja");
    expect(asMock(d).supresiones.activasPorTelefonos.mock.calls[0]![0]).toEqual(["5215550001111"]);
    expect(asMock(d).metaApi.sendOutbound.mock.calls).toHaveLength(0);
  });

  it("dado_de_baja le gana al tope: se registra el motivo más permanente", async () => {
    const d = construirDeps({ bajas: ["5215550001111"], salientesPrevios: 9 });
    const r = await crearAccionEnviarMensaje(d)(nodo, entorno);
    expect(r.salto?.motivo).toBe("dado_de_baja");
  });

  it("un lead de Instagram (sin teléfono de WhatsApp) no se consulta en bajas y manda", async () => {
    const d = construirDeps({
      lead: { id: "l1", telefono: "ig:17841400000000000" },
      conversacion: { id: "c1", canal: "ig", ultimo_entrante_at: new Date() },
    });
    const r = await crearAccionEnviarMensaje(d)(nodo, entorno);
    expect(r.salto).toBeUndefined();
    expect(asMock(d).supresiones.activasPorTelefonos.mock.calls).toHaveLength(0);
    expect(asMock(d).metaApi.sendOutbound.mock.calls).toHaveLength(1);
  });

  it("sin el puerto de bajas cableado falla cerrado: IllegalStateError y no manda", async () => {
    const d = construirDeps({ conSupresiones: false });
    await expect(crearAccionEnviarMensaje(d)(nodo, entorno)).rejects.toBeInstanceOf(
      IllegalStateError,
    );
    expect(asMock(d).metaApi.sendOutbound.mock.calls).toHaveLength(0);
  });

  it("el salto trae un detalle legible, sin el teléfono del lead", async () => {
    const d = construirDeps({ bajas: ["5215550001111"] });
    const r = await crearAccionEnviarMensaje(d)(nodo, entorno);
    expect(r.salto?.detalle).toMatch(/baja/i);
    expect(r.salto?.detalle).not.toContain("5550001111");
  });
});
