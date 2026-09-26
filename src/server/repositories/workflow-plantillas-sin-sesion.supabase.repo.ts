import { NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { Database } from "@/server/db/types.gen";
import type { UUID } from "@/types/entities";
import {
  CUENTAN_PARA_TOPE,
  avanzaEstado,
  estadosQueAvanzanAPlantilla,
  type EstadoMetaPlantilla,
  type EstadoPlantillaSinSesion,
  type PlantillaSinSesion,
  type ReservaPlantillaSinSesion,
  type WorkflowPlantillasSinSesionRepository,
} from "./workflow-plantillas-sin-sesion.repo";

type Row = Database["public"]["Tables"]["workflow_plantillas_sin_sesion"]["Row"];

const TABLA = "workflow_plantillas_sin_sesion";
const COLS =
  "id, idempotency_key, workflow_run_id, lead_id, conversacion_id, plantilla_nombre, " +
  "plantilla_idioma, contenido, parametros_cuerpo, intento_at, meta_message_id, estado, " +
  "estado_at, error_codigo, error_detalle, mensaje_id";

function mapRow(r: Row): PlantillaSinSesion {
  return {
    id: r.id,
    idempotency_key: r.idempotency_key,
    workflow_run_id: r.workflow_run_id,
    lead_id: r.lead_id,
    conversacion_id: r.conversacion_id,
    plantilla_nombre: r.plantilla_nombre,
    plantilla_idioma: r.plantilla_idioma,
    contenido: r.contenido,
    parametros_cuerpo: Array.isArray(r.parametros_cuerpo)
      ? r.parametros_cuerpo.filter((v): v is string => typeof v === "string")
      : [],
    intento_at: new Date(r.intento_at),
    meta_message_id: r.meta_message_id,
    estado: r.estado as EstadoPlantillaSinSesion,
    estado_at: r.estado_at === null ? null : new Date(r.estado_at),
    error_codigo: r.error_codigo,
    error_detalle: r.error_detalle,
    mensaje_id: r.mensaje_id,
  };
}

/**
 * Supabase impl. Escribe sólo el service-role (la tabla no tiene policy de
 * escritura). La reserva descansa en el UNIQUE de `idempotency_key`: un
 * segundo INSERT con la misma clave vuelve como 23505 → `ConflictError`.
 */
export class SupabaseWorkflowPlantillasSinSesionRepository implements WorkflowPlantillasSinSesionRepository {
  constructor(private readonly db: AppClient) {}

  async findByIdempotencyKey(clave: string): Promise<PlantillaSinSesion | null> {
    const { data, error } = await this.db
      .from(TABLA)
      .select(COLS)
      .eq("idempotency_key", clave)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: TABLA });
    return data ? mapRow(data as unknown as Row) : null;
  }

  async reservar(input: ReservaPlantillaSinSesion): Promise<PlantillaSinSesion> {
    const { data, error } = await this.db
      .from(TABLA)
      .insert({
        idempotency_key: input.idempotency_key,
        workflow_run_id: input.workflow_run_id,
        lead_id: input.lead_id,
        conversacion_id: input.conversacion_id,
        plantilla_nombre: input.plantilla_nombre,
        plantilla_idioma: input.plantilla_idioma,
        contenido: input.contenido,
        parametros_cuerpo: [...input.parametros_cuerpo],
        intento_at: input.intento_at.toISOString(),
      })
      .select(COLS)
      .single();
    if (error) throw mapPostgrestError(error, { resource: TABLA });
    return mapRow(data as unknown as Row);
  }

  async marcarAceptado(id: UUID, wamid: string): Promise<PlantillaSinSesion> {
    const { data, error } = await this.db
      .from(TABLA)
      .update({ meta_message_id: wamid, estado: "aceptado" })
      .eq("id", id)
      .eq("estado", "reservado")
      .select(COLS)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: TABLA });
    if (data) return mapRow(data as unknown as Row);
    // Ya no estaba reservada: un reintento después de anotar. Se relee.
    const { data: actual, error: e2 } = await this.db
      .from(TABLA)
      .select(COLS)
      .eq("id", id)
      .maybeSingle();
    if (e2) throw mapPostgrestError(e2, { resource: TABLA });
    if (!actual)
      throw new NotFoundError(`plantilla sin sesión no encontrada: ${id}`, "plantilla", id);
    return mapRow(actual as unknown as Row);
  }

  async marcarFallido(id: UUID, e: { codigo: string; detalle: string | null }): Promise<void> {
    const { error } = await this.db
      .from(TABLA)
      .update({ estado: "fallido", error_codigo: e.codigo, error_detalle: e.detalle })
      .eq("id", id);
    if (error) throw mapPostgrestError(error, { resource: TABLA });
  }

  async liberarReserva(id: UUID): Promise<void> {
    const { error } = await this.db
      .from(TABLA)
      .delete()
      .eq("id", id)
      .eq("estado", "reservado")
      .is("meta_message_id", null);
    if (error) throw mapPostgrestError(error, { resource: TABLA });
  }

  async aplicarEstadoMeta(
    wamid: string,
    estado: EstadoMetaPlantilla,
    at: Date,
    e?: { codigo: string | null; detalle: string | null },
  ): Promise<boolean> {
    const { data, error } = await this.db
      .from(TABLA)
      .select("id, estado")
      .eq("meta_message_id", wamid)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: TABLA });
    if (!data) return false;
    const actual = data.estado as EstadoPlantillaSinSesion;
    if (!avanzaEstado(actual, estado)) return true;
    const { error: e2 } = await this.db
      .from(TABLA)
      .update({
        estado,
        estado_at: at.toISOString(),
        ...(estado === "fallido"
          ? { error_codigo: e?.codigo ?? null, error_detalle: e?.detalle ?? null }
          : {}),
      })
      .eq("id", data.id)
      // La guarda va en el WHERE: dos webhooks casi simultáneos no retroceden
      // el estado y el que avanza más no se pierde aunque escriba segundo.
      .in("estado", estadosQueAvanzanAPlantilla(estado));
    if (e2) throw mapPostgrestError(e2, { resource: TABLA });
    return true;
  }

  async contarNoAnotadasDesde(leadId: UUID, desde: Date): Promise<number> {
    const { count, error } = await this.db
      .from(TABLA)
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId)
      .is("mensaje_id", null)
      .in("estado", [...CUENTAN_PARA_TOPE])
      .gte("intento_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: TABLA });
    return count ?? 0;
  }

  async pendientesDeAnotar(
    leadId: UUID,
    desde: Date,
    limite: number,
  ): Promise<PlantillaSinSesion[]> {
    const { data, error } = await this.db
      .from(TABLA)
      .select(COLS)
      .eq("lead_id", leadId)
      .is("mensaje_id", null)
      .not("meta_message_id", "is", null)
      .neq("estado", "fallido")
      .gte("intento_at", desde.toISOString())
      .order("intento_at", { ascending: false })
      .range(0, limite - 1);
    if (error) throw mapPostgrestError(error, { resource: TABLA });
    return (data ?? []).map((r) => mapRow(r as unknown as Row)).reverse();
  }

  async marcarAnotada(id: UUID, mensajeId: UUID): Promise<void> {
    const { error } = await this.db.from(TABLA).update({ mensaje_id: mensajeId }).eq("id", id);
    if (error) throw mapPostgrestError(error, { resource: TABLA });
  }
}
