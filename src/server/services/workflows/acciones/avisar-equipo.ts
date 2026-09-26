import { configDeAccion } from "@/lib/workflows/config-nodos";
import type { AvisarEquipo } from "@/server/services/workflows/avisar-equipo.service";
import type { AccionHandler } from "./registro";

export interface AccionAvisarEquipoDeps {
  /**
   * Producción: `AvisarEquipoService` (escribe `notificaciones`). Probar y el
   * simulador: uno que sólo anota el efecto.
   */
  avisarEquipo: AvisarEquipo;
}

/**
 * "Avisar al equipo" (`int_notif_vendedor`): deja un aviso en el panel. La
 * clave `wf:<runId>:<orden>` hace que el reintento del paso no le duplique el
 * aviso a nadie. La salida del paso guarda cuántos y a quiénes —vendedor,
 * persona o admins—, nunca el texto ni datos del lead.
 */
export function crearAccionAvisarEquipo(deps: AccionAvisarEquipoDeps): AccionHandler {
  return async (nodo, entorno) => {
    const { destinatario, mensaje } = configDeAccion("avisar_equipo", nodo);
    const r = await deps.avisarEquipo.avisar({
      leadId: entorno.leadId,
      leadSessionId: entorno.leadSessionId ?? null,
      destinatario,
      texto: mensaje.trim(),
      clave: `wf:${entorno.runId}:${entorno.orden}`,
      runId: entorno.runId,
    });
    return { puerto: "salida", salida: { destinatarios: r.destinatarios, para: r.para } };
  };
}
