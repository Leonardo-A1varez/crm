import { ConflictError, IllegalStateError, NotFoundError, ValidationError } from "@/lib/errors";
import type { HistorialVendedor } from "@/lib/round-robin";
import { esEtapaEmbudo, etapaAlcanzada } from "@/lib/ui/stage";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError, type PostgrestErrorLike } from "@/server/db/postgrest-errors";
import { escaparLike } from "@/server/db/postgrest-like";
import { serverNowIso } from "@/server/db/server-time";
import type { Database } from "@/server/db/types.gen";
import { isUuid } from "@/server/db/uuid";
import type {
  CampoTwinEditable,
  CurrentStage,
  EtapaEmbudo,
  MetodoPago,
  MotivoPerdida,
  Resultado,
  Urgencia,
} from "@/types/domain";
import type { LeadSession, Procedencia, UUID } from "@/types/entities";
import { etapaDeResolucion, motivoDeResolucion } from "./lead-session.repo";
import type {
  CierreSesion,
  CloseInput,
  LeadSessionInsert,
  LeadSessionRepository,
  LeadSessionUpdate,
  MarcasProcedencia,
  ResolucionSesion,
} from "./lead-session.repo";

type LeadSessionDbUpdate = Database["public"]["Tables"]["lead_session"]["Update"];

// Mismo tope que `SESSION_IDS_POR_TANDA` de mensajes y por el mismo motivo:
// 100 uuids son ~3,7 KB de query string, que entra holgado en cualquier proxy.
const IDS_POR_TANDA = 100;

/**
 * PostgREST corta en 1.000 filas y no avisa (AGENTS.md, lección 12). Las
 * lecturas que recorren sesiones sin tope natural —las de los disparadores
 * programado y de inactividad, y la purga— van en páginas de este tamaño.
 */
const FILAS_POR_PAGINA = 1000;

/**
 * Lee todas las filas de una consulta, página por página, por keyset sobre
 * `id`: cada página pide `id > último id visto`, ordenado por `id`. A
 * diferencia de un `offset`, una sesión que se cierra o se crea entre dos
 * páginas no hace saltear ni repetir otras. Corta cuando una página vuelve
 * incompleta.
 */
async function leerTodasLasPaginas<T extends { id: string }>(
  pagina: (
    despuesDeId: string | null,
  ) => PromiseLike<{ data: T[] | null; error: PostgrestErrorLike | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let despuesDeId: string | null = null;
  for (;;) {
    const { data, error } = await pagina(despuesDeId);
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    const filas = data ?? [];
    out.push(...filas);
    const ultima = filas.at(-1);
    if (filas.length < FILAS_POR_PAGINA || ultima === undefined) return out;
    despuesDeId = ultima.id;
  }
}

/**
 * Supabase impl LeadSessionRepository. Slice 1 sub-paso 7.4 repo 9.
 *
 * FK lead_id → leads.id ON DELETE CASCADE.
 *
 * UNIQUE partial: lead_session_unique_activa_idx (lead_id) WHERE resultado IS NULL
 *   → enforce máx 1 sesión activa per lead atomic.
 *
 * close idempotente: SELECT actual → match resultado/motivo → return existing
 * (replay-safe). Mismatch → IllegalStateError NonRetriable. No race-protected
 * (entre SELECT y UPDATE alguien podría cerrar); contract tolera porque
 * single-process workflow per session en práctica.
 */
export class SupabaseLeadSessionRepository implements LeadSessionRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: LeadSessionInsert): Promise<LeadSession> {
    const { data, error } = await this.db
      .from("lead_session")
      .insert({
        lead_id: input.lead_id,
        current_stage: input.current_stage,
        // Una sesión que nace ya en una etapa avanzada la alcanzó igual.
        etapa_alcanzada: etapaAlcanzada("nuevo", input.current_stage),
        urgencia: input.urgencia,
        consulta: input.consulta,
        producto_cotizado_id: input.producto_cotizado_id,
        codigo_interno: input.codigo_interno,
        precio_cotizado: input.precio_cotizado,
        cantidad: input.cantidad,
        bloqueador: input.bloqueador,
        comprobante_pago_url: input.comprobante_pago_url,
        metodo_pago: input.metodo_pago,
        resultado: input.resultado,
        motivo_perdida: input.motivo_perdida,
        ia_pausada: input.ia_pausada,
        extras: (input.extras ?? {}) as never,
        context_summary: input.context_summary ?? null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        const msg = error.message ?? "";
        if (msg.includes("lead_session_unique_activa_idx")) {
          throw new ConflictError(
            `ya existe sesión activa para lead ${input.lead_id}`,
            "active_session_exists",
            error,
          );
        }
        throw new ConflictError(msg, "unique_violation", error);
      }
      throw mapPostgrestError(error, { resource: "lead_session" });
    }
    return mapRow(data);
  }

  async findById(id: UUID): Promise<LeadSession | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from("lead_session").select().eq("id", id).maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    return data ? mapRow(data) : null;
  }

  async findActiveByLeadId(leadId: UUID): Promise<LeadSession | null> {
    if (!isUuid(leadId)) return null;
    const { data, error } = await this.db
      .from("lead_session")
      .select()
      .eq("lead_id", leadId)
      .is("resultado", null)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    return data ? mapRow(data) : null;
  }

  async listByLeadId(leadId: UUID): Promise<LeadSession[]> {
    if (!isUuid(leadId)) return [];
    const { data, error } = await this.db
      .from("lead_session")
      .select()
      .eq("lead_id", leadId)
      .order("started_at", { ascending: false });
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    return (data ?? []).map(mapRow);
  }

  async listByIds(ids: UUID[]): Promise<LeadSession[]> {
    const limpios = ids.filter(isUuid);
    if (limpios.length === 0) return [];

    // Mismo criterio que `listBySessionIds` de mensajes: `.in()` viaja en la
    // query string, así que se parte en tandas para no pasarse del largo de URL
    // que acepta el proxy (414). Cada tanda es UNA consulta, nunca una por id.
    const out: LeadSession[] = [];
    for (let i = 0; i < limpios.length; i += IDS_POR_TANDA) {
      const { data, error } = await this.db
        .from("lead_session")
        .select()
        .in("id", limpios.slice(i, i + IDS_POR_TANDA));
      if (error) throw mapPostgrestError(error, { resource: "lead_session" });
      for (const row of data ?? []) out.push(mapRow(row));
    }
    return out.sort((a, b) => b.started_at.getTime() - a.started_at.getTime());
  }

  async editarCampoTwin(
    id: UUID,
    campo: CampoTwinEditable,
    valor: string | number | null,
    userId: UUID | null,
  ): Promise<LeadSession> {
    const actual = await this.findById(id);
    if (!actual) {
      throw new NotFoundError(`lead_session no encontrada: ${id}`, "lead_session", id);
    }

    // El merge de procedencia se hace en TypeScript y no con `jsonb_set`: son
    // ediciones de una persona sobre una ficha que mira, no escrituras
    // concurrentes, y un update entero es mas simple de auditar.
    const procedencia: Procedencia = {
      ...actual.procedencia,
      [campo]: {
        por: "humano",
        at: new Date().toISOString(),
        user_id: userId,
        mensaje_origen_id: null,
        // Lo que habia antes: es lo que el panel muestra como "el extractor
        // habia inferido «…»" debajo de un campo corregido.
        valor_anterior: valorAnterior(actual, campo),
      },
    };

    const { data, error } = await this.db
      .from("lead_session")
      .update({ [campo]: valor, procedencia } as never)
      .eq("id", id)
      .select()
      .single();
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    return mapRow(data as LeadSessionRow);
  }

  async moverEtapa(id: UUID, etapa: EtapaEmbudo, userId: UUID | null): Promise<LeadSession> {
    const actual = await this.findById(id);
    if (!actual) {
      throw new NotFoundError(`lead_session no encontrada: ${id}`, "lead_session", id);
    }
    // Pasa por `escribir` y no por un `.update()` propio para que
    // `etapa_alcanzada` la siga derivando el mismo lugar de siempre: un
    // retroceso a mano mueve `current_stage` y deja el máximo donde estaba.
    return this.escribir(id, { current_stage: etapa }, actual.etapa_alcanzada, {
      ...actual.procedencia,
      current_stage: {
        por: "humano",
        at: new Date().toISOString(),
        user_id: userId,
        mensaje_origen_id: null,
        valor_anterior: actual.current_stage,
      },
    });
  }

  async aplicarExtraccion(
    id: UUID,
    patch: LeadSessionUpdate,
    marcas: MarcasProcedencia,
  ): Promise<LeadSession> {
    const actual = await this.findById(id);
    if (!actual) {
      throw new NotFoundError(`lead_session no encontrada: ${id}`, "lead_session", id);
    }
    return this.escribir(id, patch, actual.etapa_alcanzada, {
      ...actual.procedencia,
      ...marcas,
    });
  }

  async update(id: UUID, patch: LeadSessionUpdate): Promise<LeadSession> {
    // El read previo solo hace falta para avanzar `etapa_alcanzada`, que
    // depende del valor que ya estaba. Sin cambio de etapa no hay roundtrip
    // extra: la mayoría de los updates (pausar la IA, resumen) no la tocan.
    const alcanzadaActual =
      patch.current_stage !== undefined ? (await this.requireRow(id)).etapa_alcanzada : "nuevo";
    return this.escribir(id, patch, alcanzadaActual, null);
  }

  private async requireRow(id: UUID): Promise<LeadSession> {
    const actual = await this.findById(id);
    if (!actual) {
      throw new NotFoundError(`sesión no encontrada: ${id}`, "lead_session", id);
    }
    return actual;
  }

  private async escribir(
    id: UUID,
    patch: LeadSessionUpdate,
    alcanzadaActual: EtapaEmbudo,
    procedencia: Procedencia | null,
  ): Promise<LeadSession> {
    const updatePayload: LeadSessionDbUpdate = {};
    // id, lead_id, started_at, closed_at, resultado, motivo_perdida NO mapeados
    // (defense runtime — type Update<...> los omite igualmente).
    if (patch.current_stage !== undefined) {
      updatePayload.current_stage = patch.current_stage;
      updatePayload.etapa_alcanzada = etapaAlcanzada(alcanzadaActual, patch.current_stage);
    }
    if (patch.urgencia !== undefined) updatePayload.urgencia = patch.urgencia;
    if (patch.consulta !== undefined) updatePayload.consulta = patch.consulta;
    if (patch.producto_cotizado_id !== undefined) {
      updatePayload.producto_cotizado_id = patch.producto_cotizado_id;
    }
    if (patch.codigo_interno !== undefined) updatePayload.codigo_interno = patch.codigo_interno;
    if (patch.precio_cotizado !== undefined) updatePayload.precio_cotizado = patch.precio_cotizado;
    if (patch.cantidad !== undefined) updatePayload.cantidad = patch.cantidad;
    if (patch.bloqueador !== undefined) updatePayload.bloqueador = patch.bloqueador;
    if (patch.comprobante_pago_url !== undefined) {
      updatePayload.comprobante_pago_url = patch.comprobante_pago_url;
    }
    if (patch.metodo_pago !== undefined) updatePayload.metodo_pago = patch.metodo_pago;
    if (patch.ia_pausada !== undefined) updatePayload.ia_pausada = patch.ia_pausada;
    if (patch.stage_before_handoff !== undefined) {
      updatePayload.stage_before_handoff = patch.stage_before_handoff;
    }
    if (patch.extras !== undefined) updatePayload.extras = patch.extras as never;
    if (patch.context_summary !== undefined) {
      updatePayload.context_summary = patch.context_summary;
    }
    if (procedencia !== null) updatePayload.procedencia = procedencia as never;

    const { data, error } = await this.db
      .from("lead_session")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    if (data === null) {
      throw new NotFoundError(`sesión no encontrada: ${id}`, "lead_session", id);
    }
    return mapRow(data);
  }

  async close(id: UUID, input: CloseInput): Promise<LeadSession> {
    const current = await this.findById(id);
    if (!current) {
      throw new NotFoundError(`sesión no encontrada: ${id}`, "lead_session", id);
    }
    if (current.resultado !== null) {
      const requestedMotivo = input.motivo_perdida ?? null;
      if (current.resultado === input.resultado && current.motivo_perdida === requestedMotivo) {
        return current;
      }
      throw new IllegalStateError(
        `sesión ya cerrada con resultado distinto (current=${current.resultado}/${current.motivo_perdida ?? "null"}, requested=${input.resultado}/${requestedMotivo ?? "null"})`,
        "session_already_closed_different",
      );
    }

    const closedAt = await serverNowIso(this.db);
    const { data, error } = await this.db
      .from("lead_session")
      .update({
        resultado: input.resultado,
        motivo_perdida: input.motivo_perdida ?? null,
        closed_at: closedAt,
      })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    if (data === null) {
      throw new NotFoundError(`sesión no encontrada: ${id}`, "lead_session", id);
    }
    return mapRow(data);
  }

  async resolver(id: UUID, cierre: ResolucionSesion, userId: UUID | null): Promise<LeadSession> {
    const current = await this.findById(id);
    if (!current) {
      throw new NotFoundError(`sesión no encontrada: ${id}`, "lead_session", id);
    }
    const motivo = motivoDeResolucion(cierre);
    if (current.resultado !== null) {
      if (current.resultado === cierre.resultado && current.motivo_perdida === motivo) {
        return current;
      }
      throw new IllegalStateError(
        `sesión ya cerrada con resultado distinto (current=${current.resultado}/${current.motivo_perdida ?? "null"}, requested=${cierre.resultado}/${motivo ?? "null"})`,
        "session_already_closed_different",
      );
    }

    const procedencia: Procedencia = {
      ...current.procedencia,
      current_stage: {
        por: "humano",
        at: new Date().toISOString(),
        user_id: userId,
        mensaje_origen_id: null,
        valor_anterior: current.current_stage,
      },
    };

    const etapa = etapaDeResolucion(cierre);
    const closedAt = await serverNowIso(this.db);
    const { data, error } = await this.db
      .from("lead_session")
      .update({
        current_stage: etapa,
        // `cerrado` arrastra el máximo hasta el paso 6; `perdido` es un desvío
        // sin posición y lo deja congelado donde la conversación llegó antes de
        // caerse. Las dos reglas salen de la misma función que usa `update`.
        etapa_alcanzada: etapaAlcanzada(current.etapa_alcanzada, etapa),
        resultado: cierre.resultado,
        motivo_perdida: motivo,
        closed_at: closedAt,
        procedencia: procedencia as never,
      })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    if (data === null) {
      throw new NotFoundError(`sesión no encontrada: ${id}`, "lead_session", id);
    }
    return mapRow(data);
  }

  async listCierres(): Promise<CierreSesion[]> {
    // Paginado: con más de 1.000 sesiones cerradas, PostgREST devolvía las
    // 1.000 más nuevas y los leads con cierres más viejos figuraban sin
    // resultado en la lista de Leads.
    const filas = await leerTodasLasPaginas((despuesDeId) => {
      let q = this.db
        .from("lead_session")
        .select("id, lead_id, resultado, motivo_perdida, closed_at")
        .not("resultado", "is", null)
        .not("closed_at", "is", null);
      if (despuesDeId !== null) q = q.gt("id", despuesDeId);
      return q.order("id", { ascending: true }).limit(FILAS_POR_PAGINA);
    });
    // Las páginas vienen por id; el contrato es del cierre más nuevo al más
    // viejo, que es de lo que depende "el primero de cada lead es el último".
    // Se compara la fecha y no el string: el texto de un timestamptz no ordena
    // bien cuando cambia la cantidad de decimales de los segundos.
    const ms = (iso: string | null) => (iso === null ? 0 : new Date(iso).getTime());
    filas.sort(
      (a, b) => ms(b.closed_at) - ms(a.closed_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

    const out: CierreSesion[] = [];
    for (const row of filas) {
      // `resultado`/`closed_at` no pueden ser null acá por el filtro, pero el
      // tipo generado no lo sabe: se descartan en vez de castear.
      if (row.resultado === null || row.closed_at === null) continue;
      out.push({
        lead_id: row.lead_id,
        resultado: row.resultado,
        motivo_perdida: row.motivo_perdida,
        closed_at: new Date(row.closed_at),
      });
    }
    return out;
  }

  async listLeadIdsByCodigo(q: string): Promise<UUID[]> {
    if (q === "") return [];
    // Un código popular aparece en más de 1.000 sesiones: sin paginar, la
    // búsqueda de Leads perdía en silencio a quien lo cotizó.
    const filas = await leerTodasLasPaginas((despuesDeId) => {
      let consulta = this.db
        .from("lead_session")
        .select("id, lead_id")
        .ilike("codigo_interno", `%${escaparLike(q)}%`);
      if (despuesDeId !== null) consulta = consulta.gt("id", despuesDeId);
      return consulta.order("id", { ascending: true }).limit(FILAS_POR_PAGINA);
    });
    return Array.from(new Set(filas.map((r) => r.lead_id)));
  }

  async listClosedBefore(date: Date): Promise<LeadSession[]> {
    const filas = await leerTodasLasPaginas((despuesDeId) => {
      let q = this.db
        .from("lead_session")
        .select()
        .lt("closed_at", date.toISOString())
        .not("closed_at", "is", null);
      if (despuesDeId !== null) q = q.gt("id", despuesDeId);
      return q.order("id", { ascending: true }).limit(FILAS_POR_PAGINA);
    });
    return filas.map(mapRow);
  }

  async listActive(): Promise<LeadSession[]> {
    const filas = await leerTodasLasPaginas((despuesDeId) => {
      let q = this.db.from("lead_session").select().is("resultado", null);
      if (despuesDeId !== null) q = q.gt("id", despuesDeId);
      return q.order("id", { ascending: true }).limit(FILAS_POR_PAGINA);
    });
    // Las páginas vienen por id; el contrato de la bandeja es de la más nueva a
    // la más vieja.
    return filas
      .map(mapRow)
      .sort(
        (a, b) =>
          b.started_at.getTime() - a.started_at.getTime() ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
  }

  async delete(id: UUID): Promise<void> {
    // Id inexistente = 0 rows sin error → no-op replay-safe. isUuid evita
    // roundtrip con ids no-uuid (mismo early-return que findById).
    if (!isUuid(id)) return;
    const { error } = await this.db.from("lead_session").delete().eq("id", id);
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
  }

  async reassignLead(fromLeadId: UUID, toLeadId: UUID): Promise<number> {
    const { data, error } = await this.db
      .from("lead_session")
      .update({ lead_id: toLeadId })
      .eq("lead_id", fromLeadId)
      .select();
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    return (data ?? []).length;
  }

  async asignarVendedor(id: UUID, vendedorId: UUID | null): Promise<LeadSession> {
    // Un id que no es UUID revienta en Postgres con 22P02, que
    // `mapPostgrestError` clasifica como InfraError —reintentable—: un workflow
    // reintentaría hasta agotarse. Se corta antes, como error de entrada.
    if (vendedorId !== null && !isUuid(vendedorId)) {
      throw new ValidationError(`vendedor_id no es un UUID: ${vendedorId}`, "vendedor_id_invalido");
    }
    const actual = await this.requireRow(id);
    if ((actual.vendedor_asignado_id ?? null) === vendedorId) return actual;

    // `asignado_at` no viaja: la sella el trigger `lead_session_sellar_asignacion`
    // con la hora de la base, e ignoraría cualquier valor mandado desde acá.
    const { data, error } = await this.db
      .from("lead_session")
      .update({ vendedor_asignado_id: vendedorId })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    if (data === null) {
      // La purga pudo llevársela entre la lectura y la escritura.
      throw new NotFoundError(`sesión no encontrada: ${id}`, "lead_session", id);
    }
    return mapRow(data);
  }

  async resumenAsignaciones(vendedorIds: UUID[]): Promise<HistorialVendedor[]> {
    // Un id que no es UUID no puede tener sesiones y rompería el cast a uuid[].
    const ids = Array.from(new Set(vendedorIds.filter(isUuid)));
    const out: HistorialVendedor[] = [];
    // La RPC devuelve a lo sumo una fila por id pedido: en tandas de
    // IDS_POR_TANDA el corte de 1.000 filas de PostgREST no se puede alcanzar.
    for (let i = 0; i < ids.length; i += IDS_POR_TANDA) {
      const { data, error } = await this.db.rpc("resumen_asignaciones_vendedores", {
        p_vendedor_ids: ids.slice(i, i + IDS_POR_TANDA),
      });
      if (error) throw mapPostgrestError(error, { resource: "lead_session" });
      for (const row of data ?? []) {
        out.push({
          vendedorId: row.vendedor_id,
          ultimaAsignacionAt: new Date(row.ultima_asignacion_at),
          sesionesAbiertas: row.sesiones_abiertas,
        });
      }
    }
    return out;
  }
}

interface LeadSessionRow {
  id: string;
  lead_id: string;
  current_stage: CurrentStage;
  /**
   * Del enum completo, como la devuelve Postgres: `current_stage_enum` tiene
   * las 8 y lo que deja en la columna solo las 6 del embudo es un CHECK, que
   * el tipo generado no refleja. Se estrecha en `mapRow`, no acá.
   */
  etapa_alcanzada: CurrentStage;
  urgencia: Urgencia;
  consulta: string;
  producto_cotizado_id: string | null;
  codigo_interno: string | null;
  precio_cotizado: number | null;
  cantidad: number | null;
  bloqueador: string | null;
  comprobante_pago_url: string | null;
  metodo_pago: MetodoPago | null;
  resultado: Resultado | null;
  motivo_perdida: MotivoPerdida | null;
  ia_pausada: boolean;
  stage_before_handoff: CurrentStage | null;
  vendedor_asignado_id: string | null;
  asignado_at: string | null;
  extras: unknown;
  context_summary: string | null;
  procedencia: unknown;
  started_at: string;
  updated_at: string;
  closed_at: string | null;
}

function mapRow(row: LeadSessionRow): LeadSession {
  const extras = (row.extras ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    lead_id: row.lead_id,
    current_stage: row.current_stage,
    etapa_alcanzada: etapaAlcanzadaDeFila(row.etapa_alcanzada),
    urgencia: row.urgencia,
    consulta: row.consulta,
    producto_cotizado_id: row.producto_cotizado_id,
    codigo_interno: row.codigo_interno,
    precio_cotizado: row.precio_cotizado,
    cantidad: row.cantidad,
    bloqueador: row.bloqueador,
    comprobante_pago_url: row.comprobante_pago_url,
    metodo_pago: row.metodo_pago,
    resultado: row.resultado,
    motivo_perdida: row.motivo_perdida,
    ia_pausada: row.ia_pausada,
    stage_before_handoff: row.stage_before_handoff,
    vendedor_asignado_id: row.vendedor_asignado_id,
    asignado_at: row.asignado_at ? new Date(row.asignado_at) : null,
    extras: structuredClone(extras),
    context_summary: row.context_summary,
    procedencia: (row.procedencia ?? {}) as Procedencia,
    started_at: new Date(row.started_at),
    updated_at: new Date(row.updated_at),
    closed_at: row.closed_at ? new Date(row.closed_at) : null,
  };
}

/**
 * Estrecha `etapa_alcanzada` a una etapa del embudo.
 *
 * `lead_session_etapa_alcanzada_es_del_embudo` hace imposible que la columna
 * guarde un desvío, así que el `else` no ocurre contra una base migrada. Se
 * degrada a `"nuevo"` en vez de romper la lectura entera: es el mismo valor con
 * el que el backfill de 20260810150000 marca "no se sabe por dónde pasó", y una
 * ficha con el rail en cero es preferible a un panel que no abre.
 */
function etapaAlcanzadaDeFila(stage: CurrentStage): EtapaEmbudo {
  return esEtapaEmbudo(stage) ? stage : "nuevo";
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
