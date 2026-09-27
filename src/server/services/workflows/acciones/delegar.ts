import { configDeAccion, type ConfigDeAccion } from "@/lib/workflows/config-nodos";
import { CondicionSchema } from "@/lib/workflows/condiciones.schema";
import {
  camposVivosDe,
  esCondicionArbol,
  evaluarCondicion,
  type CampoCondicion,
} from "@/lib/workflows/condiciones";
import { CLAVE_INTENT_MENSAJE_AT, contextoDeDisparo } from "@/lib/workflows/contexto";
import {
  DELEGACION_TERMINADA,
  decidirDelegacion,
  delegacionDe,
  marcarDelegacion,
  type DecisionDelegacion,
  type EstadoDelegacion,
  type MotivoPausa,
  type TurnoDelegacion,
} from "@/lib/workflows/delegacion";
import type { LeadSession, UUID } from "@/types/entities";
import type { ContextoRun, Nodo, ResultadoAccion } from "@/types/workflows";
import type { CamposVivosDeps } from "../ejecutor.service";
import type { AccionHandler, EntornoAccion } from "./registro";

/**
 * Lo que la delegación lee afuera. Todo lectura: el bloque no escribe nada,
 * no manda nada y no llama al LLM (las llamadas del tramo son las del agente
 * del pipeline, que ya pasan por `recordLlmUsage`).
 */
export interface AccionDelegarDeps {
  sessions: { findById(id: UUID): Promise<LeadSession | null> };
  /** Por qué se pausó la sesión la última vez (`handoff_events`), o `null`. */
  pausas: { ultimoMotivo(sessionId: UUID): Promise<MotivoPausa | null> };
  gastoLlm: {
    /** Gasto de LLM registrado para la sesión (`llm_usage`), en USD. */
    deSesion(sessionId: UUID): Promise<number>;
    /** Gasto de LLM del día de `ahora` (UTC), en USD. */
    delDia(ahora: Date): Promise<number>;
    /** El tope diario del agente (`agente_config.tope_gasto_diario_usd`). */
    topeDiario(): Promise<number>;
  };
  /**
   * Los campos vivos de la condición del Twin y la zona del negocio. Sin esto
   * la condición se evalúa con el contexto y la sesión de ahora, en UTC.
   */
  camposVivos?: CamposVivosDeps;
}

const MINUTOS_MS = { minutos: 60_000, horas: 60 * 60_000, dias: 24 * 60 * 60_000 } as const;

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** `{ lead: {a} }` + `{ lead: {b} }` = `{ lead: {a, b} }`; gana `encima`. */
function mezclar(base: ContextoRun, encima: ContextoRun): ContextoRun {
  const salida: ContextoRun = { ...base };
  for (const [clave, valor] of Object.entries(encima)) {
    const previo = salida[clave];
    salida[clave] = esObjeto(valor) && esObjeto(previo) ? { ...previo, ...valor } : valor;
  }
  return salida;
}

/**
 * "Un campo del Twin cumpla": se evalúa con los datos de AHORA. El contexto de
 * la corrida tiene la etapa y la cotización del disparo, que después de horas
 * de conversación están viejas; encima van los de la sesión recién leída y los
 * campos vivos (intent, etiquetas, vehículo…).
 */
async function twinCumple(
  config: ConfigDeAccion<"delegar_al_agente">,
  contexto: ContextoRun,
  sesion: LeadSession,
  entorno: EntornoAccion,
  ahora: Date,
  deps: AccionDelegarDeps,
): Promise<boolean> {
  if (config.condicionTwin === undefined) return false;
  // El schema de la config ya exigió que sea evaluable; esto sólo la tipa.
  const condicion = CondicionSchema.parse(config.condicionTwin);
  let lectura = mezclar(contexto, contextoDeDisparo({ sesion }));
  let zona = "UTC";
  if (deps.camposVivos) {
    const campos = esCondicionArbol(condicion)
      ? camposVivosDe(condicion.arbol)
      : new Set<CampoCondicion>();
    const [vivos, z] = await Promise.all([
      campos.size > 0
        ? deps.camposVivos.cargar({
            leadId: entorno.leadId,
            leadSessionId: sesion.id,
            campos,
          })
        : Promise.resolve({}),
      deps.camposVivos.zona(),
    ]);
    lectura = mezclar(lectura, vivos);
    zona = z;
  }
  return evaluarCondicion(condicion, lectura, { ahora, zona });
}

/**
 * ¿El último turno clasificado de la sesión (base) trae el intent elegido y es
 * de un mensaje posterior al arranque del tramo? Cubre el aviso de un turno
 * que llegó mientras la corrida procesaba otro. Sin campos vivos, no.
 */
async function intentVivoCumple(
  intentObjetivo: string | null,
  desde: string | null,
  sesion: LeadSession,
  entorno: EntornoAccion,
  deps: AccionDelegarDeps,
): Promise<boolean> {
  if (intentObjetivo === null || desde === null || !deps.camposVivos) return false;
  const vivos = await deps.camposVivos.cargar({
    leadId: entorno.leadId,
    leadSessionId: sesion.id,
    campos: new Set<CampoCondicion>(["sesion.intent"]),
  });
  const s = vivos["sesion"];
  if (!esObjeto(s) || s["intent"] !== intentObjetivo) return false;
  const at = s[CLAVE_INTENT_MENSAJE_AT];
  return typeof at === "string" && Date.parse(at) > Date.parse(desde);
}

/** Redondea a centavo de centavo: es lo que se muestra y lo que se compara en la corrida. */
const usd = (n: number) => Math.round(n * 10_000) / 10_000;

function salidaDe(
  decision: Extract<DecisionDelegacion, { tipo: "salir" }>,
  turnos: number,
  costo: number,
  estado: EstadoDelegacion | null,
): ResultadoAccion {
  return {
    puerto: decision.puerto,
    ...(estado ? { contexto: DELEGACION_TERMINADA } : {}),
    salida: { vuelve_por: decision.puerto, motivo: decision.motivo, turnos, costo_usd: usd(costo) },
  };
}

/**
 * "Delegar al agente" (PRD §4.5). **No contesta nada**: le cede la
 * conversación al agente del pipeline, que sigue respondiendo cada mensaje con
 * las instrucciones del tramo sumadas a su prompt, y el flujo observa.
 *
 * Corre varias veces, como botones y lista (`enviar-rico.ts`):
 *
 * 1. **Primera pasada** (sin tramo anotado): si la conversación ya está en
 *    manos de una persona, o ya se cumple lo que se esperaba, o el gasto del
 *    día se agotó, vuelve en el acto. Si no, anota el tramo con su tiempo
 *    máximo fijo y pide esperar el turno del agente (`esperarTurnoAgente`).
 * 2. **Cada turno** (`workflow/delegacion.turno`, anotado por
 *    `workflow-segmento`): lo cuenta, suma lo gastado y decide
 *    (`decidirDelegacion`) si vuelve o sigue esperando hasta el MISMO tiempo
 *    máximo. Un turno que no vio esta delegación —el agente no tenía sus
 *    instrucciones— no cuenta.
 * 3. **Vencimiento** (sin turno): Sin respuesta, salvo que una persona ya
 *    tenga la conversación.
 *
 * El gasto del tramo es el de la sesión menos el que tenía al arrancar: incluye
 * clasificador, agente y extractor de cada turno.
 */
export function crearAccionDelegar(deps: AccionDelegarDeps): AccionHandler {
  return async (nodo: Nodo, entorno: EntornoAccion): Promise<ResultadoAccion> => {
    const ahora = entorno.ahora ?? new Date();
    // La config se valida antes de cualquier lectura: una mal armada falla
    // sin reintento.
    const config = configDeAccion("delegar_al_agente", nodo);
    const estado = delegacionDe(entorno.contexto, nodo.id);
    const turnoRecibido: TurnoDelegacion | null = estado?.ultimo ?? null;

    const sesion = entorno.leadSessionId
      ? await deps.sessions.findById(entorno.leadSessionId)
      : null;
    if (!sesion) {
      return salidaDe(
        { tipo: "salir", puerto: "error", motivo: "sin_sesion" },
        estado?.turnos ?? 0,
        0,
        estado,
      );
    }

    // Un turno que no vio esta delegación no es de este tramo: se descarta y
    // se sigue esperando como si no hubiera llegado.
    const turno =
      turnoRecibido && turnoRecibido.runIds.includes(entorno.runId) ? turnoRecibido : null;
    const descartado = turnoRecibido !== null && turno === null;

    const enManosDePersona = sesion.ia_pausada || sesion.current_stage === "requiere_humano";
    const intentObjetivo =
      config.intentId !== undefined && config.intentId.trim() !== "" ? config.intentId : null;
    const [motivoPausa, gastoSesion, gastoDia, topeDia, cumpleTwin, cumpleIntentVivo] =
      await Promise.all([
        enManosDePersona ? deps.pausas.ultimoMotivo(sesion.id) : Promise.resolve(null),
        deps.gastoLlm.deSesion(sesion.id),
        deps.gastoLlm.delDia(ahora),
        deps.gastoLlm.topeDiario(),
        twinCumple(config, entorno.contexto, sesion, entorno, ahora, deps),
        intentVivoCumple(intentObjetivo, estado?.desde ?? null, sesion, entorno, deps),
      ]);

    const costoBase = estado?.costoBaseUsd ?? gastoSesion;
    const costo = Math.max(0, gastoSesion - costoBase);
    const turnos = (estado?.turnos ?? 0) + (turno?.tipo === "turno" ? 1 : 0);
    const decision = decidirDelegacion({
      // Descartado: todavía no venció, así que tampoco es "sin turno".
      turno: descartado ? null : turno,
      inicio: estado === null || descartado,
      sesion: { cerrada: sesion.resultado !== null, enManosDePersona, motivoPausa },
      intentObjetivo,
      twinCumple: cumpleTwin,
      intentVivoCumple: cumpleIntentVivo,
      turnos,
      maxTurnos: config.maxTurnos,
      costoUsd: costo,
      maxCostoUsd: config.maxCostoUsd,
      gastoDiaUsd: gastoDia,
      topeDiaUsd: topeDia,
    });

    if (decision.tipo === "baja") {
      return {
        puerto: "salida",
        salto: {
          motivo: "dado_de_baja",
          detalle:
            "El lead se dio de baja mientras el agente tenía la conversación: el flujo no sigue por ninguna salida.",
        },
      };
    }
    if (decision.tipo === "salir") return salidaDe(decision, turnos, costo, estado);

    const siguiente: EstadoDelegacion = estado
      ? { ...estado, turnos }
      : {
          nodoId: nodo.id,
          desde: ahora.toISOString(),
          hasta: new Date(
            ahora.getTime() + config.timeout * MINUTOS_MS[config.unidadTimeout],
          ).toISOString(),
          turnos: 0,
          costoBaseUsd: gastoSesion,
          instrucciones:
            config.instrucciones !== undefined && config.instrucciones.trim() !== ""
              ? config.instrucciones.trim()
              : null,
        };
    return {
      // No se usa: el ejecutor corta y reanuda en este mismo nodo.
      puerto: "sin_respuesta",
      esperarTurnoAgente: { hasta: new Date(siguiente.hasta) },
      contexto: marcarDelegacion(siguiente),
      salida: {
        turnos,
        costo_usd: usd(costo),
        ...(intentObjetivo ? { esperando_intent: intentObjetivo } : {}),
        ...(config.condicionTwin ? { esperando_twin: true } : {}),
        ...(descartado ? { turno_ajeno: true } : {}),
      },
    };
  };
}
