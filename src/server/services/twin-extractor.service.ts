import type {
  LeadSessionRepository,
  LeadSessionUpdate,
  MarcasProcedencia,
} from "@/server/repositories/lead-session.repo";
import { LeadTwinUpdateSchema, type LeadTwinUpdate } from "@/lib/validation/ai";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { NoopSessionLock, type SessionLock } from "@/server/lock/session-lock";
import { CAMPOS_TWIN_EDITABLES } from "@/types/domain";
import type { CampoTwinEditable } from "@/types/domain";
import type { LeadSession, Procedencia, UUID } from "@/types/entities";

export interface TwinExtractorInput {
  sessionId: UUID;
  conversationTurn: string[];
  /** Mensaje entrante que disparó el turno; queda anotado en la procedencia. */
  mensajeOrigenId?: UUID | null;
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

  async extract({
    sessionId,
    conversationTurn,
    mensajeOrigenId = null,
  }: TwinExtractorInput): Promise<LeadSession> {
    return this.lock.withLock(`twin:${sessionId}`, () =>
      this.runExtraction(sessionId, conversationTurn, mensajeOrigenId),
    );
  }

  private async runExtraction(
    sessionId: UUID,
    conversationTurn: string[],
    mensajeOrigenId: UUID | null,
  ): Promise<LeadSession> {
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
    const updatePatch = descartarCorregidosAMano(
      filterDefined(mutable) as LeadSessionUpdate,
      current.procedencia,
    );

    // Shallow merge extras (no replace) — preserva keys previas.
    if (patchExtras !== undefined && Object.keys(patchExtras).length > 0) {
      updatePatch.extras = { ...current.extras, ...patchExtras };
    }

    if (Object.keys(updatePatch).length > 0) {
      result = await this.sessions.aplicarExtraccion(
        sessionId,
        updatePatch,
        marcasDelExtractor(updatePatch, current, mensajeOrigenId),
      );
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

/**
 * Una corrección humana gana sobre el extractor: el campo se saca del patch,
 * no se pisa. Es la promesa que el panel le hace al vendedor cuando le muestra
 * "Corregido por vos" — si el próximo turno lo revirtiera, corregir a mano no
 * serviría de nada.
 */
function descartarCorregidosAMano(
  patch: LeadSessionUpdate,
  procedencia: Procedencia,
): LeadSessionUpdate {
  const out: LeadSessionUpdate = { ...patch };
  for (const campo of CAMPOS_TWIN_EDITABLES) {
    if (procedencia[campo]?.por === "humano") delete out[campo];
  }
  return out;
}

/**
 * Marcas de procedencia de lo que acaba de escribir el extractor.
 *
 * Solo para los campos que el Twin declara (`CAMPOS_TWIN_EDITABLES`): son los
 * únicos que muestran chip y línea de origen, y anotar el patch entero llenaría
 * el jsonb de filas que nadie lee.
 */
function marcasDelExtractor(
  patch: LeadSessionUpdate,
  current: LeadSession,
  mensajeOrigenId: UUID | null,
): MarcasProcedencia {
  const at = new Date().toISOString();
  const marcas: MarcasProcedencia = {};
  for (const campo of CAMPOS_TWIN_EDITABLES) {
    if (patch[campo] === undefined) continue;
    marcas[campo] = {
      por: "ia",
      at,
      // El extractor no es un usuario: el `user_id` solo lo llena una persona.
      user_id: null,
      mensaje_origen_id: mensajeOrigenId,
      valor_anterior: valorAnterior(current, campo),
    };
  }
  return marcas;
}

function valorAnterior(session: LeadSession, campo: CampoTwinEditable): string | number | null {
  const previo: unknown = session[campo];
  if (typeof previo === "string" || typeof previo === "number") return previo;
  return null;
}

function filterDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as Array<keyof T>) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}
