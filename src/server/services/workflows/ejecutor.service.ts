import { isNonRetriable } from "@/lib/errors";
import { CondicionSchema } from "@/lib/validation/workflows.schema";
import { evaluarCondicion } from "@/lib/workflows/condiciones";
import { nodoPorId, siguienteNodo } from "@/lib/workflows/recorrer";
import type { UUID } from "@/types/entities";
import type { ContextoRun, Grafo, Puerto, ResultadoSegmento } from "@/types/workflows";
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

function minutosDeEspera(config: Record<string, unknown>): number {
  const m = config["minutos"];
  return typeof m === "number" && m > 0 ? m : 60;
}

/**
 * Cuál nodo sigue por `puerto`, o `undefined` si ese puerto no tiene arista.
 *
 * En un grafo que pasó el validador de W1 esto nunca debería pasar: la regla
 * `salida_sin_conectar` exige que todo puerto de todo nodo no-`fin` tenga
 * arista. Si pasa, el grafo se guardó sin validar, y las cuatro clases de
 * nodo que avanzan por un puerto (`disparador`, `condicion`, `espera`,
 * `accion`) lo tratan igual: es una falla del grafo, nunca un `fin` silencioso.
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

    if (nodo.tipo === "fin") {
      await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error: null });
      return { tipo: "fin" };
    }

    if (nodo.tipo === "espera") {
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
      const hasta = new Date(deps.ahora().getTime() + minutosDeEspera(nodo.config) * 60_000);
      await deps.onPaso({
        nodoId: nodo.id,
        orden,
        salida: { hasta: hasta.toISOString() },
        error: null,
      });
      return { tipo: "espera", nodoId: nodo.id, hasta, reanudarEn: sig.nodoId };
    }

    if (nodo.tipo === "disparador") {
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

    if (nodo.tipo === "condicion") {
      // Validar y no castear: `config` es `Record<string, unknown>` y un
      // `as Condicion` haría que una condición mal guardada explotara en
      // runtime, a mitad de una corrida, en vez de acá con un motivo legible.
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
        return { tipo: "espera", nodoId: nodo.id, hasta: r.diferirHasta, reanudarEn: nodo.id };
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
