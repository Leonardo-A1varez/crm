import type {
  LeadSessionRepository,
  LeadSessionUpdate,
  MarcasProcedencia,
} from "@/server/repositories/lead-session.repo";
import { LeadTwinUpdateSchema, type LeadTwinUpdate } from "@/lib/validation/ai";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { CLAVE_MOTIVO_SUGERIDO } from "@/lib/ui/motivo-perdida";
import { NoopSessionLock, type SessionLock } from "@/server/lock/session-lock";
import { CAMPOS_CON_PROCEDENCIA } from "@/types/domain";
import type { CampoConProcedencia } from "@/types/domain";
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
  /** Mismo mensaje que ancla la procedencia; acá ancla además el gasto. */
  mensajeOrigenId?: UUID | null;
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

    const raw = await this.llm.extract({ current, conversationTurn, mensajeOrigenId });
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

    // El extractor NO cierra sesiones. Un "no tenemos" del agente hacía que el
    // LLM devolviera `resultado: perdido` y el servicio cerrara la venta: la
    // conversación desaparecía del Inbox, entraba a la ventana de purga de 29
    // días y las métricas contaban una pérdida por stock que nunca ocurrió.
    // Pasó en la primera conversación real, y el prompt ya le pedía lo
    // contrario ("no cierres salvo evidencia clara").
    //
    // Cerrar es una decisión humana y tiene una sola puerta: el rail del Twin
    // (decisión cerrada, `AGENTS.md §2`). Lo que el LLM creía un cierre entra
    // como propuesta bajo `CLAVE_MOTIVO_SUGERIDO`, que es lo que el popover del
    // rail ofrece para que alguien confirme.
    const extrasFinales: Record<string, unknown> = { ...patchExtras };
    if (resultado === "perdido" && motivo_perdida) {
      extrasFinales[CLAVE_MOTIVO_SUGERIDO] = motivo_perdida;
    }

    // Shallow merge extras (no replace) — preserva keys previas.
    if (Object.keys(extrasFinales).length > 0) {
      updatePatch.extras = { ...current.extras, ...extrasFinales };
    }

    if (Object.keys(updatePatch).length > 0) {
      result = await this.sessions.aplicarExtraccion(
        sessionId,
        updatePatch,
        marcasDelExtractor(updatePatch, current, mensajeOrigenId),
      );
    }

    return result;
  }
}

/**
 * Una corrección humana gana sobre el extractor: el campo se saca del patch,
 * no se pisa. Es la promesa que el panel le hace al vendedor cuando le muestra
 * "Corregido por vos" — si el próximo turno lo revirtiera, corregir a mano no
 * serviría de nada.
 *
 * `current_stage` entra en el mismo trato desde que el rail del Twin es
 * clickeable. Sin esto el control sería mentira: el extractor recalcula la
 * etapa en cada turno, así que la etapa puesta a mano duraría hasta el próximo
 * mensaje del cliente. El costo es explícito: una vez movida a mano, la etapa
 * de esa sesión deja de avanzar sola y queda a cargo de la persona. La escalada
 * a `requiere_humano` no se ve afectada — la escriben el pipeline y el agente
 * con `sessions.update`, que no pasa por este filtro, y una guarda de seguridad
 * no puede depender de que nadie haya tocado el rail.
 */
function descartarCorregidosAMano(
  patch: LeadSessionUpdate,
  procedencia: Procedencia,
): LeadSessionUpdate {
  const out: LeadSessionUpdate = { ...patch };
  for (const campo of CAMPOS_CON_PROCEDENCIA) {
    if (procedencia[campo]?.por === "humano") delete out[campo];
  }
  return out;
}

/**
 * Marcas de procedencia de lo que acaba de escribir el extractor.
 *
 * Solo para los campos que el Twin declara (`CAMPOS_CON_PROCEDENCIA`): son los
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
  for (const campo of CAMPOS_CON_PROCEDENCIA) {
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

function valorAnterior(session: LeadSession, campo: CampoConProcedencia): string | number | null {
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
