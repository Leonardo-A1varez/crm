import { ValidationError } from "@/lib/errors";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { NotificacionesRepository } from "@/server/repositories/notificaciones.repo";
import type { UsersRepository } from "@/server/repositories/users.repo";
import type { UUID } from "@/types/entities";
import type { ConversationsParaEnviarMensaje } from "./acciones/enviar-mensaje";

/**
 * "Avisar al equipo" (decisión 3 del dueño): un aviso en el panel, no un
 * WhatsApp ni un email, así que no depende de Meta ni del cupo.
 *
 * A quién: al vendedor asignado a la sesión o a la persona que eligió el
 * bloque. Si no hay nadie —la sesión no tiene vendedor, o la persona elegida
 * ya no está activa— el aviso va a los admins activos: un aviso sin
 * destinatario es un aviso perdido, que es justo lo que el bloque evita.
 *
 * Qué guarda: el lead, la conversación y la corrida como referencias, y el
 * texto tal como lo escribió quien armó el flujo. Nunca una copia de datos del
 * lead: el nombre se lee al mostrarla, y borrar el lead se lleva el aviso.
 */

export interface AvisarEquipoInput {
  leadId: UUID;
  leadSessionId: UUID | null;
  /** `"vendedor_asignado"` o el id de un usuario. */
  destinatario: string;
  texto: string;
  /** `wf:<runId>:<orden>`: el reintento del paso no duplica el aviso. */
  clave: string;
  runId: UUID;
}

export interface ResultadoAviso {
  /** Cuántas personas lo recibieron (las que ya lo tenían de un reintento cuentan). */
  destinatarios: number;
  para: "vendedor_asignado" | "usuario" | "admins";
}

/** El puerto de la acción. Producción lo cierra con `AvisarEquipoService`; Probar, con uno que anota. */
export interface AvisarEquipo {
  avisar(input: AvisarEquipoInput): Promise<ResultadoAviso>;
}

export interface AvisarEquipoDeps {
  users: Pick<UsersRepository, "findById" | "list">;
  sessions: Pick<LeadSessionRepository, "findById" | "findActiveByLeadId">;
  conversations: Pick<ConversationsParaEnviarMensaje, "findActivaByLead">;
  notificaciones: Pick<NotificacionesRepository, "crear">;
}

export class AvisarEquipoService implements AvisarEquipo {
  constructor(private readonly deps: AvisarEquipoDeps) {}

  async avisar(input: AvisarEquipoInput): Promise<ResultadoAviso> {
    const { ids, para } = await this.destinatarios(input);
    if (ids.length === 0) {
      throw new ValidationError(
        "no hay a quién avisar: la sesión no tiene vendedor asignado y no hay ningún admin activo",
        "sin_destinatarios",
      );
    }
    const conversacion = await this.deps.conversations.findActivaByLead(input.leadId);
    await this.deps.notificaciones.crear(
      ids.map((usuario_id) => ({
        usuario_id,
        lead_id: input.leadId,
        conversacion_id: conversacion?.id ?? null,
        workflow_run_id: input.runId,
        texto: input.texto.trim(),
        clave: input.clave,
      })),
    );
    return { destinatarios: ids.length, para };
  }

  private async destinatarios(
    input: AvisarEquipoInput,
  ): Promise<{ ids: UUID[]; para: ResultadoAviso["para"] }> {
    if (input.destinatario === "vendedor_asignado") {
      const sesion = input.leadSessionId
        ? await this.deps.sessions.findById(input.leadSessionId)
        : await this.deps.sessions.findActiveByLeadId(input.leadId);
      const vendedorId = sesion?.vendedor_asignado_id ?? null;
      if (vendedorId && (await this.activo(vendedorId))) {
        return { ids: [vendedorId], para: "vendedor_asignado" };
      }
    } else if (await this.activo(input.destinatario)) {
      return { ids: [input.destinatario], para: "usuario" };
    }
    const admins = await this.deps.users.list({ rol: "admin" });
    return { ids: admins.filter((a) => a.activo).map((a) => a.id), para: "admins" };
  }

  private async activo(usuarioId: UUID): Promise<boolean> {
    return (await this.deps.users.findById(usuarioId))?.activo === true;
  }
}
