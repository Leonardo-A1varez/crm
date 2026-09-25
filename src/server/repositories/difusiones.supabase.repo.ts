import { NotFoundError, PermissionDeniedError } from "@/lib/errors";
import type { Difusion, EstadoDifusion } from "@/lib/difusion/modelo";
import { ParametrosPlantillaSchema } from "@/lib/difusion/parametros";
import type { Grupo } from "@/lib/ui/condiciones";
import { validarAudiencia } from "@/lib/validation/difusion.schema";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { Database, Json } from "@/server/db/types.gen";
import { isUuid } from "@/server/db/uuid";
import type { UUID } from "@/types/entities";
import { exigirPagina } from "./_paginacion";
import {
  ESTADOS_CON_COLA,
  patchDefinido,
  type DifusionInsert,
  type DifusionUpdate,
  type DifusionesRepository,
} from "./difusiones.repo";

type Row = Database["public"]["Tables"]["difusiones"]["Row"];
type DbUpdate = Database["public"]["Tables"]["difusiones"]["Update"];

/**
 * Supabase impl de `DifusionesRepository`.
 *
 * Las reglas de coherencia (programada con fecha, detenida con motivo…) las
 * hacen cumplir los CHECK de la tabla, y `mapPostgrestError` las devuelve como
 * `ValidationError` (23514). El borrado sólo de borradores es un trigger con el
 * mismo código. Acá sólo se valida lo que la base no puede: la forma completa
 * del árbol de la audiencia.
 */
export class SupabaseDifusionesRepository implements DifusionesRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: DifusionInsert): Promise<Difusion> {
    const audiencia = validarAudiencia(input.audiencia);
    const { data, error } = await this.db
      .from("difusiones")
      .insert({
        nombre: input.nombre,
        audiencia: audiencia as unknown as Json,
        creada_por: input.creada_por,
        // `undefined` no viaja en el JSON: la columna toma su default seguro.
        audiencia_toda_la_base: input.audiencia_toda_la_base,
        audiencia_modo: input.audiencia_modo,
        plantilla_nombre: input.plantilla_nombre ?? null,
        plantilla_categoria: input.plantilla_categoria ?? null,
        plantilla_idioma: input.plantilla_idioma ?? null,
        plantilla_parametros: (input.plantilla_parametros ?? []) as unknown as Json,
        incluir_en_negociacion: input.incluir_en_negociacion,
        exenta_tope_frecuencia: input.exenta_tope_frecuencia,
        canary_tamano: input.canary_tamano ?? null,
      })
      .select()
      .single();

    if (error) throw mapPostgrestError(error, { resource: "difusion" });
    return mapRow(data);
  }

  async findById(id: UUID): Promise<Difusion | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from("difusiones").select().eq("id", id).maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "difusion" });
    return data ? mapRow(data) : null;
  }

  async list({ limite }: { limite: number }): Promise<Difusion[]> {
    exigirPagina(limite);
    const { data, error } = await this.db
      .from("difusiones")
      .select()
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(0, limite - 1);
    if (error) throw mapPostgrestError(error, { resource: "difusion" });
    return (data ?? []).map(mapRow);
  }

  async update(id: UUID, patch: DifusionUpdate): Promise<Difusion> {
    if (!isUuid(id)) throw new NotFoundError(`difusión no encontrada: ${id}`, "difusion", id);
    const payload = aUpdate(patchDefinido(patch));

    const { data, error } = await this.db
      .from("difusiones")
      .update(payload)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw mapPostgrestError(error, { resource: "difusion" });
    if (data === null) throw new NotFoundError(`difusión no encontrada: ${id}`, "difusion", id);
    return mapRow(data);
  }

  async actualizarSiEstado(
    id: UUID,
    desde: readonly EstadoDifusion[],
    patch: DifusionUpdate,
  ): Promise<Difusion | null> {
    if (!isUuid(id)) throw new NotFoundError(`difusión no encontrada: ${id}`, "difusion", id);
    const { data, error } = await this.db
      .from("difusiones")
      .update(aUpdate(patchDefinido(patch)))
      .eq("id", id)
      .in("estado", [...desde])
      .select()
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "difusion" });
    if (data !== null) return mapRow(data);
    // No se movió: o no existe, o ya no está en ninguno de `desde`.
    if (!(await this.findById(id))) {
      throw new NotFoundError(`difusión no encontrada: ${id}`, "difusion", id);
    }
    return null;
  }

  async listarConCola(): Promise<Difusion[]> {
    // Se drenan de a una, así que son pocas; el rango explícito es para no
    // depender del corte de PostgREST.
    const { data, error } = await this.db
      .from("difusiones")
      .select()
      .in("estado", [...ESTADOS_CON_COLA])
      .order("programada_para", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(0, 99);
    if (error) throw mapPostgrestError(error, { resource: "difusion" });
    return (data ?? []).map(mapRow);
  }

  async delete(id: UUID): Promise<void> {
    if (!isUuid(id)) return;
    const { error } = await this.db.from("difusiones").delete().eq("id", id);
    if (error) throw mapPostgrestError(error, { resource: "difusion" });

    // RLS no da error cuando filtra un DELETE: devuelve cero filas. Si la
    // difusión sigue visible, no fue un no-op inocente sino un permiso negado.
    if (await this.findById(id)) {
      throw new PermissionDeniedError(`delete de difusión denegado por RLS: ${id}`);
    }
  }
}

function aUpdate(patch: DifusionUpdate): DbUpdate {
  const payload: DbUpdate = {};
  if (patch.nombre !== undefined) payload.nombre = patch.nombre;
  if (patch.estado !== undefined) payload.estado = patch.estado;
  if (patch.audiencia !== undefined) {
    payload.audiencia = validarAudiencia(patch.audiencia) as unknown as Json;
  }
  if (patch.audiencia_toda_la_base !== undefined) {
    payload.audiencia_toda_la_base = patch.audiencia_toda_la_base;
  }
  if (patch.audiencia_modo !== undefined) payload.audiencia_modo = patch.audiencia_modo;
  if (patch.plantilla_nombre !== undefined) payload.plantilla_nombre = patch.plantilla_nombre;
  if (patch.plantilla_categoria !== undefined)
    payload.plantilla_categoria = patch.plantilla_categoria;
  if (patch.plantilla_idioma !== undefined) payload.plantilla_idioma = patch.plantilla_idioma;
  if (patch.plantilla_parametros !== undefined) {
    payload.plantilla_parametros = ParametrosPlantillaSchema.parse(
      patch.plantilla_parametros,
    ) as unknown as Json;
  }
  if (patch.incluir_en_negociacion !== undefined) {
    payload.incluir_en_negociacion = patch.incluir_en_negociacion;
  }
  if (patch.exenta_tope_frecuencia !== undefined) {
    payload.exenta_tope_frecuencia = patch.exenta_tope_frecuencia;
  }
  if (patch.canary_tamano !== undefined) payload.canary_tamano = patch.canary_tamano;
  if (patch.canary_revisado_at !== undefined) {
    payload.canary_revisado_at = iso(patch.canary_revisado_at);
  }
  if (patch.programada_para !== undefined) payload.programada_para = iso(patch.programada_para);
  if (patch.iniciada_at !== undefined) payload.iniciada_at = iso(patch.iniciada_at);
  if (patch.finalizada_at !== undefined) payload.finalizada_at = iso(patch.finalizada_at);
  if (patch.detenida_por !== undefined) payload.detenida_por = patch.detenida_por;
  if (patch.motivo_detencion !== undefined) payload.motivo_detencion = patch.motivo_detencion;
  if (patch.motivo_revision !== undefined) payload.motivo_revision = patch.motivo_revision;
  return payload;
}

function iso(d: Date | null): string | null {
  return d === null ? null : d.toISOString();
}

function fecha(s: string | null): Date | null {
  return s === null ? null : new Date(s);
}

/**
 * `audiencia` se castea sin volver a validar: se validó al escribir y la base
 * ata la raíz. Quien la resuelva para mandar tiene que pasarla por
 * `validarAudiencia` igual: una fila escrita a mano no pasó por acá.
 */
function mapRow(r: Row): Difusion {
  return {
    id: r.id,
    nombre: r.nombre,
    estado: r.estado,
    audiencia: r.audiencia as unknown as Grupo,
    audiencia_toda_la_base: r.audiencia_toda_la_base,
    audiencia_modo: r.audiencia_modo,
    plantilla_nombre: r.plantilla_nombre,
    plantilla_categoria: r.plantilla_categoria,
    plantilla_idioma: r.plantilla_idioma,
    // Una fila escrita a mano con otra forma no manda variables inventadas: se
    // lee vacía, y la plantilla sale sin parámetros o Meta la rechaza.
    plantilla_parametros: parametrosDe(r.plantilla_parametros),
    incluir_en_negociacion: r.incluir_en_negociacion,
    exenta_tope_frecuencia: r.exenta_tope_frecuencia,
    canary_tamano: r.canary_tamano,
    canary_revisado_at: fecha(r.canary_revisado_at),
    programada_para: fecha(r.programada_para),
    iniciada_at: fecha(r.iniciada_at),
    finalizada_at: fecha(r.finalizada_at),
    detenida_por: r.detenida_por,
    motivo_detencion: r.motivo_detencion,
    motivo_revision: r.motivo_revision,
    creada_por: r.creada_por,
    created_at: new Date(r.created_at),
    updated_at: new Date(r.updated_at),
  };
}

function parametrosDe(v: Json): Difusion["plantilla_parametros"] {
  const r = ParametrosPlantillaSchema.safeParse(v);
  return r.success ? r.data : [];
}
