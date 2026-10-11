import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { sessionsPurgeRequested } from "@/inngest/events";
import { esSesionImportada } from "@/lib/coexistencia/sesion-importada";
import { isNonRetriable } from "@/lib/errors";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { UUID } from "@/types/entities";

const PURGE_AGE_DAYS = 29;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PurgeOldSessionsDeps {
  sessions: LeadSessionRepository;
  // Borrado real (CASCADE mensajes + cleanup Storage). Fase 14 wireup Supabase.
  purgeSession: (sessionId: UUID) => Promise<void>;
  now?: () => Date;
}

export interface PurgeOldSessionsResult {
  purgedCount: number;
}

export async function purgeOldSessionsHandler(
  _input: Record<string, never>,
  deps: PurgeOldSessionsDeps,
): Promise<PurgeOldSessionsResult> {
  const now = (deps.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - PURGE_AGE_DAYS * DAY_MS);

  // El historial importado de la app Business llega con mensajes de hasta 180
  // días y su sesión se cierra a la hora del último: sin esta excepción esta
  // misma corrida lo borraría (CASCADE) la noche de la importación. Es una
  // decisión pendiente del dueño (retención de 29 días vs. conservar el
  // historial, docs/data-retention.md): hasta que decida, no se purga.
  const candidates = (await deps.sessions.listClosedBefore(cutoff)).filter(
    (s) => !esSesionImportada(s),
  );
  for (const s of candidates) {
    await deps.purgeSession(s.id);
  }

  return { purgedCount: candidates.length };
}

export function makePurgeOldSessionsFn(deps: PurgeOldSessionsDeps) {
  return inngest.createFunction(
    {
      id: "purge-old-sessions",
      triggers: [{ event: sessionsPurgeRequested }, { cron: "0 4 * * *" }],
    },
    async ({ step }) => {
      return step.run("purge", async () => {
        try {
          return await purgeOldSessionsHandler({}, deps);
        } catch (e) {
          if (isNonRetriable(e)) {
            throw new NonRetriableError((e as Error).message, { cause: e });
          }
          throw e;
        }
      });
    },
  );
}
