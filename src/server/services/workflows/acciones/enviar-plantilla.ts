import { NotFoundError, ValidationError } from "@/lib/errors";
import { configDeAccion } from "@/lib/workflows/config-nodos";
import { interpolarVariables } from "@/lib/workflows/variables";
import type { MetaApiService } from "@/server/services/meta-api.service";
import type { UUID } from "@/types/entities";
import type { Nodo } from "@/types/workflows";
import { cargarDatosInterpolacion } from "./datos-interpolacion";
import type { AccionEnviarMensajeDeps } from "./enviar-mensaje";
import type { AccionHandler, EntornoAccion } from "./registro";
import { revisarTopesDeEnvio } from "./topes-de-envio";

/** Lo mismo que "Enviar mensaje", pero manda por `sendTemplate`. */
export type AccionEnviarPlantillaDeps = Omit<AccionEnviarMensajeDeps, "metaApi"> & {
  metaApi: Pick<MetaApiService, "sendTemplate">;
};

function requireLeadSessionId(nodo: Nodo, entorno: EntornoAccion): UUID {
  if (entorno.leadSessionId) return entorno.leadSessionId;
  throw new ValidationError(
    `el nodo "${nodo.id}" (enviar_plantilla) necesita una sesion activa y la corrida no tiene una`,
    "lead_session_id_ausente",
  );
}

/**
 * "Plantilla HSM": manda una plantilla aprobada de WhatsApp.
 *
 * Pasa por los mismos topes que "Enviar mensaje" (`topes-de-envio.ts`: requiere
 * humano, baja, frecuencia, horario) y en el mismo orden. La ventana de 24 h de
 * Meta no aplica: una plantilla aprobada es lo único que Meta deja mandar fuera
 * de ella, y para eso existe este bloque.
 *
 * Una variable que se resuelve vacía no manda: Meta rechaza un parámetro vacío
 * con un 400, y el mensaje saldría incompleto si no. Falla sin reintento, porque
 * reintentar resuelve lo mismo.
 *
 * Sólo WhatsApp: Instagram y Messenger no tienen plantillas aprobadas.
 * La idempotencia es la de todo paso que manda algo: `wf:<runId>:<orden>`.
 */
export function crearAccionEnviarPlantilla(deps: AccionEnviarPlantillaDeps): AccionHandler {
  return async (nodo, entorno) => {
    const { templateName, idioma, parametros } = configDeAccion("enviar_plantilla", nodo);
    const leadSessionId = requireLeadSessionId(nodo, entorno);
    const ahora = entorno.ahora ?? new Date();

    const topes = await revisarTopesDeEnvio(deps, entorno, ahora, "enviar_plantilla");
    if (topes.tipo === "salto") return { puerto: "salida", salto: topes.salto };
    if (topes.tipo === "diferir") {
      return { puerto: "salida", diferirHasta: topes.hasta, salida: { diferido: true } };
    }
    const { lead } = topes;

    const datos = await cargarDatosInterpolacion(
      { leads: deps.leads, sessions: deps.sessions, users: deps.users },
      { leadId: entorno.leadId, leadSessionId, contexto: entorno.contexto },
    );
    const parametrosCuerpo = parametros.map((p, i) => {
      const { texto } = interpolarVariables(p, datos);
      if (texto.trim() === "") {
        throw new ValidationError(
          `el nodo "${nodo.id}" (enviar_plantilla): la variable ${i + 1} de la plantilla quedó vacía para este lead`,
          "parametro_vacio",
        );
      }
      return texto;
    });

    const conversacion = await deps.conversations.findActivaByLead(entorno.leadId);
    if (!conversacion) {
      throw new NotFoundError(
        `el lead ${entorno.leadId} no tiene conversación activa`,
        "conversacion",
        entorno.leadId,
      );
    }
    if (conversacion.canal !== "wa") {
      throw new ValidationError(
        `el nodo "${nodo.id}" (enviar_plantilla) sólo manda por WhatsApp y la conversación activa es de ${conversacion.canal}`,
        "plantilla_fuera_de_whatsapp",
      );
    }

    const mensaje = await deps.metaApi.sendTemplate({
      conversacionId: conversacion.id,
      leadSessionId,
      to: lead.telefono,
      plantilla: { nombre: templateName, idioma, parametrosCuerpo },
      sender: "sistema",
      idempotencyKey: `wf:${entorno.runId}:${entorno.orden}`,
    });

    return { puerto: "salida", salida: { mensaje_id: mensaje.id } };
  };
}
