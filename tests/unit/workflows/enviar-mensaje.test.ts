import { describe, expect, it, vi } from "vitest";
import { crearAccionEnviarMensaje } from "@/server/services/workflows/acciones/enviar-mensaje";
import { BudgetExceededError, NotFoundError, ValidationError } from "@/lib/errors";
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
    metaApi: { sendOutbound: vi.fn(async () => ({ id: "m1" })) },
    conversations: {
      findActivaByLead: vi.fn(async () => ({
        id: "c1",
        canal: "whatsapp",
        ultimo_entrante_at: new Date(),
      })),
    },
    leads: { findById: vi.fn(async () => ({ id: "l1", telefono: "+5215550001111" })) },
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
  lead?: { id: string; telefono: string } | null;
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

  it("al topar NO manda, y falla en voz alta", async () => {
    const d = deps(3);
    await expect(crearAccionEnviarMensaje(d)(nodo, entorno)).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(asMock(d).metaApi.sendOutbound.mock.calls).toHaveLength(0);
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
    // El horario se chequea antes de buscar conversación/lead: cerrado, ni
    // siquiera llega a mirarlos.
    expect(asMock(d).conversations.findActivaByLead.mock.calls).toHaveLength(0);
    expect(asMock(d).leads.findById.mock.calls).toHaveLength(0);
  });

  it("horario sin ningun rango es ValidationError, no un diferir infinito", async () => {
    const d = construirDeps({ horario: horarioSinRangos() });
    await expect(crearAccionEnviarMensaje(d)(nodo, entorno)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(asMock(d).metaApi.sendOutbound.mock.calls).toHaveLength(0);
  });

  it("fuera de la ventana de 24h de Meta es ValidationError y no degrada a plantilla", async () => {
    const haceDosDias = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const d = construirDeps({
      conversacion: { id: "c1", canal: "whatsapp", ultimo_entrante_at: haceDosDias },
    });
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
});
