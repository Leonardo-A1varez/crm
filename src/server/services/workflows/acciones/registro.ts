import { ValidationError } from "@/lib/errors";
import type { ContextoRun, Nodo, ResultadoAccion } from "@/types/workflows";
import type { UUID } from "@/types/entities";

/** Todo lo que una acción necesita saber de la corrida que la invoca. */
export interface EntornoAccion {
  leadId: UUID;
  leadSessionId?: UUID | null;
  runId: UUID;
  /** Posición del paso dentro de la corrida. Es la clave de idempotencia. */
  orden: number;
  contexto: ContextoRun;
}

export type AccionHandler = (nodo: Nodo, entorno: EntornoAccion) => Promise<ResultadoAccion>;

export interface RegistroDeAcciones {
  ejecutar(nodo: Nodo, entorno: EntornoAccion): Promise<ResultadoAccion>;
}

/**
 * Resuelve `config.accion` contra un mapa de handlers inyectado.
 *
 * Que el registro se inyecte es lo que hace posible el simulador: pasarle un
 * registro que anota en vez de hacer da una simulación con el MISMO ejecutor,
 * no una segunda implementación que se desincroniza.
 *
 * Usa Map en lugar de acceso directo a objeto para evitar alcanzar la cadena
 * de prototipos (constructor, toString, __proto__, etc.).
 */
export function crearRegistro(handlers: Record<string, AccionHandler>): RegistroDeAcciones {
  const mapaHandlers = new Map(Object.entries(handlers));
  return {
    async ejecutar(nodo, entorno) {
      const nombre = nodo.config["accion"];
      if (typeof nombre !== "string") {
        throw new ValidationError(`el nodo "${nodo.id}" no declara acción`, "accion_ausente");
      }
      const handler = mapaHandlers.get(nombre);
      if (!handler) {
        throw new ValidationError(`acción desconocida: ${nombre}`, "accion_desconocida");
      }
      return handler(nodo, entorno);
    },
  };
}
