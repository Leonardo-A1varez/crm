import type {
  LeadSessionRepository,
  LeadSessionUpdate,
} from "@/server/repositories/lead-session.repo";
import { LeadTwinUpdateSchema, type LeadTwinUpdate } from "@/lib/validation/ai";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { NoopSessionLock, type SessionLock } from "@/server/lock/session-lock";
import type { LeadSession, UUID } from "@/types/entities";

export interface TwinExtractorInput {
  sessionId: UUID;
  conversationTurn: string[];
}

export interface TwinExtractorLLMInput {
  current: LeadSession;
  conversationTurn: string[];
}

export interface TwinExtractorLLM {
  extract(input: TwinExtractorLLMInput): Promise<LeadTwinUpdate>;
}

export interface TwinExtractorService {
  extract(input: TwinExtractorInput): Promise<LeadSession>;
}

export class DefaultTwinExtractorService implements TwinExtractorService {
  constructor(
    private readonly sessions: LeadSessionRepository,
    private readonly llm: TwinExtractorLLM,
    private readonly lock: SessionLock = new NoopSessionLock(),
  ) {}

  async extract({ sessionId, conversationTurn }: TwinExtractorInput): Promise<LeadSession> {
    return this.lock.withLock(`twin:${sessionId}`, () =>
      this.runExtraction(sessionId, conversationTurn),
    );
  }

  private async runExtraction(sessionId: UUID, conversationTurn: string[]): Promise<LeadSession> {
    const current = await this.sessions.findById(sessionId);
    if (!current)
      throw new NotFoundError(`sesión no encontrada: ${sessionId}`, "lead_session", sessionId);
    if (current.resultado !== null) return current;

    const raw = await this.llm.extract({ current, conversationTurn });
    const parseResult = LeadTwinUpdateSchema.safeParse(raw);
    if (!parseResult.success) {
      throw new ValidationError(
        "LLM devolvió patch inválido para LeadTwinUpdate",
        parseResult.error.issues,
        parseResult.error,
      );
    }
    const patch = parseResult.data;

    const { resultado, motivo_perdida, extras: patchExtras, ...mutable } = patch;

    let result = current;
    const updatePatch = filterDefined(mutable) as LeadSessionUpdate;

    // Shallow merge extras (no replace) — preserva keys previas.
    if (patchExtras !== undefined && Object.keys(patchExtras).length > 0) {
      updatePatch.extras = { ...current.extras, ...patchExtras };
    }

    if (Object.keys(updatePatch).length > 0) {
      result = await this.sessions.update(sessionId, updatePatch);
    }

    if (resultado !== undefined && resultado !== null) {
      result = await this.sessions.close(sessionId, {
        resultado,
        motivo_perdida: motivo_perdida ?? null,
      });
    }

    return result;
  }
}

function filterDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as Array<keyof T>) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}
