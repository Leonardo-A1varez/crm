import { NotFoundError, ValidationError } from "@/lib/errors";
import { configDeAccion } from "@/lib/workflows/config-nodos";
import { interpolarVariables } from "@/lib/workflows/variables";
import type { MetaApiService } from "@/server/services/meta-api.service";
import type { EnvioPlantillaSinSesion } from "@/server/services/workflows/plantilla-sin-sesion.service";
import { cargarDatosInterpolacion } from "./datos-interpolacion";
import type { AccionEnviarMensajeDeps } from "./enviar-mensaje";
import type { AccionHandler } from "./registro";
import { revisarTopesDeEnvio } from "./topes-de-envio";

/** Lo mismo que "Enviar mensaje", pero manda por `sendTemplate`. */
export type AccionEnviarPlantillaDeps = Omit<
  AccionEnviarMensajeDeps,
  "metaApi" | "plantillasSinSesion"
> & {
  metaApi: Pick<MetaApiService, "sendTemplate">;
  /** Para la corrida sin sesión: el lead perdido de "Reactivar perdidos". */
  plantillasSinSesion: EnvioPlantillaSinSesion;
};

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
 *
 * **Sin sesión también manda.** Una plantilla es lo único que llega a quien
 * está fuera de la ventana de 24 h, y ese lead suele tener la sesión cerrada:
 * el cron "Programado" no le pasa sesión a su corrida. Ahí sale por
 * `plantillasSinSesion` (reserva propia, sin `mensajes`) y entra al hilo del
 * Inbox cuando el lead responde (`plantilla-sin-sesion.service.ts`). La
 * decisión se toma con la sesión de la corrida y no con la activa del lead:
 * un reintento tiene que tomar el mismo camino, o la clave de un lado no
 * protegería contra el envío del otro.
 */
export function crearAccionEnviarPlantilla(deps: AccionEnviarPlantillaDeps): AccionHandler {
  return async (nodo, entorno) => {
    const { templateName, idioma, parametros } = configDeAccion("enviar_plantilla", nodo);
    const leadSessionId = entorno.leadSessionId ?? null;
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

    const plantilla = { nombre: templateName, idioma, parametrosCuerpo };
    const idempotencyKey = `wf:${entorno.runId}:${entorno.orden}`;
    if (leadSessionId === null) {
      const envio = await deps.plantillasSinSesion.enviar({
        idempotencyKey,
        workflowRunId: entorno.runId,
        leadId: entorno.leadId,
        conversacionId: conversacion.id,
        to: lead.telefono,
        plantilla,
      });
      return { puerto: "salida", salida: { envio_sin_sesion_id: envio.id } };
    }

    const mensaje = await deps.metaApi.sendTemplate({
      conversacionId: conversacion.id,
      leadSessionId,
      to: lead.telefono,
      plantilla,
      sender: "sistema",
      idempotencyKey,
    });

    return { puerto: "salida", salida: { mensaje_id: mensaje.id } };
  };
}
