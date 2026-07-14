import type { Logger } from "@/lib/observability/logger";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { UUID } from "@/types/entities";

/**
 * Purge real (Slice 4a 10.6): storage cleanup PRIMERO (post-CASCADE los
 * media_url ya no existen para listarlos), después delete de la sesión
 * (CASCADE borra mensajes + rule_executions).
 *
 * Falla de storage NO aborta el purge: blob huérfano consume quota, pero
 * retener PII >29d viola la política de retención (docs/data-retention.md).
 * Replay-safe: delete de id inexistente es no-op en el repo.
 */

export interface PurgeSessionDeps {
  sessions: LeadSessionRepository;
  messages: MessagesRepository;
  /** Borra objetos del bucket mensajes_media. Bootstrap la implementa con storage.remove. */
  removeMedia: (paths: string[]) => Promise<void>;
  logger: Logger;
}

const BUCKET_MARKER = "/mensajes_media/";

/** URL → path relativo al bucket; null si no pertenece a mensajes_media. */
function toBucketPath(mediaUrl: string): string | null {
  const idx = mediaUrl.indexOf(BUCKET_MARKER);
  if (idx === -1) return null;
  const path = mediaUrl.slice(idx + BUCKET_MARKER.length);
  return path.length > 0 ? path : null;
}

export function makePurgeSession(deps: PurgeSessionDeps): (sessionId: UUID) => Promise<void> {
  return async (sessionId) => {
    const msgs = await deps.messages.listBySessionId(sessionId, { limit: 1000 });

    const paths: string[] = [];
    for (const m of msgs) {
      if (!m.media_url) continue;
      const path = toBucketPath(m.media_url);
      if (path) {
        paths.push(path);
      } else {
        deps.logger.warn("purgeSession.media.fuera_de_bucket", { sessionId, mensajeId: m.id });
      }
    }

    if (paths.length > 0) {
      try {
        await deps.removeMedia(paths);
      } catch (e) {
        deps.logger.warn("purgeSession.storage.fallo", {
          sessionId,
          count: paths.length,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    await deps.sessions.delete(sessionId);
    deps.logger.info("purgeSession.done", { sessionId, mediaRemoved: paths.length });
  };
}
