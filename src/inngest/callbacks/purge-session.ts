/**
 * purgeSession callback — Slice 1 7.8 STUB.
 *
 * Pilot: log-only no-op. Real impl diferido Slice 4 cuando:
 *   1. `LeadSessionRepository.delete(id)` agregue método (Migration 0003
 *      tiene CASCADE configurado lead_session → mensajes → rule_executions,
 *      solo falta el delete RPC en el repo).
 *   2. Storage bucket `mensajes_media` cleanup (objetos `*_media` referenciados
 *      por mensajes purgados). Sin esto blobs huérfanos consumen Supabase
 *      Storage quota — pre-launch obligatorio.
 *
 * Pilot trade-off: sesiones cerradas >29d NO se purgan automáticamente. Crece
 * DB ~5K leads/mes × ~15 messages = 75K rows/mes. Aceptable hasta Slice 4
 * (~3 meses dev), después wireup real obligatorio.
 */

import type { Logger } from "@/lib/observability/logger";
import type { UUID } from "@/types/entities";

export function makePurgeSession(logger: Logger): (sessionId: UUID) => Promise<void> {
  return async (sessionId) => {
    logger.warn("purgeSession.stub", {
      sessionId,
      note: "Slice 4 wireup pendiente: agregar LeadSessionRepository.delete + Storage cleanup.",
    });
  };
}
