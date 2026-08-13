import { NoopLogger, type Logger } from "@/lib/observability/logger";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { UUID } from "@/types/entities";

export interface AgentePreviewSession {
  id: UUID;
  etiqueta: string;
}

export interface AgentePreviewSessionsResult {
  disponible: boolean;
  sesiones: AgentePreviewSession[];
}

export interface AgentePreviewSessionsService {
  list(): Promise<AgentePreviewSessionsResult>;
}

/**
 * Lectura angosta para el selector de preview.
 *
 * La consola del agente no debe pagar el agregado completo del Inbox ni dejar
 * de funcionar si ese read path falla. Dos consultas batch bastan: sesiones
 * activas y sus leads.
 */
export class DefaultAgentePreviewSessionsService implements AgentePreviewSessionsService {
  private readonly logger: Logger;

  constructor(
    private readonly sessions: LeadSessionRepository,
    private readonly leads: LeadsRepository,
    logger?: Logger,
  ) {
    this.logger = (logger ?? new NoopLogger()).child({ scope: "agente-preview-sessions" });
  }

  async list(): Promise<AgentePreviewSessionsResult> {
    try {
      const activas = await this.sessions.listActive();
      const leads = await this.leads.listByIds(activas.map((session) => session.lead_id));
      const porId = new Map(leads.map((lead) => [lead.id, lead]));
      return {
        disponible: true,
        sesiones: activas.flatMap((session) => {
          const lead = porId.get(session.lead_id);
          return lead ? [{ id: session.id, etiqueta: lead.nombre }] : [];
        }),
      };
    } catch (error) {
      this.logger.warn("preview-sessions-unavailable", {
        error_type: error instanceof Error ? error.name : "unknown",
      });
      return { disponible: false, sesiones: [] };
    }
  }
}
