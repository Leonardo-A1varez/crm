/**
 * "Delegar al agente" (PRD §4.5): el estado de un tramo delegado y la decisión
 * de por cuál de sus cinco salidas vuelve el flujo.
 *
 * El bloque **no contesta nada**. Mientras está activo el agente vendedor del
 * pipeline sigue respondiendo cada mensaje —con las instrucciones del tramo
 * sumadas a su prompt— y el flujo lo observa: cada turno del agente emite
 * `workflow/delegacion.turno`, que despierta la corrida, y el nodo decide si
 * vuelve o sigue esperando. Como el único que le escribe al cliente es el
 * pipeline, no hay dos respuestas al mismo mensaje.
 *
 * Mismo patrón de dos pasadas que botones y lista (`respuesta-interactiva.ts`):
 * la primera deja acá qué nodo delega y hasta cuándo, el segmento corta, y
 * cada turno (o el vencimiento) vuelve a correr el nodo con el turno anotado.
 *
 * Clave con `$`, como la marca de Probar: ninguna variable ni condición la ve.
 */

import type { HandoffEvent } from "@/types/entities";
import type { ContextoRun, PuertoDelegacion } from "@/types/workflows";

export const CLAVE_DELEGACION = "$delegacion";

/**
 * Qué pasó en la conversación mientras el agente tenía el tramo:
 * - `turno`: el agente corrió un turno con las instrucciones del tramo. Lo
 *   avisa el extractor del Twin cuando termina (`update-lead-twin`), no el
 *   pipeline: así la condición del Twin ve el dato de ESTE turno y hay un solo
 *   aviso por turno. Dos avisos seguidos se pisaban: el segundo llegaba
 *   mientras la corrida procesaba el primero, sin nadie esperándolo, y se
 *   perdía (medido en local: 380 ms entre uno y otro);
 * - `error`: ese turno falló (el pipeline agotó sus reintentos);
 * - `baja`: el lead mandó una palabra de baja.
 */
export const TIPOS_TURNO_DELEGACION = ["turno", "error", "baja"] as const;
export type TipoTurnoDelegacion = (typeof TIPOS_TURNO_DELEGACION)[number];

// `type` y no `interface`: viaja como payload de un evento de Inngest, que exige
// que sea asignable a `Record<string, unknown>`.
export type TurnoDelegacion = {
  tipo: TipoTurnoDelegacion;
  /** El mensaje entrante que abrió el turno. */
  mensajeId: string | null;
  /**
   * Las corridas cuya delegación vio el agente en ese turno. Una corrida que
   * no está acá no cuenta el turno: el agente no tenía sus instrucciones.
   */
  runIds: string[];
  /** El intent que clasificó el turno, por id. */
  intentId: string | null;
  /** El agente le mandó una respuesta al cliente. */
  respondio: boolean;
};

/**
 * Lo que el pipeline le pasa al extractor para que avise el turno a los tramos
 * (`lead-session/turn.completed`).
 */
export type DelegacionDelTurno = Pick<TurnoDelegacion, "runIds" | "intentId" | "respondio">;

export interface EstadoDelegacion {
  nodoId: string;
  /** ISO. Cuándo arrancó el tramo. */
  desde: string;
  /** ISO. El tiempo máximo: fijo desde la primera pasada, no se estira. */
  hasta: string;
  /** Turnos del agente que ya vio este tramo. */
  turnos: number;
  /** Gasto de LLM de la sesión al arrancar: el del tramo es la diferencia. */
  costoBaseUsd: number;
  /** Lo que el agente suma a su prompt mientras dura el tramo. */
  instrucciones: string | null;
  /** El turno que despertó esta pasada. Ausente = venció el tiempo máximo. */
  ultimo?: TurnoDelegacion;
}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function turnoDe(v: unknown): TurnoDelegacion | undefined {
  if (!esObjeto(v)) return undefined;
  const tipo = v["tipo"];
  if (!(TIPOS_TURNO_DELEGACION as readonly unknown[]).includes(tipo)) return undefined;
  const runIds = Array.isArray(v["runIds"])
    ? v["runIds"].filter((r): r is string => typeof r === "string")
    : [];
  return {
    tipo: tipo as TipoTurnoDelegacion,
    mensajeId: typeof v["mensajeId"] === "string" ? v["mensajeId"] : null,
    runIds,
    intentId: typeof v["intentId"] === "string" ? v["intentId"] : null,
    respondio: v["respondio"] === true,
  };
}

function estadoDe(v: unknown): EstadoDelegacion | null {
  if (!esObjeto(v)) return null;
  const { nodoId, desde, hasta, turnos, costoBaseUsd, instrucciones } = v;
  if (typeof nodoId !== "string" || typeof desde !== "string" || typeof hasta !== "string") {
    return null;
  }
  const ultimo = turnoDe(v["ultimo"]);
  return {
    nodoId,
    desde,
    hasta,
    turnos: typeof turnos === "number" ? turnos : 0,
    costoBaseUsd: typeof costoBaseUsd === "number" ? costoBaseUsd : 0,
    instrucciones: typeof instrucciones === "string" ? instrucciones : null,
    ...(ultimo ? { ultimo } : {}),
  };
}

/** El tramo delegado anotado en el contexto, si es de este nodo. */
export function delegacionDe(contexto: ContextoRun, nodoId: string): EstadoDelegacion | null {
  const estado = estadoDe(contexto[CLAVE_DELEGACION]);
  return estado?.nodoId === nodoId ? estado : null;
}

/**
 * El tramo de una corrida que sigue vivo a esta hora, con sus instrucciones.
 * Es lo que lee el pipeline antes de cada turno del agente.
 */
export function delegacionActivaDe(
  contexto: ContextoRun,
  ahora: Date,
): { nodoId: string; instrucciones: string | null } | null {
  const estado = estadoDe(contexto[CLAVE_DELEGACION]);
  if (!estado) return null;
  const hasta = Date.parse(estado.hasta);
  if (Number.isNaN(hasta) || hasta <= ahora.getTime()) return null;
  return { nodoId: estado.nodoId, instrucciones: estado.instrucciones };
}

/** Lo que deja cada pasada que sigue esperando. `ultimo` no viaja: ya se leyó. */
export function marcarDelegacion(estado: EstadoDelegacion): ContextoRun {
  const { ultimo: _leido, ...resto } = estado;
  return { [CLAVE_DELEGACION]: resto };
}

/**
 * El contexto con el turno que despertó la espera. Sin delegación anotada,
 * igual: un turno que llega a una corrida que ya no delega no se inventa a qué
 * nodo pertenece.
 */
export function conTurnoAgente(contexto: ContextoRun, turno: TurnoDelegacion): ContextoRun {
  const v = contexto[CLAVE_DELEGACION];
  if (!esObjeto(v)) return contexto;
  return { ...contexto, [CLAVE_DELEGACION]: { ...v, ultimo: turno } };
}

/** Lo que deja la pasada que sale: el tramo terminó. */
export const DELEGACION_TERMINADA: ContextoRun = { [CLAVE_DELEGACION]: null };

export type MotivoPausa = HandoffEvent["reason_code"];

/**
 * Por cuál salida vuelve un tramo cuando la sesión quedó en manos de una
 * persona. **Humano**: lo pidió el lead (palabra que escala, regla de handoff)
 * o una persona lo tomó. **No pudo**: el sistema escaló porque el agente llegó
 * a su límite (no entendió, cotización o descuento por encima del tope). Sin
 * motivo registrado, Humano: la sesión igual está en manos de alguien.
 */
export function salidaDePausa(motivo: MotivoPausa | null): "humano" | "no_pudo" {
  return motivo === "unknown_intents" || motivo === "quote_limit" || motivo === "discount_limit"
    ? "no_pudo"
    : "humano";
}

export type MotivoSalidaDelegacion =
  | "intent"
  | "campo_twin"
  | "pausa"
  | "sesion_cerrada"
  | "sin_respuesta_ia"
  | "tope_turnos"
  | "tope_costo"
  | "tope_gasto_diario"
  | "vencio"
  | "turno_fallido"
  | "sin_sesion";

export type DecisionDelegacion =
  | { tipo: "salir"; puerto: PuertoDelegacion; motivo: MotivoSalidaDelegacion }
  /** El lead se dio de baja: sale del flujo sin seguir por ninguna salida. */
  | { tipo: "baja" }
  | { tipo: "esperar" };

export interface EntradaDecision {
  /** El turno que despertó la pasada; `null` = venció el tiempo máximo. */
  turno: TurnoDelegacion | null;
  /** La primera pasada: todavía no hubo turno y tampoco venció nada. */
  inicio?: boolean;
  sesion: {
    /** La sesión ya terminó (éxito o perdido). */
    cerrada: boolean;
    /** IA pausada o en `requiere_humano`. */
    enManosDePersona: boolean;
    motivoPausa: MotivoPausa | null;
  };
  /** El intent de "Volver cuando se detecte el intent", por id. */
  intentObjetivo: string | null;
  /** "Un campo del Twin cumpla": ya evaluada con los campos vivos. */
  twinCumple: boolean;
  /**
   * El intent del último turno clasificado, leído de la base, es el elegido y
   * es de un mensaje posterior al arranque del tramo. Cubre el turno cuyo
   * aviso llegó mientras la corrida procesaba otro y nadie lo esperaba.
   */
  intentVivoCumple: boolean;
  /** Contando el turno de esta pasada. */
  turnos: number;
  maxTurnos: number;
  /** Gasto de LLM del tramo, contando el de este turno. */
  costoUsd: number;
  maxCostoUsd: number;
  /** Gasto de LLM del día y el tope diario del agente (`agente_config`). */
  gastoDiaUsd: number;
  topeDiaUsd: number;
}

/**
 * Por dónde vuelve el flujo, o si sigue esperando. El orden es la prioridad
 * cuando en un mismo turno pasan varias cosas:
 *
 * 1. una baja saca al lead del flujo (nadie le vuelve a escribir);
 * 2. un turno que falló sale por Error;
 * 3. una persona a cargo (sesión cerrada o pausada) gana sobre cualquier
 *    contenido: si el agente ya no conversa, el tramo terminó;
 * 4. se cumplió lo que se esperaba: Resuelto;
 * 5. el agente no pudo o se llegó a un tope: No pudo;
 * 6. sin turno, venció el tiempo máximo: Sin respuesta.
 *
 * El intent cuenta el del turno avisado o el último leído de la base (ver
 * `intentVivoCumple`).
 */
export function decidirDelegacion(e: EntradaDecision): DecisionDelegacion {
  const salir = (puerto: PuertoDelegacion, motivo: MotivoSalidaDelegacion): DecisionDelegacion => ({
    tipo: "salir",
    puerto,
    motivo,
  });
  const turno = e.turno;
  if (turno?.tipo === "baja") return { tipo: "baja" };
  if (turno?.tipo === "error") return salir("error", "turno_fallido");
  if (e.sesion.cerrada) return salir("humano", "sesion_cerrada");
  if (e.sesion.enManosDePersona) return salir(salidaDePausa(e.sesion.motivoPausa), "pausa");
  const intentDelTurno =
    turno?.tipo === "turno" &&
    e.intentObjetivo !== null &&
    turno.intentId !== null &&
    turno.intentId === e.intentObjetivo;
  if (intentDelTurno || e.intentVivoCumple) return salir("resuelto", "intent");
  if (e.twinCumple) return salir("resuelto", "campo_twin");
  if (turno?.tipo === "turno" && !turno.respondio) return salir("no_pudo", "sin_respuesta_ia");
  if (e.turnos >= e.maxTurnos) return salir("no_pudo", "tope_turnos");
  if (e.costoUsd >= e.maxCostoUsd) return salir("no_pudo", "tope_costo");
  if (e.gastoDiaUsd >= e.topeDiaUsd) return salir("no_pudo", "tope_gasto_diario");
  if (turno === null && e.inicio !== true) return salir("sin_respuesta", "vencio");
  return { tipo: "esperar" };
}
