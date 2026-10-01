import { InfraError, NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { isUuid } from "@/server/db/uuid";
import {
  ESTADOS_BORRADOR,
  ESTADOS_VIGENTES,
  ORIGENES_BORRADOR,
  VIAS_USO_BORRADOR,
  type BorradorIa,
  type EstadoBorrador,
  type OrigenBorrador,
  type ViaUsoBorrador,
} from "@/types/copiloto";
import type { UUID } from "@/types/entities";
import {
  validarCodigoError,
  validarOrigen,
  validarVia,
  type BorradoresIaRepository,
  type CompletarBorradorInput,
  type IniciarBorradorInput,
  type MarcarUsadoInput,
  type ResultadoIniciar,
  type ResultadoMarcarUsado,
} from "./borradores-ia.repo";

const TABLA = "borradores_ia";
/** Mismo criterio que `IDS_POR_TANDA` de conversaciones: 100 uuids caben en cualquier proxy. */
const IDS_POR_TANDA = 100;

interface Row {
  id: string;
  conversacion_id: string;
  lead_session_id: string;
  mensaje_origen_id: string;
  estado: string;
  contenido: string | null;
  origen: string | null;
  regla_id: string | null;
  error_codigo: string | null;
  usado_at: string | null;
  usado_via: string | null;
  usado_por: string | null;
  created_at: string;
  updated_at: string;
}

function enLista<T extends string>(lista: readonly T[], valor: string | null): T | null {
  return valor !== null && (lista as readonly string[]).includes(valor) ? (valor as T) : null;
}

function mapRow(row: Row): BorradorIa {
  const estado = enLista<EstadoBorrador>(ESTADOS_BORRADOR, row.estado);
  // El CHECK de la tabla lo impide: otro valor es la base y el código divergiendo.
  if (estado === null)
    throw new InfraError(`borradores_ia.estado desconocido: ${row.estado}`, TABLA);
  return {
    id: row.id,
    conversacion_id: row.conversacion_id,
    lead_session_id: row.lead_session_id,
    mensaje_origen_id: row.mensaje_origen_id,
    estado,
    contenido: row.contenido,
    origen: enLista<OrigenBorrador>(ORIGENES_BORRADOR, row.origen),
    regla_id: row.regla_id,
    error_codigo: row.error_codigo,
    usado_at: row.usado_at === null ? null : new Date(row.usado_at),
    usado_via: enLista<ViaUsoBorrador>(VIAS_USO_BORRADOR, row.usado_via),
    usado_por: row.usado_por,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

/**
 * Supabase impl de `BorradoresIaRepository`.
 *
 * `iniciar` es el RPC `iniciar_borrador_ia` (lock a la conversación + chequeo del
 * último entrante + descarte de vigentes + insert, todo en una transacción). El
 * resto son UPDATE condicionales al estado: la garantía de que un turno viejo no
 * pisa a uno nuevo vive en el `WHERE estado = 'redactando'`, no en el llamador.
 */
export class SupabaseBorradoresIaRepository implements BorradoresIaRepository {
  constructor(private readonly db: AppClient) {}

  async iniciar(input: IniciarBorradorInput): Promise<ResultadoIniciar> {
    const { data, error } = await this.db.rpc("iniciar_borrador_ia", {
      p_conversacion_id: input.conversacionId,
      p_lead_session_id: input.leadSessionId,
      p_mensaje_origen_id: input.mensajeOrigenId,
      p_forzar: input.forzar === true,
    });
    if (error) {
      // P0002 = `no_data_found`: la conversación no existe.
      if (error.code === "P0002") {
        throw new NotFoundError(
          `conversación no encontrada: ${input.conversacionId}`,
          "conversacion",
          input.conversacionId,
          error,
        );
      }
      throw mapPostgrestError(error, { resource: "borrador_ia" });
    }
    const fila = (
      data as unknown as
        | { out_id: string | null; out_resultado: string; out_estado: string | null }[]
        | null
    )?.[0];
    if (!fila) throw new InfraError("iniciar_borrador_ia no devolvió fila", TABLA);

    if (fila.out_resultado === "obsoleto" || fila.out_id === null) return { resultado: "obsoleto" };
    if (fila.out_resultado === "existente") {
      const estado = enLista<EstadoBorrador>(ESTADOS_BORRADOR, fila.out_estado);
      if (estado === null) throw new InfraError(`estado desconocido: ${fila.out_estado}`, TABLA);
      return { resultado: "existente", borradorId: fila.out_id, estado };
    }
    return { resultado: "creado", borradorId: fila.out_id };
  }

  async completar(id: UUID, input: CompletarBorradorInput): Promise<BorradorIa | null> {
    validarOrigen(input.origen);
    if (!isUuid(id)) return null;
    const { data, error } = await this.db
      .from(TABLA)
      .update({
        estado: "listo",
        contenido: input.contenido,
        origen: input.origen,
        regla_id: input.reglaId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("estado", "redactando")
      .select()
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "borrador_ia" });
    return data ? mapRow(data as Row) : null;
  }

  async marcarError(id: UUID, codigo: string): Promise<BorradorIa | null> {
    validarCodigoError(codigo);
    if (!isUuid(id)) return null;
    const { data, error } = await this.db
      .from(TABLA)
      .update({ estado: "error", error_codigo: codigo, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("estado", "redactando")
      .select()
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "borrador_ia" });
    return data ? mapRow(data as Row) : null;
  }

  async descartar(id: UUID): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { data, error } = await this.db
      .from(TABLA)
      .update({ estado: "descartado", updated_at: new Date().toISOString() })
      .eq("id", id)
      .in("estado", [...ESTADOS_VIGENTES])
      .select("id");
    if (error) throw mapPostgrestError(error, { resource: "borrador_ia" });
    return (data ?? []).length > 0;
  }

  async descartarVigentes(conversacionId: UUID): Promise<number> {
    if (!isUuid(conversacionId)) return 0;
    const { data, error } = await this.db
      .from(TABLA)
      .update({ estado: "descartado", updated_at: new Date().toISOString() })
      .eq("conversacion_id", conversacionId)
      .in("estado", [...ESTADOS_VIGENTES])
      .select("id");
    if (error) throw mapPostgrestError(error, { resource: "borrador_ia" });
    return (data ?? []).length;
  }

  async marcarUsado(id: UUID, input: MarcarUsadoInput): Promise<ResultadoMarcarUsado> {
    validarVia(input.via);
    if (!isUuid(id)) return "no_disponible";
    const ahora = new Date().toISOString();
    // La policy `borradores_ia_update_uso` solo deja pasar `listo` -> `usado`: si
    // otra llamada llegó antes, esta afecta 0 filas sin error.
    const { data, error } = await this.db
      .from(TABLA)
      .update({
        estado: "usado",
        usado_via: input.via,
        usado_por: input.usuarioId,
        usado_at: ahora,
        updated_at: ahora,
      })
      .eq("id", id)
      .eq("estado", "listo")
      .select("id");
    if (error) throw mapPostgrestError(error, { resource: "borrador_ia" });
    if ((data ?? []).length > 0) return "marcado";

    const actual = await this.findById(id);
    return actual?.estado === "usado" ? "ya_usado" : "no_disponible";
  }

  async findById(id: UUID): Promise<BorradorIa | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from(TABLA).select().eq("id", id).maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "borrador_ia" });
    return data ? mapRow(data as Row) : null;
  }

  async findActualByConversacion(conversacionId: UUID): Promise<BorradorIa | null> {
    if (!isUuid(conversacionId)) return null;
    const { data, error } = await this.db
      .from(TABLA)
      .select()
      .eq("conversacion_id", conversacionId)
      .neq("estado", "descartado")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "borrador_ia" });
    return data ? mapRow(data as Row) : null;
  }

  async listListosPorConversacionIds(conversacionIds: readonly UUID[]): Promise<UUID[]> {
    const limpios = conversacionIds.filter(isUuid);
    const salida = new Set<UUID>();
    for (let i = 0; i < limpios.length; i += IDS_POR_TANDA) {
      const { data, error } = await this.db
        .from(TABLA)
        .select("conversacion_id")
        .eq("estado", "listo")
        .in("conversacion_id", limpios.slice(i, i + IDS_POR_TANDA));
      if (error) throw mapPostgrestError(error, { resource: "borrador_ia" });
      for (const fila of data ?? [])
        salida.add((fila as { conversacion_id: string }).conversacion_id);
    }
    return [...salida];
  }
}
