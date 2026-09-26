import { isNonRetriable } from "@/lib/errors";
import { EVENTOS_ESPERABLES, type EventoEsperable } from "@/lib/workflows/catalogo";
import { leerConfigDeTipo } from "@/lib/workflows/config-nodos";
import { CondicionSchema } from "@/lib/validation/workflows.schema";
import {
  CAMPOS_VIVOS,
  camposVivosDe,
  esCondicionArbol,
  evaluarCondicion,
  type CampoCondicion,
  type Condicion,
  type ConsultaCamposVivos,
  type OpcionesEvaluacion,
} from "@/lib/workflows/condiciones";
import { CLAVE_INTENT_MENSAJE_AT } from "@/lib/workflows/contexto";
import { nodoPorId, siguienteNodo } from "@/lib/workflows/recorrer";
import { destinoDeSalto } from "@/lib/workflows/validar-grafo";
import {
  CLAVE_MOTIVO_SALTO,
  esCondicion,
  esFinal,
  esSalto,
  esSwitch,
  esTrigger,
  puertoDeCaso,
} from "@/types/workflows";
import type { UUID } from "@/types/entities";
import type { ContextoRun, Grafo, Nodo, Puerto, ResultadoSegmento } from "@/types/workflows";
import type { RegistroDeAcciones } from "./acciones/registro";

export interface PasoEjecutado {
  nodoId: string;
  orden: number;
  salida: Record<string, unknown> | null;
  error: string | null;
}

export interface EjecutorDeps {
  registro: RegistroDeAcciones;
  /** Inyectado para que el simulador pueda adelantar un reloj virtual. */
  ahora: () => Date;
  /** Persistir el paso. El ejecutor no sabe de base: esto lo resuelve quien llama. */
  onPaso: (paso: PasoEjecutado) => Promise<void>;
  /**
   * De dónde salen los campos de condición que no siembra el disparo
   * (`CAMPOS_VIVOS`) y la zona del negocio con que se leen las fechas. Sin
   * esto, esos campos quedan ausentes (la fila va por "falso") y las fechas
   * se leen en UTC.
   */
  camposVivos?: CamposVivosDeps;
  /**
   * ¿La corrida sigue viva? Se pregunta antes de cada acción —lo único que
   * escribe afuera—. Con `false` el segmento corta sin ejecutarla
   * (`{ tipo: "detenido", causa: "cancelada" }`). Sin esto no se pregunta.
   */
  seguir?: () => Promise<boolean>;
}

export type { ConsultaCamposVivos };

/**
 * Devuelve un contexto parcial con los campos pedidos, en las mismas rutas en
 * que los busca la condición (`{ vehiculo: { marca } }`). Un dato que no existe
 * no se inventa: queda ausente o `null`.
 */
export type CargadorCamposVivos = (consulta: ConsultaCamposVivos) => Promise<ContextoRun>;

export interface CamposVivosDeps {
  cargar: CargadorCamposVivos;
  /** `agente_config.horario_timezone`. */
  zona: () => Promise<string>;
}

export interface EjecutarSegmentoInput {
  grafo: Grafo;
  desdeNodo: string;
  contexto: ContextoRun;
  leadId: UUID;
  leadSessionId?: UUID | null;
  runId: UUID;
  /** Pasos que la corrida ya gastó en segmentos anteriores. */
  pasosPrevios: number;
  maxPasos: number;
  /**
   * "Ejecutar hasta acá": al llegar a este nodo el segmento corta sin correrlo
   * (`{ tipo: "detenido", causa: "hasta_aca" }`). Sólo lo usa Probar.
   */
  detenerEn?: string;
}

const MS_POR_UNIDAD = {
  segundos: 1_000,
  minutos: 60_000,
  horas: 60 * 60_000,
  dias: 24 * 60 * 60_000,
} as const;

/**
 * Qué despierta antes de tiempo a una espera: la respuesta del lead, o uno de
 * los eventos de dominio que se pueden esperar. Es un `workflow/disparo.recibido`
 * del mismo lead con este `disparador`.
 */
export type EventoEsperado =
  | { tipo: "respuesta"; disparador: "mensaje_recibido" }
  | { tipo: "evento"; disparador: EventoEsperable };

type DuracionEspera =
  | { ok: true; ms: number; evento?: EventoEsperado }
  | { ok: false; error: string };

/** Los que alguien emite: `EVENTOS_ESPERABLES` (`lib/workflows/catalogo.ts`). */
function eventoConEmisor(evento: string | undefined): evento is EventoEsperable {
  return (EVENTOS_ESPERABLES as readonly (string | undefined)[]).includes(evento);
}

/**
 * Qué evento despierta a una espera, o `null` si el nodo no es una espera de
 * evento o su config no sirve (eso lo reporta el ejecutor al llegar al nodo).
 * Lo usa `workflow-segmento` para armar el `step.waitForEvent`.
 */
export function eventoQueEspera(nodo: Nodo): EventoEsperado | null {
  const espera = duracionDeEspera(nodo);
  return espera?.ok ? (espera.evento ?? null) : null;
}

/** Los mensajes del schema, sin repetir: son los mismos que muestra el validador. */
function mensajesDe(error: { issues: readonly { message: string }[] }): string {
  return [...new Set(error.issues.map((i) => i.message))].join("; ");
}

/**
 * Cuánto dura una espera. `null` = el nodo no es una espera.
 *
 * "Esperar respuesta" y "esperar evento" también: su duración es el tiempo
 * máximo, **obligatorio y positivo** —ninguna espera es indefinida—, y lo que
 * las despierta antes es un evento (`evento`), que resuelve
 * `workflow-segmento` con `step.waitForEvent`. Para el ejecutor son una espera
 * de tiempo: así el simulador y "Probar" las recorren con el reloj virtual,
 * como si el lead no contestara durante la prueba.
 *
 * Las configs se leen con el contrato de `config-nodos.ts` (`leerConfigDeTipo`):
 * ninguna clave se lee a mano acá. Sin config valen lo que el panel muestra
 * elegido sin escribirlo: `logica_esperar` 1 hora, "esperar respuesta" 24
 * horas, "esperar evento" 7 días; la `espera` legacy, que no tiene formulario,
 * 60 minutos. Un valor inválido —también un `null`— falla, no cae al default.
 */
function duracionDeEspera(nodo: Nodo): DuracionEspera | null {
  if (nodo.tipo === "logica_esperar_respuesta") {
    const r = leerConfigDeTipo("logica_esperar_respuesta", nodo.config);
    if (!r.success || !(r.data.timeout > 0)) {
      return {
        ok: false,
        error: `la espera de respuesta "${nodo.id}" no tiene un tiempo máximo válido: ${JSON.stringify(nodo.config["timeout"])}`,
      };
    }
    return {
      ok: true,
      ms: r.data.timeout * MS_POR_UNIDAD[r.data.unidadTimeout],
      evento: { tipo: "respuesta", disparador: "mensaje_recibido" },
    };
  }
  if (nodo.tipo === "logica_esperar_evento") {
    const r = leerConfigDeTipo("logica_esperar_evento", nodo.config);
    // Un evento sin elegir o sin emisor lo rechaza el schema; el mensaje es el
    // mismo con que lo rechaza el validador antes de publicar.
    const problemaEvento = r.success
      ? undefined
      : r.error.issues.find((i) => i.path[0] === "evento")?.message;
    if (problemaEvento) {
      return { ok: false, error: `la espera de evento "${nodo.id}": ${problemaEvento}` };
    }
    if (!r.success || !(r.data.timeoutMax > 0)) {
      return {
        ok: false,
        error: `la espera de evento "${nodo.id}" no tiene un tiempo máximo válido: ${JSON.stringify(nodo.config["timeoutMax"])}`,
      };
    }
    const evento = r.data.evento;
    if (!eventoConEmisor(evento)) {
      return {
        ok: false,
        error:
          evento === undefined
            ? `la espera de evento "${nodo.id}" no dice qué evento esperar`
            : `la espera de evento "${nodo.id}" espera "${evento}", que nada emite todavía: vencería siempre por tiempo`,
      };
    }
    return {
      ok: true,
      ms: r.data.timeoutMax * MS_POR_UNIDAD[r.data.unidadTimeoutMax],
      evento: { tipo: "evento", disparador: evento },
    };
  }
  if (nodo.tipo === "espera") {
    const r = leerConfigDeTipo("espera", nodo.config);
    if (!r.success) {
      return {
        ok: false,
        error: `la espera "${nodo.id}" tiene una duración inválida: ${mensajesDe(r.error)}`,
      };
    }
    return { ok: true, ms: r.data.minutos * MS_POR_UNIDAD.minutos };
  }
  if (nodo.tipo === "logica_esperar") {
    const r = leerConfigDeTipo("logica_esperar", nodo.config);
    if (!r.success) {
      return {
        ok: false,
        error: `la espera "${nodo.id}" tiene una duración inválida: ${mensajesDe(r.error)}`,
      };
    }
    return { ok: true, ms: r.data.duracion * MS_POR_UNIDAD[r.data.unidad] };
  }
  return null;
}

/** El contexto con `sesion.respondio` fijado, sin tocar el resto de `sesion`. */
export function conRespondio(contexto: ContextoRun, respondio: boolean): ContextoRun {
  const sesion = contexto["sesion"];
  const previa = sesion !== null && typeof sesion === "object" ? sesion : {};
  return { ...contexto, sesion: { ...previa, respondio } };
}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Hora (ms) del mensaje cuyo intent trae `sesion`, o `null` si no la trae. */
function horaDelIntent(sesion: unknown): number | null {
  if (!esObjeto(sesion)) return null;
  const at = sesion[CLAVE_INTENT_MENSAJE_AT];
  if (typeof at !== "string") return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Los campos vivos sin el intent si el del contexto es de un mensaje igual o
 * más nuevo. El disparo de "Mensaje recibido" trae el intent de su turno,
 * clasificado antes de salir; la base recién lo tiene cuando el agente
 * contesta, así que leída en ese hueco devuelve el turno anterior. Después de
 * una espera pasa al revés —la base tiene turnos más nuevos que el disparo— y
 * gana la base. Un contexto sin hora (Probar, otros disparadores) no compite.
 */
function sinIntentMasViejo(contexto: ContextoRun, vivos: ContextoRun): ContextoRun {
  const delContexto = horaDelIntent(contexto["sesion"]);
  const sesionViva = vivos["sesion"];
  if (delContexto === null || !esObjeto(sesionViva) || !("intent" in sesionViva)) return vivos;
  const deLaBase = horaDelIntent(sesionViva);
  if (deLaBase !== null && deLaBase > delContexto) return vivos;
  const { intent: _descartado, [CLAVE_INTENT_MENSAJE_AT]: _hora, ...resto } = sesionViva;
  return { ...vivos, sesion: resto };
}

/** Mezcla dos niveles: `{ lead: {a} }` + `{ lead: {b} }` = `{ lead: {a, b} }`. */
function conCamposVivos(contexto: ContextoRun, vivosLeidos: ContextoRun): ContextoRun {
  const vivos = sinIntentMasViejo(contexto, vivosLeidos);
  const mezcla: ContextoRun = { ...contexto };
  for (const [clave, valor] of Object.entries(vivos)) {
    const previo = mezcla[clave];
    mezcla[clave] = esObjeto(valor) && esObjeto(previo) ? { ...previo, ...valor } : valor;
  }
  return mezcla;
}

/**
 * Evalúa con los campos vivos recién leídos. El contexto mezclado se usa sólo
 * para esta evaluación: no pasa a `workflow_runs.contexto`, donde quedaría
 * viejo en cuanto la corrida espere.
 */
async function evaluarConCamposVivos(
  condicion: Condicion,
  contexto: ContextoRun,
  input: EjecutarSegmentoInput,
  deps: EjecutorDeps,
): Promise<boolean> {
  const campos = esCondicionArbol(condicion)
    ? camposVivosDe(condicion.arbol)
    : new Set<CampoCondicion>();
  const lectura = await contextoParaEvaluar(campos, contexto, input, deps);
  return evaluarCondicion(condicion, lectura.contexto, lectura.opciones);
}

/**
 * El contexto con `campos` recién leídos de la base, y la hora y la zona con
 * que se evalúa. Es lo que comparten la condición y "Según el valor": los dos
 * miran los mismos campos con el mismo evaluador.
 */
async function contextoParaEvaluar(
  campos: ReadonlySet<CampoCondicion>,
  contexto: ContextoRun,
  input: EjecutarSegmentoInput,
  deps: EjecutorDeps,
): Promise<{ contexto: ContextoRun; opciones: OpcionesEvaluacion }> {
  const ahora = deps.ahora();
  if (!deps.camposVivos) return { contexto, opciones: { ahora, zona: "UTC" } };
  const [vivos, zona] = await Promise.all([
    campos.size > 0
      ? deps.camposVivos.cargar({
          leadId: input.leadId,
          leadSessionId: input.leadSessionId ?? null,
          campos,
        })
      : Promise.resolve({}),
    deps.camposVivos.zona(),
  ]);
  return { contexto: conCamposVivos(contexto, vivos), opciones: { ahora, zona } };
}

type EleccionSwitch =
  | { ok: true; caso: { id: string; valor: string } | null }
  | { ok: false; error: string; motivo: "condicion_invalida" }
  | { ok: false; error: string; motivo: "accion_fallo"; retriable: boolean };

/**
 * Qué caso toma "Según el valor": el primero, en orden, cuyo valor cumple
 * `campo es valor` con el evaluador de las condiciones. `null` = ninguno, y
 * sigue por «Otro». La config se lee con el contrato de `config-nodos.ts`, el
 * mismo que revisa el validador antes de publicar.
 */
async function elegirCaso(
  nodo: Nodo,
  contexto: ContextoRun,
  input: EjecutarSegmentoInput,
  deps: EjecutorDeps,
): Promise<EleccionSwitch> {
  const config = leerConfigDeTipo("logica_switch", nodo.config);
  if (!config.success) {
    return {
      ok: false,
      motivo: "condicion_invalida",
      error: `"Según el valor" "${nodo.id}" está mal configurado: ${mensajesDe(config.error)}`,
    };
  }
  // El schema sólo deja pasar campos de `CAMPOS_SWITCH`.
  const campo = config.data.campo as CampoCondicion;
  try {
    const lectura = await contextoParaEvaluar(
      CAMPOS_VIVOS.has(campo) ? new Set([campo]) : new Set<CampoCondicion>(),
      contexto,
      input,
      deps,
    );
    const caso = config.data.casos.find((c) =>
      evaluarCondicion(
        { campo, operador: "es", valor: c.valor.trim() },
        lectura.contexto,
        lectura.opciones,
      ),
    );
    return { ok: true, caso: caso ?? null };
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      motivo: "accion_fallo",
      retriable: !isNonRetriable(error),
      error: `"Según el valor" "${nodo.id}" no pudo leer sus datos: ${detalle}`,
    };
  }
}

/**
 * Cuál nodo sigue por `puerto`, o `undefined` si ese puerto no tiene arista.
 *
 * En un grafo que pasó el validador de W1 esto nunca debería pasar: la regla
 * `salida_sin_conectar` exige que todo puerto de todo nodo no final tenga
 * arista. Si pasa, el grafo se guardó sin validar, y todas las clases de nodo
 * que avanzan por un puerto (disparador, condición, espera, acción) lo tratan
 * igual: es una falla del grafo, nunca un fin silencioso.
 */
function siguienteObligatorio(
  grafo: Grafo,
  nodoId: string,
  puerto: Puerto,
): { ok: true; nodoId: string } | { ok: false; error: string } {
  const siguiente = siguienteNodo(grafo, nodoId, puerto);
  if (siguiente === undefined) {
    return {
      ok: false,
      error: `el nodo "${nodoId}" no tiene conectado el puerto "${puerto}"`,
    };
  }
  return { ok: true, nodoId: siguiente };
}

/**
 * Corre nodos inline hasta toparse con una espera, un fin, o el tope.
 *
 * **Es el único intérprete de grafos del proyecto.** Lo usan producción
 * (`workflow-segmento.ts`), "Probar" y el simulador; lo que cambia entre ellos
 * es el registro de acciones que se inyecta (con efectos reales o
 * interceptados) y el reloj.
 *
 * El control de flujo lo resuelve acá: disparadores (`esTrigger`), finales
 * (`esFinal`), condiciones (`esCondicion`), "Según el valor" (`esSwitch`),
 * "Ir a" (`esSalto`) y esperas de tiempo. Todo lo demás es una acción y va al
 * registro, que sabe cuáles tienen handler.
 *
 * No cicla nunca, y no por disciplina: el subgrafo sin esperas es acíclico por
 * construcción —es la propiedad que el validador de W1 demuestra, contando
 * cada "Ir a" como una línea a su destino— así que el recorrido de un segmento
 * es sobre un DAG y termina en a lo sumo N nodos. Un grafo guardado sin
 * validar lo corta el tope de pasos.
 */
export async function ejecutarSegmento(
  input: EjecutarSegmentoInput,
  deps: EjecutorDeps,
): Promise<ResultadoSegmento> {
  let actual: string | undefined = input.desdeNodo;
  let contexto: ContextoRun = { ...input.contexto };
  let orden = input.pasosPrevios;

  while (actual !== undefined) {
    const nodo = nodoPorId(input.grafo, actual);
    if (!nodo) {
      return {
        tipo: "fallado",
        nodoId: actual,
        error: `el nodo "${actual}" no existe en el grafo`,
        motivo: "grafo_invalido",
        retriable: false,
      };
    }

    // "Ejecutar hasta acá": se frena ANTES del nodo elegido, sin gastar paso.
    if (input.detenerEn !== undefined && nodo.id === input.detenerEn) {
      return { tipo: "detenido", nodoId: nodo.id, causa: "hasta_aca" };
    }

    // ANTES de ejecutar, no después: chequear después manda el mensaje 501 y
    // recién ahí se entera de que se había pasado.
    if (orden >= input.maxPasos) {
      return {
        tipo: "fallado",
        nodoId: nodo.id,
        error: `tope de ${input.maxPasos} pasos alcanzado en "${nodo.id}"`,
        motivo: "tope_pasos",
        retriable: false,
      };
    }
    orden += 1;

    if (esFinal(nodo.tipo)) {
      await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error: null });
      return { tipo: "fin" };
    }

    const espera = duracionDeEspera(nodo);
    if (espera !== null) {
      if (!espera.ok) {
        await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error: espera.error });
        return {
          tipo: "fallado",
          nodoId: nodo.id,
          error: espera.error,
          motivo: "grafo_invalido",
          retriable: false,
        };
      }
      const sig = siguienteObligatorio(input.grafo, nodo.id, "salida");
      if (!sig.ok) {
        await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error: sig.error });
        return {
          tipo: "fallado",
          nodoId: nodo.id,
          error: sig.error,
          motivo: "grafo_invalido",
          retriable: false,
        };
      }
      const hasta = new Date(deps.ahora().getTime() + espera.ms);
      await deps.onPaso({
        nodoId: nodo.id,
        orden,
        salida: {
          hasta: hasta.toISOString(),
          ...(espera.evento ? { esperando: espera.evento.tipo } : {}),
        },
        error: null,
      });
      // "Esperar respuesta" deja "no respondió": es lo que queda si vence el
      // tiempo. Si el lead contesta antes, `workflow-segmento` lo da vuelta al
      // reanudar. Una condición sobre `sesion.respondio` después de la espera
      // lee la verdad en los dos casos.
      return {
        tipo: "espera",
        nodoId: nodo.id,
        hasta,
        reanudarEn: sig.nodoId,
        contexto: espera.evento?.tipo === "respuesta" ? conRespondio(contexto, false) : contexto,
      };
    }

    if (esTrigger(nodo.tipo)) {
      const sig = siguienteObligatorio(input.grafo, nodo.id, "salida");
      if (!sig.ok) {
        await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error: sig.error });
        return {
          tipo: "fallado",
          nodoId: nodo.id,
          error: sig.error,
          motivo: "grafo_invalido",
          retriable: false,
        };
      }
      await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error: null });
      actual = sig.nodoId;
      continue;
    }

    // "Ir a": salta al paso que eligió. No escribe nada afuera, así que no
    // pregunta si la corrida sigue viva. Un bucle sin espera lo rechaza el
    // validador; si uno se guardó sin validar, lo corta el tope de pasos.
    if (esSalto(nodo.tipo)) {
      const destino = destinoDeSalto(nodo);
      if (destino === null || !nodoPorId(input.grafo, destino)) {
        const error =
          destino === null
            ? `el paso "${nodo.id}" no dice a qué paso ir`
            : `el paso "${nodo.id}" salta a "${destino}", que no existe en el grafo`;
        await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error });
        return {
          tipo: "fallado",
          nodoId: nodo.id,
          error,
          motivo: "grafo_invalido",
          retriable: false,
        };
      }
      await deps.onPaso({ nodoId: nodo.id, orden, salida: { destino }, error: null });
      actual = destino;
      continue;
    }

    if (esSwitch(nodo.tipo)) {
      const eleccion = await elegirCaso(nodo, contexto, input, deps);
      if (!eleccion.ok) {
        await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error: eleccion.error });
        return {
          tipo: "fallado",
          nodoId: nodo.id,
          error: eleccion.error,
          motivo: eleccion.motivo,
          retriable: eleccion.motivo === "accion_fallo" ? eleccion.retriable : false,
        };
      }
      const puerto: Puerto = eleccion.caso ? puertoDeCaso(eleccion.caso.id) : "otro";
      const sig = siguienteObligatorio(input.grafo, nodo.id, puerto);
      if (!sig.ok) {
        await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error: sig.error });
        return {
          tipo: "fallado",
          nodoId: nodo.id,
          error: sig.error,
          motivo: "grafo_invalido",
          retriable: false,
        };
      }
      await deps.onPaso({
        nodoId: nodo.id,
        orden,
        salida: eleccion.caso
          ? { caso: eleccion.caso.id, valor: eleccion.caso.valor.trim() }
          : { caso: null },
        error: null,
      });
      actual = sig.nodoId;
      continue;
    }

    if (esCondicion(nodo.tipo)) {
      // Validar y no castear: `config` es `Record<string, unknown>` y un
      // `as Condicion` haría que una condición mal guardada explotara en
      // runtime, a mitad de una corrida, en vez de acá con un motivo legible.
      // El schema pone los defaults que el panel muestra y no escribe
      // (operador "es", valor vacío): es el mismo que corre el validador.
      const forma = CondicionSchema.safeParse(nodo.config);
      if (!forma.success) {
        const mensaje = `la condición "${nodo.id}" está mal configurada: ${forma.error.issues[0]?.message ?? "forma inválida"}`;
        await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error: mensaje });
        return {
          tipo: "fallado",
          nodoId: nodo.id,
          error: mensaje,
          motivo: "condicion_invalida",
          retriable: false,
        };
      }
      // Leer los campos vivos es ir a la base: si falla, se trata como una
      // acción que falló (reintentable si el error lo es).
      let cumple: boolean;
      try {
        cumple = await evaluarConCamposVivos(forma.data, contexto, input, deps);
      } catch (error) {
        const detalle = error instanceof Error ? error.message : String(error);
        const mensaje = `la condición "${nodo.id}" no pudo leer sus datos: ${detalle}`;
        await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error: mensaje });
        return {
          tipo: "fallado",
          nodoId: nodo.id,
          error: mensaje,
          motivo: "accion_fallo",
          retriable: !isNonRetriable(error),
        };
      }
      const sig = siguienteObligatorio(input.grafo, nodo.id, cumple ? "verdadero" : "falso");
      if (!sig.ok) {
        await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error: sig.error });
        return {
          tipo: "fallado",
          nodoId: nodo.id,
          error: sig.error,
          motivo: "grafo_invalido",
          retriable: false,
        };
      }
      await deps.onPaso({ nodoId: nodo.id, orden, salida: { cumple }, error: null });
      actual = sig.nodoId;
      continue;
    }

    // Una acción escribe afuera (manda, etiqueta, mueve). Si la corrida dejó de
    // estar viva mientras este segmento corría —la cancelaron, o la reinició
    // un disparo nuevo—, no se ejecuta ni una más. El paso no se registra: no
    // corrió.
    if (deps.seguir && !(await deps.seguir())) {
      return { tipo: "detenido", nodoId: nodo.id, causa: "cancelada" };
    }

    try {
      const r = await deps.registro.ejecutar(nodo, {
        leadId: input.leadId,
        leadSessionId: input.leadSessionId ?? null,
        runId: input.runId,
        orden,
        contexto,
        ahora: deps.ahora(),
      });
      // La acción pidió posponerse (fuera de horario). NO se ejecutó: el
      // segmento corta acá y el siguiente reanuda en ESTE mismo nodo.
      if (r.diferirHasta) {
        await deps.onPaso({
          nodoId: nodo.id,
          orden,
          salida: { diferido_hasta: r.diferirHasta.toISOString() },
          error: null,
        });
        // `contexto` sin el merge de `r.contexto`: la acción NO se ejecutó
        // (se pospuso), así que su `contexto` -- si trajera uno, que hoy
        // ninguna acción que difiere trae -- tampoco debería aplicarse.
        return {
          tipo: "espera",
          nodoId: nodo.id,
          hasta: r.diferirHasta,
          reanudarEn: nodo.id,
          contexto,
        };
      }
      // Botones o lista: la acción YA mandó y ahora espera que el lead elija.
      // Corta reanudando en este mismo nodo, con el contexto de la acción —que
      // lleva la espera—, y le dice a quien llama a qué mensaje esperar la
      // respuesta. La segunda pasada del nodo sale por la opción elegida.
      if (r.esperarRespuesta) {
        const { hasta, respondeA } = r.esperarRespuesta;
        await deps.onPaso({
          nodoId: nodo.id,
          orden,
          salida: {
            ...(r.salida ?? {}),
            hasta: hasta.toISOString(),
            esperando: "respuesta_interactiva",
          },
          error: null,
        });
        return {
          tipo: "espera",
          nodoId: nodo.id,
          hasta,
          reanudarEn: nodo.id,
          contexto: r.contexto ? { ...contexto, ...r.contexto } : contexto,
          esperaOpcion: { respondeA },
        };
      }
      // Un tope de seguridad saltó la acción (PRD §6.6): el lead SALE del
      // flujo. No se sigue por `r.puerto` —eso es el bug que Braze documenta
      // contra sí mismo: el tope salta un mensaje y el paso siguiente le pega
      // igual— y la corrida termina, no falla. El motivo va en la salida del
      // paso porque es lo que persiste quien llama (`workflow-segmento`,
      // "Probar"); la base lo lee de ahí (`workflow_run_pasos.motivo_salto`).
      if (r.salto) {
        await deps.onPaso({
          nodoId: nodo.id,
          orden,
          salida: {
            saltado: true,
            [CLAVE_MOTIVO_SALTO]: r.salto.motivo,
            detalle_salto: r.salto.detalle,
          },
          error: null,
        });
        return { tipo: "fin", salto: { nodoId: nodo.id, ...r.salto } };
      }
      const sig = siguienteObligatorio(input.grafo, nodo.id, r.puerto);
      if (!sig.ok) {
        await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error: sig.error });
        return {
          tipo: "fallado",
          nodoId: nodo.id,
          error: sig.error,
          motivo: "grafo_invalido",
          retriable: false,
        };
      }
      if (r.contexto) contexto = { ...contexto, ...r.contexto };
      await deps.onPaso({ nodoId: nodo.id, orden, salida: r.salida ?? null, error: null });
      actual = sig.nodoId;
    } catch (error) {
      // isNonRetriable() se calcula sobre el `error` crudo, ANTES de
      // aplanarlo a texto: una vez convertido a `string` para persistir, la
      // clase de dominio (ValidationError, InfraError, ...) ya no existe y
      // Inngest no puede decidir si reintentar.
      const mensaje = error instanceof Error ? error.message : String(error);
      await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error: mensaje });
      return {
        tipo: "fallado",
        nodoId: nodo.id,
        error: mensaje,
        motivo: "accion_fallo",
        retriable: !isNonRetriable(error),
      };
    }
  }

  // Con el chequeo de puerto conectado en cada sitio que avanza `actual`,
  // esta línea es inalcanzable en la práctica: nunca se sale del `while` sin
  // pasar por un `return` explícito. Queda como cierre defensivo porque
  // TypeScript no puede probar la exhaustividad del `while`, y si alguna vez
  // se alcanza es señal de un invariante roto, no de un final exitoso.
  return {
    tipo: "fallado",
    nodoId: input.desdeNodo,
    error: "el segmento terminó sin llegar a un fin, espera o falla explícita",
    motivo: "grafo_invalido",
    retriable: false,
  };
}
