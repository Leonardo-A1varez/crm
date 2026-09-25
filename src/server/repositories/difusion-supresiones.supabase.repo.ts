import { NotFoundError } from "@/lib/errors";
import type { SupresionDifusion, SupresionEncontrada } from "@/lib/difusion/modelo";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError, type PostgrestErrorLike } from "@/server/db/postgrest-errors";
import type { Database } from "@/server/db/types.gen";
import { isUuid } from "@/server/db/uuid";
import type { UUID } from "@/types/entities";
import { exigirPagina } from "./_paginacion";
import { hasherBajasDesdeEnv } from "./difusion-supresiones.hash";
import {
  exigirDetalleDeBaja,
  hashesDeBusqueda,
  resolverHasher,
  type DifusionSupresionesRepository,
  type FuenteHasherBajas,
  type SupresionInsert,
} from "./difusion-supresiones.repo";

type Row = Database["public"]["Tables"]["difusion_supresiones"]["Row"];

/**
 * Hashes por llamada a `difusion_supresiones_activas()`. La RPC rechaza más de
 * 1.000 (el corte de filas de PostgREST): con una baja activa por hash, cada
 * lote devuelve a lo sumo tantas filas como hashes. Viajan en el cuerpo del
 * POST, no en la URL: 64 caracteres cada uno no entran en un `in.(…)` largo.
 */
const LOTE_HASHES = 500;

const RECURSO = { resource: "difusion_supresion" } as const;

/**
 * Supabase impl de `DifusionSupresionesRepository`.
 *
 * El teléfono no llega a la base: se guarda su HMAC (`telefono_hash`) con la
 * versión de la clave (`clave_version`), calculado acá. Sin claves
 * configuradas, registrar y buscar lanzan `IllegalStateError`; listar, contar
 * y reactivar no las necesitan y siguen andando.
 *
 * La irreversibilidad no depende de este archivo: aunque alguien escribiera un
 * `update` o un `delete` con el service-role, el trigger lo rechaza (42501 →
 * `PermissionDeniedError`). `reactivar` pasa por la RPC
 * `reactivar_supresion_difusion()`, que toma a la persona de `auth.uid()`: con
 * el service-role no hay persona y la base lo rechaza. Para reactivar hace falta
 * el cliente autenticado de un admin.
 */
export class SupabaseDifusionSupresionesRepository implements DifusionSupresionesRepository {
  constructor(
    private readonly db: AppClient,
    private readonly hasher: FuenteHasherBajas = hasherBajasDesdeEnv,
  ) {}

  async registrar(input: SupresionInsert): Promise<SupresionDifusion> {
    const hasher = resolverHasher(this.hasher);
    const alta = hasher.alta(input.telefono);
    const detalle = exigirDetalleDeBaja(input.detalle);

    // Con cualquier versión de la clave: una baja escrita antes de rotar es la
    // misma baja, y no se duplica.
    const [previa] = await this.activasPorTelefonos([input.telefono]);
    if (previa) return sinTelefono(previa);

    const { data, error } = await this.db
      .from("difusion_supresiones")
      .insert({
        telefono_hash: alta.telefono_hash,
        clave_version: alta.clave_version,
        origen: input.origen,
        detalle,
        lead_id: input.lead_id ?? null,
        difusion_id: input.difusion_id ?? null,
        registrada_por: input.registrada_por ?? null,
      })
      .select()
      .single();

    if (!error) return mapRow(data);
    // 23505 = otra escritura concurrente ganó (índice único parcial por hash).
    // La primera manda; volver a darse de baja no es un error.
    if (error.code === "23505") {
      const [activa] = await this.activasPorTelefonos([input.telefono]);
      if (activa) return sinTelefono(activa);
    }
    throw errorSinDatos(error);
  }

  async activasPorTelefonos(telefonos: readonly string[]): Promise<SupresionEncontrada[]> {
    const porHash = hashesDeBusqueda(resolverHasher(this.hasher), telefonos);
    const hashes = [...porHash.keys()];
    const activas: SupresionEncontrada[] = [];
    for (let i = 0; i < hashes.length; i += LOTE_HASHES) {
      const { data, error } = await this.db.rpc("difusion_supresiones_activas", {
        p_hashes: hashes.slice(i, i + LOTE_HASHES),
      });
      if (error) throw errorSinDatos(error);
      for (const r of data ?? []) {
        const telefono = porHash.get(r.telefono_hash);
        if (telefono !== undefined) activas.push({ ...mapRow(r), telefono });
      }
    }
    return activas.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  }

  async listar({
    limite,
    desde = 0,
  }: {
    limite: number;
    desde?: number;
  }): Promise<SupresionDifusion[]> {
    exigirPagina(limite, desde);
    const { data, error } = await this.db
      .from("difusion_supresiones")
      .select()
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(desde, desde + limite - 1);
    if (error) throw errorSinDatos(error);
    return (data ?? []).map(mapRow);
  }

  async contarActivas(): Promise<number> {
    const { count, error } = await this.db
      .from("difusion_supresiones")
      .select("id", { count: "exact", head: true })
      .is("reactivada_at", null);
    if (error) throw errorSinDatos(error);
    return count ?? 0;
  }

  async reactivar(id: UUID, motivo: string): Promise<SupresionDifusion> {
    // Un id que no es UUID haría fallar el cast en Postgres (22P02), que
    // `mapPostgrestError` trataría como falla de infraestructura reintentable.
    if (!isUuid(id)) {
      throw new NotFoundError(`no hay una baja activa con id ${id}`, "difusion_supresion", id);
    }
    const { data, error } = await this.db.rpc("reactivar_supresion_difusion", {
      p_supresion_id: id,
      p_motivo: motivo,
    });
    // 23514 motivo → ValidationError · P0002 → NotFoundError · 42501 → PermissionDeniedError.
    if (error) throw errorSinDatos(error);
    return mapRow(data);
  }
}

/**
 * El error sin `details` ni `hint`, y sin el error original como `cause`.
 * Postgres pone la clave que violó un índice en `details` ("Key
 * (telefono_hash)=(…) already exists"): sin esto, el hash terminaría en el
 * mensaje de un `ConflictError`, en un log y en Sentry. El código y el mensaje
 * alcanzan para decidir qué hacer.
 */
function errorSinDatos(error: PostgrestErrorLike) {
  // `mapPostgrestError` guarda como `cause` el error que recibe: el saneado.
  return mapPostgrestError(
    { code: error.code, message: error.message, details: null, hint: null },
    RECURSO,
  );
}

function sinTelefono(s: SupresionEncontrada): SupresionDifusion {
  const { telefono: _telefono, ...resto } = s;
  return resto;
}

function fecha(s: string | null): Date | null {
  return s === null ? null : new Date(s);
}

/** La fila sin el hash: ni el hash ni el teléfono salen de este repo. */
function mapRow(r: Row): SupresionDifusion {
  return {
    id: r.id,
    clave_version: r.clave_version,
    origen: r.origen,
    detalle: r.detalle,
    lead_id: r.lead_id,
    difusion_id: r.difusion_id,
    registrada_por: r.registrada_por,
    created_at: new Date(r.created_at),
    reactivada_at: fecha(r.reactivada_at),
    reactivada_por: r.reactivada_por,
    reactivacion_motivo: r.reactivacion_motivo,
  };
}
