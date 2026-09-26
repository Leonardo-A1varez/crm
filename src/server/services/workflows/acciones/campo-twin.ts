import { NotFoundError, ValidationError } from "@/lib/errors";
import { leerValorCampoTwin } from "@/lib/workflows/campo-twin";
import { configDeAccion } from "@/lib/workflows/config-nodos";
import { interpolarVariables } from "@/lib/workflows/variables";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { CampoTwinEditable } from "@/types/domain";
import type { LeadSession } from "@/types/entities";
import { cargarDatosInterpolacion, type DatosInterpolacionDeps } from "./datos-interpolacion";
import type { AccionHandler } from "./registro";

export interface AccionActualizarCampoTwinDeps extends DatosInterpolacionDeps {
  sessions: Pick<LeadSessionRepository, "findById" | "aplicarExtraccion">;
}

/** Lo que había en el campo antes: es lo que el Twin muestra como "antes decía…". */
function valorAnterior(sesion: LeadSession, campo: CampoTwinEditable): string | number | null {
  const previo: unknown = sesion[campo];
  return typeof previo === "string" || typeof previo === "number" ? previo : null;
}

/**
 * "Actualizar campo del Twin": escribe uno de los campos que una persona
 * corrige con el lápiz del Twin (`CAMPOS_TWIN_EDITABLES`) y deja su marca de
 * procedencia en `workflow`, en la misma operación. Es la misma puerta y la
 * misma marca que usa «Cambiar etapa» (`acciones/internas.ts`): un valor sin su
 * procedencia al día es indistinguible de uno que dedujo el extractor.
 *
 * El valor admite variables (`{{lead.nombre}}`), que se resuelven con los
 * mismos datos que «Enviar mensaje». Un campo numérico se lee con
 * `leerValorCampoTwin`, la regla con que la config revisa un número escrito a
 * mano; uno que sale mal de una variable es `ValidationError` —reintentarlo
 * daría lo mismo— y no escribe nada.
 *
 * Igual que con la etapa, una marca `workflow` no protege el campo del
 * extractor: `descartarCorregidosAMano` sólo respeta las de una persona, así
 * que el turno siguiente puede volver a pisarlo si el cliente dice otra cosa.
 */
export function crearAccionActualizarCampoTwin(deps: AccionActualizarCampoTwinDeps): AccionHandler {
  return async (nodo, entorno) => {
    const { campo, valor: texto } = configDeAccion("actualizar_campo_twin", nodo);
    // El schema ya lo exige; el `as` sólo angosta el `string` que devuelve el refine.
    const campoTwin = campo as CampoTwinEditable;
    const leadSessionId = entorno.leadSessionId;
    if (!leadSessionId) {
      throw new ValidationError(
        `el nodo "${nodo.id}" (actualizar_campo_twin) necesita una sesion activa y la corrida no tiene una`,
        "lead_session_id_ausente",
      );
    }
    const actual = await deps.sessions.findById(leadSessionId);
    if (!actual) {
      throw new NotFoundError(
        `lead_session no encontrada: ${leadSessionId}`,
        "lead_session",
        leadSessionId,
      );
    }

    const datos = await cargarDatosInterpolacion(deps, {
      leadId: entorno.leadId,
      leadSessionId,
      contexto: entorno.contexto,
    });
    const resuelto = interpolarVariables(texto, datos).texto;
    const lectura = leerValorCampoTwin(campoTwin, resuelto);
    if (!lectura.ok) {
      // Sin el valor en el mensaje: sale de datos del lead y el error queda
      // guardado en el paso, que la purga de 29 días no alcanza.
      throw new ValidationError(
        `el nodo "${nodo.id}": el valor de «${campoTwin}» no quedó un número válido después de resolver las variables`,
        "valor_campo_twin",
      );
    }

    await deps.sessions.aplicarExtraccion(
      leadSessionId,
      { [campoTwin]: lectura.valor },
      {
        [campoTwin]: {
          por: "workflow",
          at: (entorno.ahora ?? new Date()).toISOString(),
          user_id: null,
          mensaje_origen_id: null,
          valor_anterior: valorAnterior(actual, campoTwin),
        },
      },
    );
    // Sólo el campo: el valor es un dato de la sesión, y la salida del paso
    // vive en `workflow_run_pasos`, fuera del alcance de la purga de 29 días.
    return { puerto: "salida", salida: { campo: campoTwin } };
  };
}
