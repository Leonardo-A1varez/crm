import { esCondicion, esFinal } from "@/types/workflows";
import type { ContextoRun, Grafo, Nodo } from "@/types/workflows";
import { CondicionSchema } from "./condiciones.schema";
import {
  CAMPOS_VIVOS,
  camposVivosDe,
  esCondicionArbol,
  evaluarCondicion,
  type CampoCondicion,
  type Condicion,
  type OpcionesEvaluacion,
} from "./condiciones";
import { configDeDisparador, disparadorDe, siguienteNodo } from "./recorrer";

/**
 * "Intercepta el LLM" (decisión 2 del dueño): un flujo con trigger "Mensaje
 * recibido" marcado contesta el mensaje en lugar del agente de IA. Si el
 * mensaje cumple la condición del flujo, el flujo responde y el agente no
 * contesta ese turno.
 *
 * "Cumple la condición" se lee sobre el grafo, sin correrlo: el recorrido desde
 * el trigger atravesando sólo condiciones —que no tienen efectos y se pueden
 * evaluar en el acto— hasta el primer nodo que no es condición. Si ese nodo es
 * un final ("Detener"), el flujo no iba a contestar nada y el agente sigue; si
 * es cualquier acción, el flujo es el que contesta. Es la forma de la plantilla
 * "Responder automático": Mensaje recibido → Condición → (sí) Enviar mensaje ·
 * (no) Detener.
 *
 * Vive en `lib/` y es puro: lo usa el pipeline de mensajes (a través de
 * `server/services/workflows/interceptor.service.ts`, que carga los campos
 * vivos) y el despacho de disparos (`workflow-disparar`).
 */

export type ResultadoPrefijo = "intercepta" | "no" | "necesita_intent";

/** ¿El flujo está marcado para interceptar al agente? Sólo "Mensaje recibido" puede. */
export function esInterceptor(grafo: Grafo): boolean {
  const nodo = disparadorDe(grafo);
  if (nodo?.tipo !== "trigger_mensaje") return false;
  return configDeDisparador("trigger_mensaje", nodo.config)?.interceptaLlm === true;
}

/**
 * "Delegar al agente" no intercepta aunque sea la primera acción: el flujo le
 * pasa la conversación al agente, que es el que contesta.
 */
const NO_CONTESTA: ReadonlySet<Nodo["tipo"]> = new Set<Nodo["tipo"]>(["ia_delegar"]);

/** Los campos que mira una condición, en cualquiera de sus dos formas guardadas. */
function camposDe(condicion: Condicion): Set<CampoCondicion> {
  if (esCondicionArbol(condicion)) return camposVivosDe(condicion.arbol);
  const campos = new Set<CampoCondicion>();
  if (condicion.campo !== undefined && CAMPOS_VIVOS.has(condicion.campo)) {
    campos.add(condicion.campo);
  }
  return campos;
}

function condicionDe(nodo: Nodo): Condicion | null {
  const forma = CondicionSchema.safeParse(nodo.config);
  return forma.success ? forma.data : null;
}

/** Las condiciones del prefijo: las que se alcanzan desde el trigger sin pasar por una acción. */
function condicionesDelPrefijo(grafo: Grafo): Condicion[] {
  const trigger = disparadorDe(grafo);
  if (!trigger) return [];
  const condiciones: Condicion[] = [];
  const vistos = new Set<string>();
  const pendientes = [siguienteNodo(grafo, trigger.id, "salida")];
  while (pendientes.length > 0) {
    const id = pendientes.pop();
    if (id === undefined || vistos.has(id)) continue;
    vistos.add(id);
    const nodo = grafo.nodos.find((n) => n.id === id);
    if (!nodo || !esCondicion(nodo.tipo)) continue;
    const condicion = condicionDe(nodo);
    if (condicion) condiciones.push(condicion);
    pendientes.push(
      siguienteNodo(grafo, nodo.id, "verdadero"),
      siguienteNodo(grafo, nodo.id, "falso"),
    );
  }
  return condiciones;
}

/**
 * Los campos vivos que hay que leer de la base para decidir, sin el intent: el
 * del turno lo da el clasificador, no la base, que todavía tiene el del turno
 * anterior (`sinIntentMasViejo` en el ejecutor explica el mismo hueco).
 */
export function camposDelPrefijo(grafo: Grafo): Set<CampoCondicion> {
  const campos = new Set<CampoCondicion>();
  for (const condicion of condicionesDelPrefijo(grafo)) {
    for (const campo of camposDe(condicion)) if (campo !== "sesion.intent") campos.add(campo);
  }
  return campos;
}

/**
 * Recorre el prefijo con el contexto dado. `intentConocido`: el turno ya se
 * clasificó y `contexto.sesion.intent` es el de este mensaje. Sin clasificar,
 * una condición sobre el intent no se puede decidir y la respuesta es
 * `necesita_intent`: quien llama clasifica y vuelve a preguntar.
 *
 * Falla hacia el agente: una condición mal guardada, un hueco en el grafo o un
 * ciclo dan `no`. Un flujo roto que silencia al agente deja al cliente sin
 * respuesta; uno que no intercepta deja una respuesta de más.
 */
export function decidirPrefijo(
  grafo: Grafo,
  contexto: ContextoRun,
  opciones: OpcionesEvaluacion,
  intentConocido: boolean,
): ResultadoPrefijo {
  return recorrerPrefijo(grafo, contexto, opciones, intentConocido).tipo;
}

/** `decidirPrefijo` con el nodo que contesta: la primera acción después de las condiciones. */
export type RecorridoPrefijo =
  | { tipo: "intercepta"; nodo: Nodo }
  | { tipo: Exclude<ResultadoPrefijo, "intercepta"> };

export function recorrerPrefijo(
  grafo: Grafo,
  contexto: ContextoRun,
  opciones: OpcionesEvaluacion,
  intentConocido: boolean,
): RecorridoPrefijo {
  const trigger = disparadorDe(grafo);
  if (!trigger) return { tipo: "no" };
  const vistos = new Set<string>();
  let actual = siguienteNodo(grafo, trigger.id, "salida");

  while (actual !== undefined) {
    if (vistos.has(actual)) return { tipo: "no" };
    vistos.add(actual);
    const nodo = grafo.nodos.find((n) => n.id === actual);
    if (!nodo || esFinal(nodo.tipo) || NO_CONTESTA.has(nodo.tipo)) return { tipo: "no" };
    if (!esCondicion(nodo.tipo)) return { tipo: "intercepta", nodo };

    const condicion = condicionDe(nodo);
    if (!condicion) return { tipo: "no" };
    if (!intentConocido && camposDe(condicion).has("sesion.intent")) {
      return { tipo: "necesita_intent" };
    }
    const cumple = evaluarCondicion(condicion, contexto, opciones);
    actual = siguienteNodo(grafo, nodo.id, cumple ? "verdadero" : "falso");
  }
  return { tipo: "no" };
}

/**
 * El primer bloque que le manda algo al cliente, desde el que contesta: él
 * mismo, o el primero que se alcanza por la salida de acciones que no mandan
 * ("Avisar al equipo", "Etiquetar"…). `null` si el camino termina, se bifurca en
 * otra condición o vuelve sobre sí mismo sin mandar nada: ese flujo no le
 * escribe al cliente en este turno (el escalado a una persona, por ejemplo).
 *
 * Qué bloque manda lo decide quien llama (`esEnvio`): `lib/` no conoce el
 * registro de acciones.
 */
export function primerEnvioDesde(
  grafo: Grafo,
  desde: Nodo,
  esEnvio: (nodo: Nodo) => boolean,
): Nodo | null {
  const vistos = new Set<string>();
  let nodo: Nodo | undefined = desde;
  while (nodo && !vistos.has(nodo.id)) {
    if (esEnvio(nodo)) return nodo;
    if (esFinal(nodo.tipo) || esCondicion(nodo.tipo)) return null;
    vistos.add(nodo.id);
    const siguiente = siguienteNodo(grafo, nodo.id, "salida");
    nodo = siguiente === undefined ? undefined : grafo.nodos.find((n) => n.id === siguiente);
  }
  return null;
}

/**
 * Si varios interceptores coinciden, contesta uno solo —como las reglas IF/THEN
 * a las que reemplazan: de las que contestan gana una—. Dos respuestas
 * automáticas al mismo mensaje confunden al cliente más que cualquiera de las
 * dos. Gana la versión publicada hace más tiempo: publicar un flujo nuevo no le
 * roba en silencio las respuestas a uno que ya andaba. El id del flujo desempata
 * para que la elección no dependa del orden en que la base devuelve las filas.
 */
export function ganadorEntre<V extends { workflow_id: string; created_at: Date }>(
  versiones: readonly V[],
): V | null {
  let ganador: V | null = null;
  for (const v of versiones) {
    if (
      ganador === null ||
      v.created_at.getTime() < ganador.created_at.getTime() ||
      (v.created_at.getTime() === ganador.created_at.getTime() &&
        v.workflow_id < ganador.workflow_id)
    ) {
      ganador = v;
    }
  }
  return ganador;
}

/**
 * Lo que queda en `workflow_runs.error` del interceptor que no arrancó porque
 * el mensaje lo contestó otro (`workflow-disparar`). Así el dueño ve en el
 * historial por qué ese flujo no corrió, en vez de un hueco.
 */
export const MOTIVO_OTRO_INTERCEPTOR =
  "No arrancó: este mensaje lo contestó otro flujo que también intercepta el LLM. " +
  "Contesta uno solo: el publicado hace más tiempo.";

/**
 * La marca de la corrida que contesta un turno en lugar del agente. La pone
 * `workflow-disparar` en el contexto de la corrida del interceptor elegido y la
 * consume el primer envío (`acciones/topes-de-envio.ts`).
 *
 * Por qué existe: el interceptor revisa los topes antes de silenciar al agente
 * (`interceptor.service.ts`), pero entre esa decisión y el envío pasan segundos
 * en los que otro flujo disparado por el mismo mensaje puede mandar y llenar el
 * tope de frecuencia. Si el envío lo volviera a contar, saltaría y el cliente se
 * quedaría sin respuesta: ni flujo ni agente. Con la marca, la frecuencia se
 * decide una sola vez, al decidir el turno. Los topes del lead (baja, requiere
 * humano) se vuelven a mirar igual: son estados, no un contador compartido, y si
 * cambiaron en el medio es porque alguien pidió que no se le escriba.
 *
 * Clave con `$`, como la marca de Probar: ninguna variable ni condición la ve.
 */
export const CLAVE_RESPUESTA_DE_TURNO = "$respuesta_de_turno";

/** El contexto de la corrida que contesta el turno. */
export function conRespuestaDeTurno(contexto: ContextoRun): ContextoRun {
  return { ...contexto, [CLAVE_RESPUESTA_DE_TURNO]: true };
}

/** ¿Este envío es la respuesta al turno que el interceptor ya autorizó? */
export function esRespuestaDeTurno(contexto: ContextoRun): boolean {
  return contexto[CLAVE_RESPUESTA_DE_TURNO] === true;
}

/** Lo que deja el primer envío: el resto de la corrida pasa por los topes como cualquiera. */
export const RESPUESTA_DE_TURNO_CONSUMIDA: ContextoRun = { [CLAVE_RESPUESTA_DE_TURNO]: null };

/** El contexto que deja un envío que salió: consume la marca si la corrida la traía. */
export function consumirRespuestaDeTurno(contexto: ContextoRun): ContextoRun | undefined {
  return esRespuestaDeTurno(contexto) ? RESPUESTA_DE_TURNO_CONSUMIDA : undefined;
}
