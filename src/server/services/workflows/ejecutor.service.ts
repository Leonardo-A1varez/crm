import { isNonRetriable } from "@/lib/errors";
import { EVENTOS_ESPERABLES, type EventoEsperable } from "@/lib/workflows/catalogo";
import { ESPEC_CONFIG_POR_TIPO, normalizarConfig } from "@/lib/workflows/config-nodos";
import { CondicionSchema } from "@/lib/validation/workflows.schema";
import { evaluarCondicion } from "@/lib/workflows/condiciones";
import { nodoPorId, siguienteNodo } from "@/lib/workflows/recorrer";
import { CLAVE_MOTIVO_SALTO, esCondicion, esFinal, esTrigger } from "@/types/workflows";
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
}

const MS_POR_UNIDAD: Readonly<Record<string, number>> = {
  segundos: 1_000,
  minutos: 60_000,
  horas: 60 * 60_000,
  dias: 24 * 60 * 60_000,
};

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
 * Las configs se leen con el contrato de `config-nodos.ts`. Sin config valen lo
 * que el panel muestra elegido sin escribirlo: `logica_esperar` 1 hora,
 * "esperar respuesta" 24 horas, "esperar evento" 7 días.
 */
function duracionDeEspera(nodo: Nodo): DuracionEspera | null {
  if (nodo.tipo === "logica_esperar_respuesta") {
    const r = ESPEC_CONFIG_POR_TIPO.logica_esperar_respuesta.schema.safeParse(
      normalizarConfig(nodo.tipo, nodo.config),
    );
    const factor = r.success ? MS_POR_UNIDAD[r.data.unidadTimeout] : undefined;
    if (!r.success || !(r.data.timeout > 0) || !factor) {
      return {
        ok: false,
        error: `la espera de respuesta "${nodo.id}" no tiene un tiempo máximo válido: ${JSON.stringify(nodo.config["timeout"])}`,
      };
    }
    return {
      ok: true,
      ms: r.data.timeout * factor,
      evento: { tipo: "respuesta", disparador: "mensaje_recibido" },
    };
  }
  if (nodo.tipo === "logica_esperar_evento") {
    const r = ESPEC_CONFIG_POR_TIPO.logica_esperar_evento.schema.safeParse(
      normalizarConfig(nodo.tipo, nodo.config),
    );
    // Un evento sin elegir o sin emisor lo rechaza el schema; el mensaje es el
    // mismo con que lo rechaza el validador antes de publicar.
    const problemaEvento = r.success
      ? undefined
      : r.error.issues.find((i) => i.path[0] === "evento")?.message;
    if (problemaEvento) {
      return { ok: false, error: `la espera de evento "${nodo.id}": ${problemaEvento}` };
    }
    const factor = r.success ? MS_POR_UNIDAD[r.data.unidadTimeoutMax] : undefined;
    if (!r.success || !(r.data.timeoutMax > 0) || !factor) {
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
      ms: r.data.timeoutMax * factor,
      evento: { tipo: "evento", disparador: evento },
    };
  }
  if (nodo.tipo === "espera") {
    const minutos = nodo.config["minutos"];
    return { ok: true, ms: (typeof minutos === "number" && minutos > 0 ? minutos : 60) * 60_000 };
  }
  if (nodo.tipo === "logica_esperar") {
    const duracion = nodo.config["duracion"] ?? 1;
    const unidad = nodo.config["unidad"] ?? "horas";
    const factor =
      typeof unidad === "string" && Object.hasOwn(MS_POR_UNIDAD, unidad)
        ? MS_POR_UNIDAD[unidad]
        : undefined;
    if (typeof duracion !== "number" || !Number.isFinite(duracion) || duracion <= 0 || !factor) {
      return {
        ok: false,
        error: `la espera "${nodo.id}" tiene una duración inválida: ${JSON.stringify(duracion)} ${JSON.stringify(unidad)}`,
      };
    }
    return { ok: true, ms: duracion * factor };
  }
  return null;
}

/** El contexto con `sesion.respondio` fijado, sin tocar el resto de `sesion`. */
export function conRespondio(contexto: ContextoRun, respondio: boolean): ContextoRun {
  const sesion = contexto["sesion"];
  const previa = sesion !== null && typeof sesion === "object" ? sesion : {};
  return { ...contexto, sesion: { ...previa, respondio } };
}

/**
 * La condición tal como la guardó el panel, con los defaults que el panel
 * muestra y no escribe: operador "es" (`ConfigLogica.tsx` lo dibuja elegido)
 * y valor vacío. Sin esto, una condición a la que sólo se le eligió el campo
 * fallaría en la corrida con "falta el operador" mientras la pantalla muestra
 * uno elegido.
 */
function configDeCondicion(nodo: Nodo): Record<string, unknown> {
  return {
    ...nodo.config,
    operador: nodo.config["operador"] ?? "es",
    valor: nodo.config["valor"] ?? null,
  };
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
 * (`esFinal`), condiciones (`esCondicion`) y esperas de tiempo. Todo lo demás
 * es una acción y va al registro, que sabe cuáles tienen handler.
 *
 * No cicla nunca, y no por disciplina: el subgrafo sin esperas es acíclico por
 * construcción —es la propiedad que el validador de W1 demuestra— así que el
 * recorrido de un segmento es sobre un DAG y termina en a lo sumo N nodos.
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

    if (esCondicion(nodo.tipo)) {
      // Validar y no castear: `config` es `Record<string, unknown>` y un
      // `as Condicion` haría que una condición mal guardada explotara en
      // runtime, a mitad de una corrida, en vez de acá con un motivo legible.
      const forma = CondicionSchema.safeParse(configDeCondicion(nodo));
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
      const cumple = evaluarCondicion(forma.data, contexto);
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
