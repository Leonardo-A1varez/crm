import { ValidationError } from "@/lib/errors";
import { ACCION_DE_TIPO, type AccionWorkflow } from "@/lib/workflows/catalogo";
import type { ContextoRun, Nodo, ResultadoAccion } from "@/types/workflows";
import type { UUID } from "@/types/entities";
import { crearAccionesDeAsignacion, type AccionesAsignacionDeps } from "./asignacion";
import { crearAccionActualizarCampoTwin, type AccionActualizarCampoTwinDeps } from "./campo-twin";
import { crearAccionEnviarMensaje, type AccionEnviarMensajeDeps } from "./enviar-mensaje";
import { crearAccionEnviarPlantilla, type AccionEnviarPlantillaDeps } from "./enviar-plantilla";
import { crearAccionesDeMensajeriaRica, type AccionesMensajeriaRicaDeps } from "./enviar-rico";
import { crearAccionesInternas, type AccionesInternasDeps } from "./internas";
import { crearAccionAvisarEquipo, type AccionAvisarEquipoDeps } from "./avisar-equipo";

/** Todo lo que una acción necesita saber de la corrida que la invoca. */
export interface EntornoAccion {
  leadId: UUID;
  leadSessionId?: UUID | null;
  runId: UUID;
  /** Posición del paso dentro de la corrida. Es la clave de idempotencia. */
  orden: number;
  contexto: ContextoRun;
  /**
   * El reloj del motor: la hora real en producción, un reloj virtual que salta
   * las esperas en "Probar" y en el simulador. Una acción que mira la hora
   * (horario de atención, tope de 24 h, ventana de Meta) la lee de acá y no de
   * `new Date()` — con el reloj real, un envío diferido nunca vería abrir el
   * horario en una prueba. Ausente = hora real (tests de una acción suelta).
   */
  ahora?: Date;
}

export type AccionHandler = (nodo: Nodo, entorno: EntornoAccion) => Promise<ResultadoAccion>;

export interface RegistroDeAcciones {
  ejecutar(nodo: Nodo, entorno: EntornoAccion): Promise<ResultadoAccion>;
  /** Si hay un handler para este nodo. No lo ejecuta. */
  soporta(nodo: Nodo): boolean;
}

/**
 * Qué acción ejecuta un nodo: la que declara el legacy `accion` en
 * `config.accion`, o la que le corresponde a un tipo del canvas
 * (`ACCION_DE_TIPO`). `undefined` = el nodo no declara ninguna.
 *
 * `Object.hasOwn` y no un acceso directo: el tipo viene de un jsonb, y
 * `ACCION_DE_TIPO["constructor"]` devolvería una función del prototipo.
 */
export function accionDeNodo(nodo: Nodo): string | undefined {
  if (nodo.tipo === "accion") {
    const accion = nodo.config["accion"];
    return typeof accion === "string" ? accion : undefined;
  }
  return Object.hasOwn(ACCION_DE_TIPO, nodo.tipo) ? ACCION_DE_TIPO[nodo.tipo] : undefined;
}

/**
 * El despachador: resuelve la acción de un nodo contra un mapa de handlers.
 *
 * En `src/` lo llama sólo `crearRegistroDeAcciones`, acá abajo. Queda
 * exportado para que los tests del motor puedan inyectar acciones falsas
 * (`marcar`) sin armar puertos; `registro-unico.test.ts` falla si otro módulo
 * de `src/` lo usa para armar un segundo registro.
 *
 * Usa Map en lugar de acceso directo a objeto para evitar alcanzar la cadena
 * de prototipos (constructor, toString, __proto__, etc.).
 */
export function crearRegistro(handlers: Record<string, AccionHandler>): RegistroDeAcciones {
  const mapaHandlers = new Map(Object.entries(handlers));

  const handlerDe = (nodo: Nodo): AccionHandler | undefined => {
    const accion = accionDeNodo(nodo);
    return accion === undefined ? undefined : mapaHandlers.get(accion);
  };

  return {
    soporta: (nodo) => handlerDe(nodo) !== undefined,

    async ejecutar(nodo, entorno) {
      const accion = accionDeNodo(nodo);
      if (nodo.tipo === "accion" && accion === undefined) {
        throw new ValidationError(`el nodo "${nodo.id}" no declara acción`, "accion_ausente");
      }
      const handler = handlerDe(nodo);
      if (!handler) {
        throw new ValidationError(
          nodo.tipo === "accion"
            ? `acción desconocida: ${accion}`
            : `el nodo "${nodo.id}" es de tipo "${nodo.tipo}", que el motor todavía no sabe ejecutar`,
          "accion_desconocida",
        );
      }
      return handler(nodo, entorno);
    },
  };
}

/**
 * Los puertos que usan las acciones: lo que leen (config, conteo de salientes,
 * lead, sesión, conversación) y lo que hacen (etiquetar, mover etapa, escalar,
 * mandar el WhatsApp).
 *
 * Producción los cierra contra los repos reales en `inngest/bootstrap.ts`.
 * "Probar" y el simulador los cierran con `crearPuertosDePrueba`
 * (`simulador.service.ts`), que intercepta los efectos. El código de cada
 * acción es el mismo en los dos casos: eso es lo que hace que la prueba diga
 * la verdad sobre producción.
 */
export type PuertosAcciones = AccionesInternasDeps &
  AccionEnviarMensajeDeps &
  AccionEnviarPlantillaDeps &
  AccionesMensajeriaRicaDeps &
  AccionesAsignacionDeps &
  AccionActualizarCampoTwinDeps &
  AccionAvisarEquipoDeps;

/**
 * **EL registro de acciones.** Hay uno solo en el proyecto y se arma acá.
 *
 * Antes había dos: el de producción (4 acciones, por `config.accion`) y el de
 * `lib/workflows/engine/handlers/` que usaba "Probar" (57 handlers que no
 * ejecutaban nada). Lo que se probaba no era lo que corría.
 * `tests/unit/workflows/registro-unico.test.ts` falla si vuelven a ser dos.
 *
 * `satisfies` contra `AccionWorkflow`: una acción del catálogo sin handler, o
 * un handler fuera del catálogo, no compila.
 */
export function crearRegistroDeAcciones(puertos: PuertosAcciones): RegistroDeAcciones {
  const enviarPlantilla = crearAccionEnviarPlantilla(puertos);
  const handlers = {
    ...crearAccionesInternas(puertos),
    ...crearAccionesDeAsignacion(puertos),
    // Marketing con la ventana cerrada sale por la plantilla: el mismo handler.
    enviar_mensaje: crearAccionEnviarMensaje(puertos, enviarPlantilla),
    enviar_plantilla: enviarPlantilla,
    actualizar_campo_twin: crearAccionActualizarCampoTwin(puertos),
    avisar_equipo: crearAccionAvisarEquipo(puertos),
    ...crearAccionesDeMensajeriaRica(puertos),
  } satisfies Record<AccionWorkflow, AccionHandler>;
  return crearRegistro(handlers);
}
