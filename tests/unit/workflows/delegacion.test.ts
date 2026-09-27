import { describe, expect, it } from "vitest";
import {
  CLAVE_DELEGACION,
  DELEGACION_TERMINADA,
  conTurnoAgente,
  decidirDelegacion,
  delegacionActivaDe,
  delegacionDe,
  marcarDelegacion,
  salidaDePausa,
  type EntradaDecision,
  type EstadoDelegacion,
  type TurnoDelegacion,
} from "@/lib/workflows/delegacion";
import { etiquetaDePuerto, puertosDe, puertosDeNodo } from "@/lib/workflows/validar-grafo";

/**
 * "Delegar al agente" (PRD §4.5): el estado que viaja en el contexto de la
 * corrida mientras el agente conversa, y la decisión de por cuál de las cinco
 * salidas vuelve el flujo.
 */

const ESTADO: EstadoDelegacion = {
  nodoId: "d",
  desde: "2026-09-26T10:00:00.000Z",
  hasta: "2026-09-27T10:00:00.000Z",
  turnos: 0,
  costoBaseUsd: 0.01,
  instrucciones: "Pedí el año antes de cotizar.",
};

const TURNO: TurnoDelegacion = {
  tipo: "turno",
  mensajeId: "m1",
  runIds: ["r1"],
  intentId: null,
  respondio: true,
};

function entrada(over: Partial<EntradaDecision> = {}): EntradaDecision {
  return {
    turno: TURNO,
    sesion: { cerrada: false, enManosDePersona: false, motivoPausa: null },
    intentObjetivo: "intent-cotizar",
    twinCumple: false,
    intentVivoCumple: false,
    turnos: 1,
    maxTurnos: 20,
    costoUsd: 0.02,
    maxCostoUsd: 0.5,
    gastoDiaUsd: 1,
    topeDiaUsd: 10,
    ...over,
  };
}

describe("puertos de Delegar al agente", () => {
  it("tiene las cinco salidas del PRD, en el orden del diseño", () => {
    expect(puertosDe("ia_delegar")).toEqual([
      "resuelto",
      "humano",
      "no_pudo",
      "sin_respuesta",
      "error",
    ]);
    expect(puertosDeNodo({ tipo: "ia_delegar", config: {} })).toHaveLength(5);
  });

  it("nombra cada salida como el diseño", () => {
    const nodo = { tipo: "ia_delegar" as const, config: {} };
    expect(puertosDe("ia_delegar").map((p) => etiquetaDePuerto(nodo, p))).toEqual([
      "Resuelto",
      "Humano",
      "No pudo",
      "Sin respuesta",
      "Error",
    ]);
  });
});

describe("estado de la delegación en el contexto", () => {
  it("se lee sólo para el nodo que la dejó", () => {
    const ctx = { previo: 1, ...marcarDelegacion(ESTADO) };
    expect(delegacionDe(ctx, "d")).toEqual(ESTADO);
    expect(delegacionDe(ctx, "otro")).toBeNull();
    expect(delegacionDe({}, "d")).toBeNull();
  });

  it("anota el turno que despertó la espera", () => {
    const ctx = conTurnoAgente(marcarDelegacion(ESTADO), TURNO);
    expect(delegacionDe(ctx, "d")?.ultimo).toEqual(TURNO);
  });

  it("no inventa una delegación si la corrida no espera ninguna", () => {
    expect(conTurnoAgente({ a: 1 }, TURNO)).toEqual({ a: 1 });
  });

  it("una delegación terminada no se lee", () => {
    const ctx = { ...marcarDelegacion(ESTADO), ...DELEGACION_TERMINADA };
    expect(ctx[CLAVE_DELEGACION]).toBeNull();
    expect(delegacionDe(ctx, "d")).toBeNull();
  });

  it("activa = no venció: da las instrucciones para el prompt del agente", () => {
    const ctx = marcarDelegacion(ESTADO);
    expect(delegacionActivaDe(ctx, new Date("2026-09-26T12:00:00Z"))).toEqual({
      nodoId: "d",
      instrucciones: "Pedí el año antes de cotizar.",
    });
    expect(delegacionActivaDe(ctx, new Date("2026-09-27T10:00:00Z"))).toBeNull();
    expect(delegacionActivaDe({}, new Date())).toBeNull();
  });
});

describe("salidaDePausa", () => {
  it("lo pidió el lead o lo tomó una persona: Humano", () => {
    for (const m of ["sensitive_keyword", "rule_handoff", "manual_pause", "other", null] as const) {
      expect(salidaDePausa(m)).toBe("humano");
    }
  });

  it("el agente llegó a su límite: No pudo", () => {
    for (const m of ["unknown_intents", "quote_limit", "discount_limit"] as const) {
      expect(salidaDePausa(m)).toBe("no_pudo");
    }
  });
});

describe("decidirDelegacion", () => {
  it("sigue esperando si el turno no cumple nada", () => {
    expect(decidirDelegacion(entrada())).toEqual({ tipo: "esperar" });
  });

  it("el intent elegido la resuelve", () => {
    expect(decidirDelegacion(entrada({ turno: { ...TURNO, intentId: "intent-cotizar" } }))).toEqual(
      { tipo: "salir", puerto: "resuelto", motivo: "intent" },
    );
  });

  it("la condición del Twin la resuelve, también al vencer", () => {
    expect(decidirDelegacion(entrada({ twinCumple: true }))).toEqual({
      tipo: "salir",
      puerto: "resuelto",
      motivo: "campo_twin",
    });
    expect(decidirDelegacion(entrada({ twinCumple: true, turno: null }))).toMatchObject({
      puerto: "resuelto",
    });
  });

  it("el intent del último turno leído de la base también resuelve (un turno que se perdió)", () => {
    expect(decidirDelegacion(entrada({ intentVivoCumple: true }))).toEqual({
      tipo: "salir",
      puerto: "resuelto",
      motivo: "intent",
    });
  });

  it("la sesión en manos de una persona sale por el motivo de la pausa", () => {
    const pausa = (motivoPausa: "sensitive_keyword" | "unknown_intents") =>
      entrada({ sesion: { cerrada: false, enManosDePersona: true, motivoPausa } });
    expect(decidirDelegacion(pausa("sensitive_keyword"))).toEqual({
      tipo: "salir",
      puerto: "humano",
      motivo: "pausa",
    });
    expect(decidirDelegacion(pausa("unknown_intents"))).toEqual({
      tipo: "salir",
      puerto: "no_pudo",
      motivo: "pausa",
    });
  });

  it("la pausa gana sobre el intent del mismo turno", () => {
    expect(
      decidirDelegacion(
        entrada({
          turno: { ...TURNO, intentId: "intent-cotizar" },
          sesion: { cerrada: false, enManosDePersona: true, motivoPausa: "sensitive_keyword" },
        }),
      ),
    ).toMatchObject({ puerto: "humano" });
  });

  it("una sesión cerrada vuelve por Humano", () => {
    expect(
      decidirDelegacion(
        entrada({ sesion: { cerrada: true, enManosDePersona: false, motivoPausa: null } }),
      ),
    ).toEqual({ tipo: "salir", puerto: "humano", motivo: "sesion_cerrada" });
  });

  it("el turno que falló sale por Error, antes que todo", () => {
    expect(
      decidirDelegacion(
        entrada({
          turno: { ...TURNO, tipo: "error", intentId: "intent-cotizar" },
          sesion: { cerrada: false, enManosDePersona: true, motivoPausa: "sensitive_keyword" },
        }),
      ),
    ).toEqual({ tipo: "salir", puerto: "error", motivo: "turno_fallido" });
  });

  it("una baja saca al lead del flujo", () => {
    expect(decidirDelegacion(entrada({ turno: { ...TURNO, tipo: "baja" } }))).toEqual({
      tipo: "baja",
    });
  });

  it("el agente no contestó sin pasar a una persona: No pudo", () => {
    expect(decidirDelegacion(entrada({ turno: { ...TURNO, respondio: false } }))).toEqual({
      tipo: "salir",
      puerto: "no_pudo",
      motivo: "sin_respuesta_ia",
    });
  });

  it("los topes de turnos, costo del tramo y gasto del día salen por No pudo", () => {
    expect(decidirDelegacion(entrada({ turnos: 20 }))).toMatchObject({
      puerto: "no_pudo",
      motivo: "tope_turnos",
    });
    expect(decidirDelegacion(entrada({ costoUsd: 0.5 }))).toMatchObject({
      puerto: "no_pudo",
      motivo: "tope_costo",
    });
    expect(decidirDelegacion(entrada({ gastoDiaUsd: 10 }))).toMatchObject({
      puerto: "no_pudo",
      motivo: "tope_gasto_diario",
    });
  });

  it("resolver en el último turno permitido gana sobre el tope", () => {
    expect(
      decidirDelegacion(entrada({ turnos: 20, turno: { ...TURNO, intentId: "intent-cotizar" } })),
    ).toMatchObject({ puerto: "resuelto" });
  });

  it("sin turno venció: Sin respuesta", () => {
    expect(decidirDelegacion(entrada({ turno: null }))).toEqual({
      tipo: "salir",
      puerto: "sin_respuesta",
      motivo: "vencio",
    });
  });

  it("al arrancar no hay turno y tampoco venció: espera", () => {
    expect(decidirDelegacion(entrada({ turno: null, inicio: true, turnos: 0 }))).toEqual({
      tipo: "esperar",
    });
  });

  it("al arrancar, una condición del Twin que ya se cumple la resuelve en el acto", () => {
    expect(
      decidirDelegacion(entrada({ turno: null, inicio: true, turnos: 0, twinCumple: true })),
    ).toMatchObject({ puerto: "resuelto" });
  });

  it("al vencer, una persona a cargo gana sobre Sin respuesta", () => {
    expect(
      decidirDelegacion(
        entrada({
          turno: null,
          sesion: { cerrada: false, enManosDePersona: true, motivoPausa: "manual_pause" },
        }),
      ),
    ).toMatchObject({ puerto: "humano" });
  });
});
