import type { Canal, CurrentStage, Direction } from "./domain";
import type { UUID } from "./entities";

/**
 * Item de inbox: lead con sesión activa + último mensaje + canales vinculados.
 * Forma derivada — no es entity DB. Producida por `InboxService.listActiveLeads`.
 * Vive en `types/` porque UI (components/) y service (server-services/) la
 * comparten — boundaries no permite components→server-services.
 */
export interface InboxItem {
  leadId: UUID;
  sessionId: UUID;
  nombre: string;
  currentStage: CurrentStage;
  iaPausada: boolean;
  ultimaActividad: Date;
  ultimoMensaje: {
    body: string;
    direction: Direction;
    createdAt: Date;
  } | null;
  canales: Canal[];
}
