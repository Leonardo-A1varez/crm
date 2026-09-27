import { describe, expect, it, vi } from "vitest";
import {
  crearAccionDelegar,
  type AccionDelegarDeps,
} from "@/server/services/workflows/acciones/delegar";
import {
  conTurnoAgente,
  delegacionDe,
  marcarDelegacion,
  type EstadoDelegacion,
  type TurnoDelegacion,
} from "@/lib/workflows/delegacion";
import { CLAVE_DELEGACION } from "@/lib/workflows/delegacion";
import type { LeadSession } from "@/types/entities";
import type { Nodo } from "@/types/workflows";

/**
 * La acción de "Delegar al agente": primera pasada (arranca el tramo y espera)
 * y las pasadas de cada turno o del vencimiento (decide la salida).
 */

const AHORA = new Date("2026-09-26T10:00:00.000Z");
const RUN = "run-1";
const SESION = "ses-1";

const nodo = (config: Record<string, unknown> = {}): Nodo => ({
  id: "d",
  tipo: "ia_delegar",
  config: { intentId: "intent-cotizar", instrucciones: "Pedí el año.", ...config },
  posicion: { x: 0, y: 0 },
});

function sesion(over: Partial<LeadSession> = {}): LeadSession {
  return {
    id: SESION,
    lead_id: "lead-1",
    current_stage: "consulta",
    etapa_alcanzada: "consulta",
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
    stage_before_handoff: null,
    extras: {},
    context_summary: null,
    procedencia: {},
    started_at: AHORA,
    updated_at: AHORA,
    closed_at: null,
    ...over,
  } as LeadSession;
}

function deps(over: Partial<AccionDelegarDeps> = {}, s = sesion()): AccionDelegarDeps {
  return {
    sessions: { findById: vi.fn(async (id: string) => (id === SESION ? s : null)) },
    pausas: { ultimoMotivo: vi.fn(async () => null) },
    gastoLlm: {
      deSesion: vi.fn(async () => 0.1),
      delDia: vi.fn(async () => 1),
      topeDiario: vi.fn(async () => 10),
    },
    ...over,
  };
}

const entorno = (contexto: Record<string, unknown> = {}, ahora = AHORA) => ({
  leadId: "lead-1",
  leadSessionId: SESION,
  runId: RUN,
  orden: 3,
  contexto,
  ahora,
});

const ESTADO: EstadoDelegacion = {
  nodoId: "d",
  desde: AHORA.toISOString(),
  hasta: "2026-09-27T10:00:00.000Z",
  turnos: 0,
  costoBaseUsd: 0.1,
  instrucciones: "Pedí el año.",
};

const TURNO: TurnoDelegacion = {
  tipo: "turno",
  mensajeId: "m1",
  runIds: [RUN],
  intentId: null,
  respondio: true,
};

const despues = (turno: TurnoDelegacion | null, estado = ESTADO) =>
  turno ? conTurnoAgente(marcarDelegacion(estado), turno) : marcarDelegacion(estado);

describe("Delegar al agente — primera pasada", () => {
  it("arranca el tramo: anota hasta cuándo y pide esperar el turno del agente", async () => {
    const r = await crearAccionDelegar(deps())(nodo(), entorno({ previo: 1 }));
    expect(r.esperarTurnoAgente).toEqual({ hasta: new Date("2026-09-27T10:00:00.000Z") });
    expect(delegacionDe(r.contexto ?? {}, "d")).toEqual(ESTADO);
    expect(r.salida).toMatchObject({ turnos: 0, costo_usd: 0, esperando_intent: "intent-cotizar" });
  });

  it("el tiempo máximo se cuenta en su unidad", async () => {
    const r = await crearAccionDelegar(deps())(
      nodo({ timeout: 2, unidadTimeout: "horas" }),
      entorno(),
    );
    expect(r.esperarTurnoAgente?.hasta).toEqual(new Date("2026-09-26T12:00:00.000Z"));
  });

  it("sin sesión no hay con quién conversar: Error", async () => {
    const r = await crearAccionDelegar(deps())(nodo(), { ...entorno(), leadSessionId: null });
    expect(r).toMatchObject({ puerto: "error", salida: { motivo: "sin_sesion" } });
    expect(r.esperarTurnoAgente).toBeUndefined();
  });

  it("si una persona ya tiene la conversación, vuelve en el acto por el motivo de la pausa", async () => {
    const d = deps(
      { pausas: { ultimoMotivo: vi.fn(async () => "unknown_intents" as const) } },
      sesion({ ia_pausada: true, current_stage: "requiere_humano" }),
    );
    const r = await crearAccionDelegar(d)(nodo(), entorno());
    expect(r).toMatchObject({ puerto: "no_pudo", salida: { motivo: "pausa" } });
  });

  it("con el gasto del día agotado no delega: No pudo", async () => {
    const d = deps({
      gastoLlm: {
        deSesion: vi.fn(async () => 0),
        delDia: vi.fn(async () => 10),
        topeDiario: vi.fn(async () => 10),
      },
    });
    const r = await crearAccionDelegar(d)(nodo(), entorno());
    expect(r).toMatchObject({ puerto: "no_pudo", salida: { motivo: "tope_gasto_diario" } });
  });

  it("una config inválida no arranca nada", async () => {
    await expect(
      crearAccionDelegar(deps())(nodo({ intentId: "", timeout: 0 }), entorno()),
    ).rejects.toThrow(/mal configurado/);
  });
});

describe("Delegar al agente — cada turno", () => {
  it("un turno que no resuelve cuenta y sigue esperando hasta el mismo tiempo máximo", async () => {
    const d = deps({
      gastoLlm: {
        deSesion: vi.fn(async () => 0.13),
        delDia: vi.fn(async () => 1),
        topeDiario: vi.fn(async () => 10),
      },
    });
    const r = await crearAccionDelegar(d)(nodo(), entorno(despues(TURNO)));
    expect(r.esperarTurnoAgente).toEqual({ hasta: new Date(ESTADO.hasta) });
    const estado = delegacionDe(r.contexto ?? {}, "d");
    expect(estado?.turnos).toBe(1);
    expect(estado?.ultimo).toBeUndefined();
    expect(r.salida).toMatchObject({ turnos: 1, costo_usd: 0.03 });
  });

  it("el intent elegido sale por Resuelto y cierra el tramo", async () => {
    const r = await crearAccionDelegar(deps())(
      nodo(),
      entorno(despues({ ...TURNO, intentId: "intent-cotizar" })),
    );
    expect(r).toMatchObject({
      puerto: "resuelto",
      salida: { motivo: "intent", turnos: 1 },
    });
    expect(r.contexto?.[CLAVE_DELEGACION]).toBeNull();
    expect(r.esperarTurnoAgente).toBeUndefined();
  });

  it("un turno que no vio esta delegación no cuenta", async () => {
    const r = await crearAccionDelegar(deps())(
      nodo(),
      entorno(despues({ ...TURNO, runIds: ["otra"], intentId: "intent-cotizar" })),
    );
    expect(r.esperarTurnoAgente).toBeDefined();
    expect(delegacionDe(r.contexto ?? {}, "d")?.turnos).toBe(0);
  });

  it("el agente escaló porque el lead pidió una persona: Humano", async () => {
    const d = deps(
      { pausas: { ultimoMotivo: vi.fn(async () => "sensitive_keyword" as const) } },
      sesion({ ia_pausada: true, current_stage: "requiere_humano" }),
    );
    const r = await crearAccionDelegar(d)(nodo(), entorno(despues(TURNO)));
    expect(r).toMatchObject({ puerto: "humano", salida: { motivo: "pausa" } });
  });

  it("el turno que falló sale por Error", async () => {
    const r = await crearAccionDelegar(deps())(
      nodo(),
      entorno(despues({ ...TURNO, tipo: "error" })),
    );
    expect(r).toMatchObject({ puerto: "error", salida: { motivo: "turno_fallido" } });
  });

  it("el tope de turnos sale por No pudo", async () => {
    const r = await crearAccionDelegar(deps())(
      nodo({ maxTurnos: 2 }),
      entorno(despues(TURNO, { ...ESTADO, turnos: 1 })),
    );
    expect(r).toMatchObject({ puerto: "no_pudo", salida: { motivo: "tope_turnos", turnos: 2 } });
  });

  it("el gasto del tramo sale por No pudo", async () => {
    const d = deps({
      gastoLlm: {
        deSesion: vi.fn(async () => 0.7),
        delDia: vi.fn(async () => 1),
        topeDiario: vi.fn(async () => 10),
      },
    });
    const r = await crearAccionDelegar(d)(nodo(), entorno(despues(TURNO)));
    expect(r).toMatchObject({ puerto: "no_pudo", salida: { motivo: "tope_costo" } });
  });

  it("una baja saca al lead del flujo", async () => {
    const r = await crearAccionDelegar(deps())(
      nodo(),
      entorno(despues({ ...TURNO, tipo: "baja" })),
    );
    expect(r.salto?.motivo).toBe("dado_de_baja");
  });

  it("sin turno venció: Sin respuesta", async () => {
    const r = await crearAccionDelegar(deps())(
      nodo(),
      entorno(despues(null), new Date(ESTADO.hasta)),
    );
    expect(r).toMatchObject({ puerto: "sin_respuesta", salida: { motivo: "vencio", turnos: 0 } });
  });
});

describe("Delegar al agente — condición del Twin", () => {
  const condicionTwin = {
    arbol: {
      id: "g",
      clase: "grupo",
      operador: "y",
      hijos: [
        {
          id: "r",
          clase: "regla",
          campoId: "lead.etapa",
          comparador: "es",
          valor: { tipo: "opcion", valor: "cotizado" },
        },
      ],
    },
  };

  it("lee la etapa de la sesión de ahora, no la del disparo", async () => {
    const d = deps({}, sesion({ current_stage: "cotizado" }));
    const r = await crearAccionDelegar(d)(
      nodo({ intentId: undefined, condicionTwin }),
      entorno({ ...despues(TURNO), lead: { etapa: "nuevo" } }),
    );
    expect(r).toMatchObject({ puerto: "resuelto", salida: { motivo: "campo_twin" } });
  });

  it("si no se cumple, sigue esperando", async () => {
    const r = await crearAccionDelegar(deps())(
      nodo({ intentId: undefined, condicionTwin }),
      entorno(despues(TURNO)),
    );
    expect(r.esperarTurnoAgente).toBeDefined();
  });
});

describe("Delegar al agente — un turno que no llegó", () => {
  it("si el último turno de la base, posterior al arranque, trae el intent elegido, resuelve", async () => {
    const cargar = vi.fn(async () => ({
      sesion: { intent: "intent-cotizar", intent_mensaje_at: "2026-09-26T10:05:00.000Z" },
    }));
    const d = deps({ camposVivos: { cargar, zona: async () => "UTC" } });
    const r = await crearAccionDelegar(d)(nodo(), entorno(despues(TURNO)));
    expect(r).toMatchObject({ puerto: "resuelto", salida: { motivo: "intent" } });
    expect(cargar).toHaveBeenCalledWith(
      expect.objectContaining({ campos: new Set(["sesion.intent"]) }),
    );
  });

  it("el intent de un turno de antes del tramo no cuenta", async () => {
    const d = deps({
      camposVivos: {
        cargar: vi.fn(async () => ({
          sesion: { intent: "intent-cotizar", intent_mensaje_at: "2026-09-26T09:59:00.000Z" },
        })),
        zona: async () => "UTC",
      },
    });
    const r = await crearAccionDelegar(d)(nodo(), entorno(despues(TURNO)));
    expect(r.esperarTurnoAgente).toBeDefined();
  });
});
