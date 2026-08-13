import { ConflictError, IllegalStateError, NotFoundError } from "@/lib/errors";
import { etapaAlcanzada } from "@/lib/ui/stage";
import type {
  CampoTwinEditable,
  CurrentStage,
  EtapaEmbudo,
  MotivoPerdida,
  Resultado,
} from "@/types/domain";
import type { LeadSession, Procedencia, UUID } from "@/types/entities";
import type { Update } from "./_types";

// `extras` opcional en insert (default `{}`). `context_summary` opcional (default null).
// DB tiene DEFAULTs equivalentes, mirrored aquí.
export type LeadSessionInsert = Omit<
  LeadSession,
  | "id"
  | "started_at"
  | "updated_at"
  | "closed_at"
  | "extras"
  | "context_summary"
  | "procedencia"
  | "etapa_alcanzada"
> & {
  extras?: Record<string, unknown>;
  context_summary?: string | null;
};
// `updated_at` fuera del patch: lo escribe el trigger de la DB. Dejarlo pasar
// permitiría anotar una edición con una fecha que no es la de la edición.
// `etapa_alcanzada` tampoco: la deriva el repo de `current_stage` en cada
// update, y dejarla escribible permitiría hacer retroceder el rail del Twin.
export type LeadSessionUpdate = Update<
  LeadSession,
  | "id"
  | "lead_id"
  | "started_at"
  | "updated_at"
  | "closed_at"
  | "resultado"
  | "motivo_perdida"
  | "etapa_alcanzada"
>;

/**
 * Marcas de procedencia que deja una escritura del extractor, por campo. El
 * caller las arma porque es el único que sabe de qué mensaje salió cada dato;
 * el repo solo las mergea sobre lo que ya había.
 */
export type MarcasProcedencia = Procedencia;

export interface CloseInput {
  resultado: Resultado;
  motivo_perdida?: MotivoPerdida | null;
}

/**
 * Cómo termina una sesión cuando la resuelve una persona desde el rail del Twin.
 *
 * Unión discriminada y no `{ resultado, motivo?: … }`: el motivo es obligatorio
 * cuando la venta se perdió, y así un cierre perdido sin motivo no se puede ni
 * escribir. La regla queda en el tipo y no solo en un `if` que alguien puede
 * olvidar de copiar en el próximo caller.
 */
export type ResolucionSesion =
  | { resultado: "exito" }
  | { resultado: "perdido"; motivo: MotivoPerdida };

/**
 * Cómo terminó una sesión ya cerrada, sin el resto de la fila.
 *
 * Es la forma angosta que necesita la lista de leads para decir "este lead se
 * perdió por precio" sin traerse el Twin entero de cada sesión histórica.
 */
export interface CierreSesion {
  lead_id: UUID;
  resultado: Resultado;
  motivo_perdida: MotivoPerdida | null;
  closed_at: Date;
}

export interface LeadSessionRepository {
  create(input: LeadSessionInsert): Promise<LeadSession>;
  findById(id: UUID): Promise<LeadSession | null>;
  // Sesión activa = resultado IS NULL. Máx 1 por lead (partial unique).
  findActiveByLeadId(leadId: UUID): Promise<LeadSession | null>;
  // Todas sesiones activas (resultado IS NULL). Inbox listing.
  listActive(): Promise<LeadSession[]>;
  // Todas las sesiones del lead (activa + cerradas), started_at DESC. Detalle /leads/[id].
  listByLeadId(leadId: UUID): Promise<LeadSession[]>;
  /**
   * Varias sesiones por id, de una sola consulta.
   *
   * Existe para el buscador del Inbox: la búsqueda dentro de los mensajes
   * devuelve `lead_session_id` y hay que llegar al lead. Resolverlo con
   * `findById` por mensaje sería un N+1 sobre el resultado de la búsqueda, que
   * es justo la lista que puede tener cientos de filas.
   *
   * Ids inexistentes o no-UUID no aparecen en el resultado: no es un error, la
   * purga de 29 días pudo llevarse la sesión entre dos consultas.
   */
  listByIds(ids: UUID[]): Promise<LeadSession[]>;
  update(id: UUID, patch: LeadSessionUpdate): Promise<LeadSession>;
  close(id: UUID, input: CloseInput): Promise<LeadSession>;
  /**
   * Cierra la sesión con su resultado y deja la etapa que le corresponde, en la
   * misma operación, anotando que la decisión fue de una persona.
   *
   * Existe aparte de `close` porque son dos actos distintos: `close` lo dispara
   * el pipeline cuando la conversación terminó, y no toca la etapa; esto lo
   * dispara un vendedor que declara ganada o perdida la venta, y ahí la etapa
   * **es** el dato —"Cerrado" o "Perdido" es lo que va a leer el resto del
   * panel—.
   *
   * `resultado` y `current_stage` son columnas distintas y esta operación las
   * cruza. La regla, que es la que hay que respetar en cualquier caller nuevo:
   *
   * - **Ganado** → `current_stage = "cerrado"` (el paso 6 del embudo, así que
   *   `etapa_alcanzada` avanza hasta ahí) + `resultado = "exito"`, sin motivo.
   * - **Perdido** → `current_stage = "perdido"`, que es un **desvío** y no el
   *   paso 7: `etapa_alcanzada` no se mueve y el rail queda congelado donde la
   *   conversación llegó antes de caerse + `resultado = "perdido"` + motivo.
   *
   * Idempotente con el mismo resultado y motivo (replay-safe); con otro lanza
   * `IllegalStateError`, igual que `close`.
   */
  resolver(id: UUID, cierre: ResolucionSesion, userId: UUID | null): Promise<LeadSession>;
  listClosedBefore(date: Date): Promise<LeadSession[]>;
  /**
   * Cierres de todas las sesiones cerradas, del más reciente al más viejo.
   *
   * Una sola consulta de 4 columnas para toda la pantalla de leads: sin esto el
   * listado tendría que pedir `listByLeadId` por fila para saber cómo terminó
   * cada lead. El volumen está acotado por la purga de 29 días.
   */
  listCierres(): Promise<CierreSesion[]>;
  /**
   * Leads con alguna sesión cuyo código de producto cotizado contiene `q`.
   *
   * La búsqueda de la pantalla de leads incluye el código cotizado, que vive
   * acá y no en `leads`; esto devuelve los ids para que la consulta de leads
   * los sume a su `OR` en vez de hacer un lookup por fila.
   */
  listLeadIdsByCodigo(q: string): Promise<UUID[]>;
  // Purge cron (Slice 4). CASCADE borra mensajes + rule_executions.
  // Id inexistente = no-op (replay-safe para retries Inngest).
  delete(id: UUID): Promise<void>;
  // Merge de leads: mueve TODAS las sesiones de `fromLeadId` a `toLeadId`.
  // Devuelve count movidas; 0 = no-op (replay-safe). No usar fuera del merge —
  // `update` sigue prohibiendo lead_id a propósito.
  reassignLead(fromLeadId: UUID, toLeadId: UUID): Promise<number>;
  // Edicion humana de un campo del Twin: escribe el valor y deja la marca de
  // procedencia en la misma operacion. Van juntos a proposito — un valor
  // corregido sin su marca es indistinguible de uno que dedujo el extractor.
  editarCampoTwin(
    id: UUID,
    campo: CampoTwinEditable,
    valor: string | number | null,
    userId: UUID | null,
  ): Promise<LeadSession>;
  /**
   * Movimiento de etapa hecho a mano desde el rail del Twin.
   *
   * No es `editarCampoTwin` con otro campo por dos razones: el valor es un enum
   * y no texto libre, y mover la etapa arrastra `etapa_alcanzada` —que solo el
   * repo sabe derivar—. Solo acepta etapas del embudo: `perdido` y
   * `requiere_humano` no son posiciones y las decide el pipeline.
   *
   * Deja `procedencia.current_stage` en "humano", que es lo que hace que el
   * extractor no la vuelva a pisar en el turno siguiente.
   */
  moverEtapa(id: UUID, etapa: EtapaEmbudo, userId: UUID | null): Promise<LeadSession>;

  // Escritura del extractor: el patch y sus marcas de procedencia en la misma
  // operacion, por el mismo motivo que `editarCampoTwin`. Existe aparte de
  // `update` porque `update` lo usan callers que no extraen nada (pausar la IA,
  // reasignar) y no tienen mensaje de origen que anotar.
  aplicarExtraccion(
    id: UUID,
    patch: LeadSessionUpdate,
    marcas: MarcasProcedencia,
  ): Promise<LeadSession>;
}

/**
 * La etapa que le corresponde a cada resultado, y el motivo que viaja con él.
 *
 * Viven acá y no duplicados en cada implementación del repo: son la semántica
 * de `resolver`, no un detalle de cómo se persiste. `etapa_alcanzada` sale
 * sola de `etapaAlcanzada(previa, etapa)` en los dos casos —`cerrado` la
 * arrastra porque es el paso 6, `perdido` la deja quieta porque es un desvío
 * sin posición— y por eso no hay una regla aparte para el máximo.
 */
export function etapaDeResolucion(cierre: ResolucionSesion): CurrentStage {
  return cierre.resultado === "exito" ? "cerrado" : "perdido";
}

export function motivoDeResolucion(cierre: ResolucionSesion): MotivoPerdida | null {
  return cierre.resultado === "perdido" ? cierre.motivo : null;
}

// Deep clone defensivo para extras (jsonb arbitrario LLM-extracted).
function cloneSession(s: LeadSession): LeadSession {
  return { ...s, extras: structuredClone(s.extras) };
}

export class InMemoryLeadSessionRepository implements LeadSessionRepository {
  private readonly store = new Map<UUID, LeadSession>();

  async create(input: LeadSessionInsert): Promise<LeadSession> {
    for (const s of this.store.values()) {
      if (s.lead_id === input.lead_id && s.resultado === null) {
        throw new ConflictError(
          `ya existe sesión activa para lead ${input.lead_id}`,
          "active_session_exists",
        );
      }
    }
    const session: LeadSession = {
      ...input,
      extras: structuredClone(input.extras ?? {}),
      context_summary: input.context_summary ?? null,
      stage_before_handoff: input.stage_before_handoff ?? null,
      procedencia: {},
      etapa_alcanzada: etapaAlcanzada("nuevo", input.current_stage),
      id: crypto.randomUUID(),
      started_at: new Date(),
      updated_at: new Date(),
      closed_at: null,
    };
    this.store.set(session.id, session);
    return cloneSession(session);
  }

  async findById(id: UUID): Promise<LeadSession | null> {
    const s = this.store.get(id);
    return s ? cloneSession(s) : null;
  }

  async findActiveByLeadId(leadId: UUID): Promise<LeadSession | null> {
    for (const s of this.store.values()) {
      if (s.lead_id === leadId && s.resultado === null) return cloneSession(s);
    }
    return null;
  }

  async listActive(): Promise<LeadSession[]> {
    const out: LeadSession[] = [];
    for (const s of this.store.values()) {
      if (s.resultado === null) out.push(cloneSession(s));
    }
    return out;
  }

  async listByLeadId(leadId: UUID): Promise<LeadSession[]> {
    return Array.from(this.store.values())
      .filter((s) => s.lead_id === leadId)
      .sort((a, b) => b.started_at.getTime() - a.started_at.getTime())
      .map(cloneSession);
  }

  async listByIds(ids: UUID[]): Promise<LeadSession[]> {
    if (ids.length === 0) return [];
    const buscados = new Set(ids);
    return Array.from(this.store.values())
      .filter((s) => buscados.has(s.id))
      .sort((a, b) => b.started_at.getTime() - a.started_at.getTime())
      .map(cloneSession);
  }

  async update(id: UUID, patch: LeadSessionUpdate): Promise<LeadSession> {
    const current = this.store.get(id);
    if (!current) throw new NotFoundError(`sesión no encontrada: ${id}`, "lead_session", id);
    const next: LeadSession = {
      ...current,
      ...patch,
      extras: patch.extras !== undefined ? structuredClone(patch.extras) : current.extras,
      id: current.id,
      lead_id: current.lead_id,
      started_at: current.started_at,
      // Espeja el trigger `lead_session_bump_updated_at` de la DB.
      updated_at: new Date(),
      closed_at: current.closed_at,
      resultado: current.resultado,
      motivo_perdida: current.motivo_perdida,
      etapa_alcanzada:
        patch.current_stage !== undefined
          ? etapaAlcanzada(current.etapa_alcanzada, patch.current_stage)
          : current.etapa_alcanzada,
    };
    this.store.set(id, next);
    return cloneSession(next);
  }

  async close(id: UUID, input: CloseInput): Promise<LeadSession> {
    const current = this.store.get(id);
    if (!current) throw new NotFoundError(`sesión no encontrada: ${id}`, "lead_session", id);
    if (current.resultado !== null) {
      // Idempotencia: mismo resultado + motivo → return existing (replay-safe).
      // Permite Inngest retry sin NonRetriable: close repetido es no-op.
      const requestedMotivo = input.motivo_perdida ?? null;
      if (current.resultado === input.resultado && current.motivo_perdida === requestedMotivo) {
        return cloneSession(current);
      }
      // Resultado/motivo distinto = bug del caller, no retry → fail loud NonRetriable.
      throw new IllegalStateError(
        `sesión ya cerrada con resultado distinto (current=${current.resultado}/${current.motivo_perdida ?? "null"}, requested=${input.resultado}/${requestedMotivo ?? "null"})`,
        "session_already_closed_different",
      );
    }
    const closed: LeadSession = {
      ...current,
      resultado: input.resultado,
      motivo_perdida: input.motivo_perdida ?? null,
      closed_at: new Date(),
      updated_at: new Date(),
    };
    this.store.set(id, closed);
    return cloneSession(closed);
  }

  async resolver(id: UUID, cierre: ResolucionSesion, userId: UUID | null): Promise<LeadSession> {
    const current = this.store.get(id);
    if (!current) throw new NotFoundError(`sesión no encontrada: ${id}`, "lead_session", id);
    const motivo = motivoDeResolucion(cierre);
    if (current.resultado !== null) {
      if (current.resultado === cierre.resultado && current.motivo_perdida === motivo) {
        return cloneSession(current);
      }
      throw new IllegalStateError(
        `sesión ya cerrada con resultado distinto (current=${current.resultado}/${current.motivo_perdida ?? "null"}, requested=${cierre.resultado}/${motivo ?? "null"})`,
        "session_already_closed_different",
      );
    }
    const etapa = etapaDeResolucion(cierre);
    const next: LeadSession = {
      ...current,
      current_stage: etapa,
      // `cerrado` es el paso 6 y arrastra el máximo; `perdido` es un desvío y lo
      // deja donde estaba. Las dos reglas ya están adentro de `etapaAlcanzada`.
      etapa_alcanzada: etapaAlcanzada(current.etapa_alcanzada, etapa),
      resultado: cierre.resultado,
      motivo_perdida: motivo,
      closed_at: new Date(),
      updated_at: new Date(),
      procedencia: {
        ...current.procedencia,
        current_stage: {
          por: "humano",
          at: new Date().toISOString(),
          user_id: userId,
          mensaje_origen_id: null,
          valor_anterior: current.current_stage,
        },
      },
    };
    this.store.set(id, next);
    return cloneSession(next);
  }

  async listClosedBefore(date: Date): Promise<LeadSession[]> {
    const out: LeadSession[] = [];
    for (const s of this.store.values()) {
      if (s.closed_at && s.closed_at < date) out.push(cloneSession(s));
    }
    return out;
  }

  async listCierres(): Promise<CierreSesion[]> {
    const out: CierreSesion[] = [];
    for (const s of this.store.values()) {
      if (s.resultado === null || s.closed_at === null) continue;
      out.push({
        lead_id: s.lead_id,
        resultado: s.resultado,
        motivo_perdida: s.motivo_perdida,
        closed_at: s.closed_at,
      });
    }
    return out.sort((a, b) => b.closed_at.getTime() - a.closed_at.getTime());
  }

  async listLeadIdsByCodigo(q: string): Promise<UUID[]> {
    const needle = q.toLowerCase();
    if (needle === "") return [];
    const out = new Set<UUID>();
    for (const s of this.store.values()) {
      if (s.codigo_interno && s.codigo_interno.toLowerCase().includes(needle)) {
        out.add(s.lead_id);
      }
    }
    return Array.from(out);
  }

  async delete(id: UUID): Promise<void> {
    this.store.delete(id);
  }

  async editarCampoTwin(
    id: UUID,
    campo: CampoTwinEditable,
    valor: string | number | null,
    userId: UUID | null,
  ): Promise<LeadSession> {
    const current = this.store.get(id);
    if (!current) {
      throw new NotFoundError(`lead_session no encontrada: ${id}`, "lead_session", id);
    }
    const next: LeadSession = {
      ...current,
      [campo]: valor,
      procedencia: {
        ...current.procedencia,
        [campo]: {
          por: "humano",
          at: new Date().toISOString(),
          user_id: userId,
          mensaje_origen_id: null,
          valor_anterior: valorAnterior(current, campo),
        },
      },
      updated_at: new Date(),
    } as LeadSession;
    this.store.set(id, next);
    return structuredClone(next);
  }

  async moverEtapa(id: UUID, etapa: EtapaEmbudo, userId: UUID | null): Promise<LeadSession> {
    const current = this.store.get(id);
    if (!current) {
      throw new NotFoundError(`lead_session no encontrada: ${id}`, "lead_session", id);
    }
    // Pasa por `update` para no duplicar la derivación de `etapa_alcanzada`:
    // un retroceso a mano mueve `current_stage` y deja el máximo donde estaba.
    const conEtapa = await this.update(id, { current_stage: etapa });
    const next: LeadSession = {
      ...conEtapa,
      procedencia: {
        ...conEtapa.procedencia,
        current_stage: {
          por: "humano",
          at: new Date().toISOString(),
          user_id: userId,
          mensaje_origen_id: null,
          valor_anterior: current.current_stage,
        },
      },
    };
    this.store.set(id, next);
    return cloneSession(next);
  }

  async aplicarExtraccion(
    id: UUID,
    patch: LeadSessionUpdate,
    marcas: MarcasProcedencia,
  ): Promise<LeadSession> {
    const current = this.store.get(id);
    if (!current) {
      throw new NotFoundError(`lead_session no encontrada: ${id}`, "lead_session", id);
    }
    const conPatch = await this.update(id, patch);
    const next: LeadSession = {
      ...conPatch,
      procedencia: { ...conPatch.procedencia, ...marcas },
    };
    this.store.set(id, next);
    return cloneSession(next);
  }

  async reassignLead(fromLeadId: UUID, toLeadId: UUID): Promise<number> {
    let moved = 0;
    for (const [id, s] of this.store) {
      if (s.lead_id !== fromLeadId) continue;
      this.store.set(id, { ...s, lead_id: toLeadId });
      moved += 1;
    }
    return moved;
  }
}

/**
 * Valor que tenía el campo antes de pisarlo. Los campos del Twin son escalares
 * o null; el `unknown` intermedio es solo para no indexar `LeadSession` con un
 * string arbitrario.
 */
function valorAnterior(session: LeadSession, campo: CampoTwinEditable): string | number | null {
  const previo: unknown = session[campo];
  if (typeof previo === "string" || typeof previo === "number") return previo;
  return null;
}
