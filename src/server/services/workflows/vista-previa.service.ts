import { NotFoundError } from "@/lib/errors";
import { cargarDatosInterpolacion } from "@/server/services/workflows/acciones/datos-interpolacion";
import type { DatosInterpolacion } from "@/lib/workflows/variables";
import type { ConversationsParaEnviarMensaje } from "@/server/services/workflows/acciones/enviar-mensaje";
import type { Canal } from "@/types/domain";
import type { UUID } from "@/types/entities";

/**
 * La vista previa de «Enviar mensaje» contra un lead real.
 *
 * Sólo lee, y lee lo mismo que la acción `enviar_mensaje` antes de mandar:
 * los datos de las variables salen de `cargarDatosInterpolacion` y la
 * conversación de `findActivaByLead`, el mismo puerto que usa el motor para
 * medir la ventana de 24 h. Así lo que se ve en el panel es lo que el motor
 * haría con ese lead ahora, no una imitación.
 *
 * La sesión es la activa del lead: una corrida real lleva la sesión que la
 * disparó, que en el momento de mirar el editor no existe todavía.
 */

export interface VistaPreviaMensaje {
  /** Los datos que resuelven las variables, sin el contexto del disparo. */
  datos: Pick<DatosInterpolacion, "lead" | "sesion" | "vendedor">;
  /**
   * La conversación activa: su canal y cuándo escribió el lead por última vez,
   * en ISO. `null` = el lead no tiene conversación y el motor no podría mandar.
   */
  ventana: { canal: Canal; ultimoEntranteAt: string | null } | null;
}

export interface VistaPreviaMensajeDeps {
  leads: { findById: (id: UUID) => Promise<unknown> };
  sessions: {
    findActiveByLeadId: (leadId: UUID) => Promise<{ id: UUID } | null>;
    findById: (id: UUID) => Promise<unknown>;
  };
  users: { findById: (id: UUID) => Promise<unknown> };
  conversaciones: ConversationsParaEnviarMensaje;
}

export interface VistaPreviaMensajeService {
  leer(leadId: UUID): Promise<VistaPreviaMensaje>;
}

export function makeVistaPreviaMensajeService(
  deps: VistaPreviaMensajeDeps,
): VistaPreviaMensajeService {
  return {
    async leer(leadId) {
      if (!(await deps.leads.findById(leadId))) {
        throw new NotFoundError(`lead no encontrado: ${leadId}`, "lead", leadId);
      }
      const sesion = await deps.sessions.findActiveByLeadId(leadId);
      const datos = await cargarDatosInterpolacion(
        { leads: deps.leads, sessions: deps.sessions, users: deps.users },
        { leadId, leadSessionId: sesion?.id ?? null, contexto: {} },
      );
      const conversacion = await deps.conversaciones.findActivaByLead(leadId);
      return {
        datos: { lead: datos.lead, sesion: datos.sesion, vendedor: datos.vendedor },
        ventana: conversacion
          ? {
              canal: conversacion.canal,
              ultimoEntranteAt: conversacion.ultimo_entrante_at?.toISOString() ?? null,
            }
          : null,
      };
    },
  };
}
