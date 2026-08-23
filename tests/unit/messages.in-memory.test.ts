import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { DEFAULT_FIXTURES, runMessagesContract } from "../repositories/messages.contract";
import type { UUID } from "@/types/entities";

// Resolver `lead_session_id -> leadId`. Mismo idioma que `resolverWorkflowId`
// en `workflow-runs.repo.ts`: `contarSalientesAutomaticos` necesita este
// puente porque `Mensaje` no trae `lead_id` (ver el doc comment del
// constructor de `InMemoryMessagesRepository`). Sin este resolver, el
// contract de "no cuenta mensajes de otro lead" fallaria contra la impl
// in-memory aunque la impl real de Supabase lo resuelva bien con el join.
function resolverLeadId(leadSessionId: UUID): UUID | undefined {
  if (leadSessionId === DEFAULT_FIXTURES.leadSessionId) return DEFAULT_FIXTURES.leadId;
  if (leadSessionId === DEFAULT_FIXTURES.leadSessionIdAlt) return DEFAULT_FIXTURES.leadIdAlt;
  return undefined;
}

runMessagesContract(() => new InMemoryMessagesRepository(resolverLeadId));
