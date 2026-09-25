import { IllegalStateError, NotFoundError } from "@/lib/errors";
import {
  ESTADOS_QUE_SALIERON,
  conteoVacio,
  estadosPrevios,
  type ConteoEnvios,
  type DifusionEnvio,
  type EstadoEnvio,
} from "@/lib/difusion/modelo";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { Database } from "@/server/db/types.gen";
import { isUuid } from "@/server/db/uuid";
import type { UUID } from "@/types/entities";
import { LIMITE_MAX_PAGINA, exigirPagina } from "./_paginacion";
import {
  CODIGO_META_SATURADO,
  LOTE_RESUMEN,
  exigirErrorMeta,
  exigirWamid,
  resumenVacio,
  telefonosNormalizados,
  yaSalieron,
  type DifusionEnvioInsert,
  type DifusionEnviosRepository,
  type ErrorMeta,
  type FalloPorCodigo,
  type ResumenEnvios,
  type TandaPersistida,
} from "./difusion-envios.repo";

type Row = Database["public"]["Tables"]["difusion_envios"]["Row"];
type DbInsert = Database["public"]["Tables"]["difusion_envios"]["Insert"];
type DbUpdate = Database["public"]["Tables"]["difusion_envios"]["Update"];

/**
 * Filas por request al persistir un plan. Cada lote es un INSERT propio: si el
 * tercero falla, los dos primeros ya están. No hace falta más que eso porque el
 * insert es idempotente por (difusión, lead) y reintentar completa lo que faltó.
 */
const LOTE_PLAN = 500;
/** Teléfonos por `in.(…)`: la lista viaja en la URL. */
const LOTE_TELEFONOS = 150;

const SALIERON: ReadonlySet<EstadoEnvio> = new Set<EstadoEnvio>(ESTADOS_QUE_SALIERON);

/**
 * Supabase impl de `DifusionEnviosRepository`.
 *
 * Las garantías duras viven en la base y valen también para el service-role:
 * un teléfono por difusión (índice único parcial), nada nace enviado ni vuelve
 * a la cola (trigger `difusion_envios_transicion`). Las transiciones de acá se
 * filtran con `.in("estado", estadosPrevios(...))` para no pedirle a la base
 * algo que va a rechazar; si la fila no se movió, se relee para distinguir un
 * reintento idempotente de un estado ilegal.
 */
export class SupabaseDifusionEnviosRepository implements DifusionEnviosRepository {
  constructor(private readonly db: AppClient) {}

  async registrarPlan(filas: readonly DifusionEnvioInsert[]): Promise<void> {
    for (let i = 0; i < filas.length; i += LOTE_PLAN) {
      const lote = filas.slice(i, i + LOTE_PLAN).map(aInsert);
      const { error } = await this.db
        .from("difusion_envios")
        .upsert(lote, { onConflict: "difusion_id,lead_id", ignoreDuplicates: true });
      if (error) throw mapPostgrestError(error, { resource: "difusion_envio" });
    }
  }

  async findById(id: UUID): Promise<DifusionEnvio | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db
      .from("difusion_envios")
      .select()
      .eq("id", id)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "difusion_envio" });
    return data ? mapRow(data) : null;
  }

  async listarPorDifusion(
    difusionId: UUID,
    { limite, desde = 0 }: { limite: number; desde?: number },
  ): Promise<DifusionEnvio[]> {
    exigirPagina(limite, desde);
    if (!isUuid(difusionId)) return [];
    const { data, error } = await this.db
      .from("difusion_envios")
      .select()
      .eq("difusion_id", difusionId)
      .order("tanda", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(desde, desde + limite - 1);
    if (error) throw mapPostgrestError(error, { resource: "difusion_envio" });
    return (data ?? []).map(mapRow);
  }

  async contarPorDifusion(difusionId: UUID): Promise<ConteoEnvios> {
    const conteo = conteoVacio();
    if (!isUuid(difusionId)) return conteo;
    const { data, error } = await this.db.rpc("difusion_envios_conteo", {
      p_difusion_id: difusionId,
    });
    if (error) throw mapPostgrestError(error, { resource: "difusion_envio" });
    for (const fila of data ?? []) {
      conteo.total += fila.cantidad;
      conteo.porEstado[fila.estado] += fila.cantidad;
      // El generador tipa las columnas de RETURNS TABLE como no nulas; el
      // motivo es null en todo lo que no está excluido.
      const motivo = fila.motivo_exclusion as typeof fila.motivo_exclusion | null;
      if (motivo !== null) conteo.porMotivo[motivo] += fila.cantidad;
    }
    return conteo;
  }

  async marcarAceptado(id: UUID, metaMessageId: string): Promise<DifusionEnvio> {
    exigirWamid(metaMessageId);
    if (!isUuid(id)) throw new NotFoundError(`envío no encontrado: ${id}`, "difusion_envio", id);

    const movida = await this.transicionar(
      this.db
        .from("difusion_envios")
        .update({ estado: "aceptado", meta_message_id: metaMessageId })
        .eq("id", id)
        .in("estado", estadosPrevios("aceptado")),
    );
    if (movida) return movida;

    const actual = await this.findById(id);
    if (!actual) throw new NotFoundError(`envío no encontrado: ${id}`, "difusion_envio", id);
    if (actual.meta_message_id === metaMessageId && SALIERON.has(actual.estado)) return actual;
    throw new IllegalStateError(
      `el envío ${id} está ${actual.estado}: no puede pasar a aceptado`,
      "transicion_envio",
    );
  }

  async marcarFallido(id: UUID, error: ErrorMeta): Promise<DifusionEnvio> {
    const { codigo, detalle } = exigirErrorMeta(error);
    if (!isUuid(id)) throw new NotFoundError(`envío no encontrado: ${id}`, "difusion_envio", id);

    const movida = await this.transicionar(
      this.db
        .from("difusion_envios")
        .update({ estado: "fallido", error_codigo: codigo, error_detalle: detalle })
        .eq("id", id)
        .in("estado", estadosPrevios("fallido")),
    );
    if (movida) return movida;

    const actual = await this.findById(id);
    if (!actual) throw new NotFoundError(`envío no encontrado: ${id}`, "difusion_envio", id);
    if (actual.estado === "fallido" && actual.error_codigo === codigo) return actual;
    throw new IllegalStateError(
      `el envío ${id} está ${actual.estado}: no puede pasar a fallido`,
      "transicion_envio",
    );
  }

  async aplicarEstadoMeta(
    metaMessageId: string,
    estado: "entregado" | "leido" | "fallido",
    error?: ErrorMeta,
  ): Promise<DifusionEnvio | null> {
    const payload: DbUpdate = { estado };
    if (estado === "fallido") {
      const { codigo, detalle } = exigirErrorMeta(error);
      payload.error_codigo = codigo;
      payload.error_detalle = detalle;
    }

    const movida = await this.transicionar(
      this.db
        .from("difusion_envios")
        .update(payload)
        .eq("meta_message_id", metaMessageId)
        .in("estado", estadosPrevios(estado)),
    );
    if (movida) return movida;

    // No se movió: o el wamid no es de una difusión, o el webhook llegó tarde
    // (un "entregado" después del "leído") y no corresponde tocar nada.
    const { data, error: errorLectura } = await this.db
      .from("difusion_envios")
      .select()
      .eq("meta_message_id", metaMessageId)
      .maybeSingle();
    if (errorLectura) throw mapPostgrestError(errorLectura, { resource: "difusion_envio" });
    return data ? mapRow(data) : null;
  }

  async cancelarPendientes(difusionId: UUID): Promise<{ cancelados: number; yaSalieron: number }> {
    if (!isUuid(difusionId)) return { cancelados: 0, yaSalieron: 0 };
    const { count, error } = await this.db
      .from("difusion_envios")
      .update({ estado: "cancelado" }, { count: "exact" })
      .eq("difusion_id", difusionId)
      .eq("estado", "en_cola");
    if (error) throw mapPostgrestError(error, { resource: "difusion_envio" });
    return {
      cancelados: count ?? 0,
      yaSalieron: yaSalieron(await this.contarPorDifusion(difusionId)),
    };
  }

  async saturadosDesde(telefonos: readonly string[], desde: Date): Promise<Map<string, Date>> {
    const saturados = new Map<string, Date>();
    const lista = telefonosNormalizados(telefonos);
    for (let i = 0; i < lista.length; i += LOTE_TELEFONOS) {
      const lote = lista.slice(i, i + LOTE_TELEFONOS);
      // Paginado aunque rara vez haga falta: un teléfono puede tener varios
      // 131049 en la ventana, y PostgREST corta en 1.000 sin avisar.
      for (let desdeFila = 0; ; desdeFila += LIMITE_MAX_PAGINA) {
        const { data, error } = await this.db
          .from("difusion_envios")
          .select("telefono, estado_at")
          .in("telefono", lote)
          .eq("estado", "fallido")
          .eq("error_codigo", CODIGO_META_SATURADO)
          .gte("estado_at", desde.toISOString())
          .order("id", { ascending: true })
          .range(desdeFila, desdeFila + LIMITE_MAX_PAGINA - 1);
        if (error) throw mapPostgrestError(error, { resource: "difusion_envio" });
        const filas = data ?? [];
        for (const { telefono, estado_at } of filas) {
          if (telefono === null) continue;
          const cuando = new Date(estado_at);
          const previo = saturados.get(telefono);
          if (!previo || previo < cuando) saturados.set(telefono, cuando);
        }
        if (filas.length < LIMITE_MAX_PAGINA) break;
      }
    }
    return saturados;
  }

  async resumenPorDifusiones(difusionIds: readonly UUID[]): Promise<Map<UUID, ResumenEnvios>> {
    const ids = [...new Set(difusionIds)].filter(isUuid);
    const resumen = new Map<UUID, ResumenEnvios>();
    for (let i = 0; i < ids.length; i += LOTE_RESUMEN) {
      const { data, error } = await this.db.rpc("difusion_envios_resumen", {
        p_difusion_ids: ids.slice(i, i + LOTE_RESUMEN),
      });
      if (error) throw mapPostgrestError(error, { resource: "difusion_envio" });
      for (const f of data ?? []) {
        const r = resumenVacio();
        r.total = f.total;
        r.porEstado.excluido = f.excluidos;
        r.porEstado.en_cola = f.en_cola;
        r.porEstado.aceptado = f.aceptados;
        r.porEstado.entregado = f.entregados;
        r.porEstado.leido = f.leidos;
        r.porEstado.fallido = f.fallidos;
        r.porEstado.cancelado = f.cancelados;
        resumen.set(f.difusion_id, r);
      }
    }
    return resumen;
  }

  async tandasPorDifusion(difusionId: UUID): Promise<TandaPersistida[]> {
    if (!isUuid(difusionId)) return [];
    const { data, error } = await this.db.rpc("difusion_envios_tandas", {
      p_difusion_id: difusionId,
    });
    if (error) throw mapPostgrestError(error, { resource: "difusion_envio" });
    const filas = data ?? [];
    // Una fila por tanda. Llegar al corte de PostgREST serían más de 1.000 días
    // de reparto; si pasa, se dice en vez de devolver un plan recortado.
    if (filas.length >= LIMITE_MAX_PAGINA) {
      throw new IllegalStateError(
        `la difusión ${difusionId} tiene ${filas.length} tandas o más: la lectura llegó al corte de PostgREST`,
        "tandas_fuera_de_rango",
      );
    }
    return filas.map((f) => ({
      tanda: f.tanda,
      desde: new Date(f.desde),
      total: f.total,
      enCola: f.en_cola,
      porPlantilla: f.por_plantilla,
    }));
  }

  async fallosPorCodigo(difusionId: UUID): Promise<FalloPorCodigo[]> {
    if (!isUuid(difusionId)) return [];
    const { data, error } = await this.db.rpc("difusion_envios_fallos", {
      p_difusion_id: difusionId,
    });
    if (error) throw mapPostgrestError(error, { resource: "difusion_envio" });
    return (data ?? []).map((f) => ({ codigo: f.error_codigo, cantidad: f.cantidad }));
  }

  /** Corre un UPDATE ... RETURNING de una fila; `null` si no movió ninguna. */
  private async transicionar(
    consulta: ReturnType<ReturnType<AppClient["from"]>["update"]>,
  ): Promise<DifusionEnvio | null> {
    const { data, error } = await consulta.select().maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "difusion_envio" });
    return data ? mapRow(data as Row) : null;
  }
}

function aInsert(f: DifusionEnvioInsert): DbInsert {
  return {
    difusion_id: f.difusion_id,
    lead_id: f.lead_id,
    telefono: f.telefono,
    estado: f.estado,
    motivo_exclusion: f.motivo_exclusion,
    ruta: f.ruta,
    tanda: f.tanda,
    programado_para: f.programado_para === null ? null : f.programado_para.toISOString(),
  };
}

function mapRow(r: Row): DifusionEnvio {
  return {
    id: r.id,
    difusion_id: r.difusion_id,
    lead_id: r.lead_id,
    telefono: r.telefono,
    estado: r.estado,
    motivo_exclusion: r.motivo_exclusion,
    ruta: r.ruta,
    tanda: r.tanda,
    programado_para: r.programado_para === null ? null : new Date(r.programado_para),
    meta_message_id: r.meta_message_id,
    error_codigo: r.error_codigo,
    error_detalle: r.error_detalle,
    created_at: new Date(r.created_at),
    estado_at: new Date(r.estado_at),
  };
}
