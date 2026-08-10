import { NotFoundError } from "@/lib/errors";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { isUuid } from "@/server/db/uuid";
import type { AppClient } from "@/server/db/client";
import type {
  AgenteConfigInsert,
  AgenteConfigRepository,
} from "@/server/repositories/agente-config.repo";
import type { AgenteConfig, Horario } from "@/types/agente";

const TABLA = "agente_config";
const DEFAULT_LIST_LIMIT = 50;

interface Row {
  id: string;
  version: number;
  modelo: string;
  instrucciones: string;
  tono: string;
  largo: string;
  emojis: string;
  descuento_max_pct: number | string;
  max_pasos_tool: number;
  ventana_contexto_mensajes: number;
  umbral_resumen_turnos: number;
  timeout_tool_ms: number;
  tope_gasto_diario_usd: number | string;
  politica_tope: string;
  escalar_umbral_intents: number;
  // `text[]` llega como array real por PostgREST, no como el literal `{a,b}`.
  escalar_palabras: string[] | null;
  escalar_cotizacion_desde: number | string | null;
  horario: unknown;
  horario_timezone: string;
  plantilla_fuera_horario: string;
  activa: boolean;
  nota: string | null;
  rollback_de: string | null;
  creada_por: string | null;
  created_at: string;
}

/**
 * `numeric` de Postgres llega como string por PostgREST para no perder
 * precision. Sin este Number() los rangos se comparan como texto y "9" > "10".
 */
function aNumero(v: number | string): number {
  return typeof v === "number" ? v : Number(v);
}

/**
 * `escalar_cotizacion_desde` es `numeric` NULL-able: mismo problema de
 * precision que `aNumero`, pero NULL significa "condicion apagada" y no puede
 * colapsar a 0 — un 0 escalaria cada cotizacion.
 */
function aNumeroOpcional(v: number | string | null): number | null {
  return v === null ? null : aNumero(v);
}

function aDominio(row: Row): AgenteConfig {
  return {
    id: row.id,
    version: row.version,
    modelo: row.modelo,
    instrucciones: row.instrucciones,
    tono: row.tono as AgenteConfig["tono"],
    largo: row.largo as AgenteConfig["largo"],
    emojis: row.emojis as AgenteConfig["emojis"],
    descuento_max_pct: aNumero(row.descuento_max_pct),
    max_pasos_tool: row.max_pasos_tool,
    ventana_contexto_mensajes: row.ventana_contexto_mensajes,
    umbral_resumen_turnos: row.umbral_resumen_turnos,
    timeout_tool_ms: row.timeout_tool_ms,
    tope_gasto_diario_usd: aNumero(row.tope_gasto_diario_usd),
    politica_tope: row.politica_tope as AgenteConfig["politica_tope"],
    escalar_umbral_intents: row.escalar_umbral_intents,
    // El `not null default '{}'` de la migracion hace que el null no ocurra;
    // el `?? []` cubre una fila escrita antes de ese default sin romper el
    // recorrido por palabra de cada turno.
    escalar_palabras: row.escalar_palabras ?? [],
    escalar_cotizacion_desde: aNumeroOpcional(row.escalar_cotizacion_desde),
    horario: row.horario as Horario,
    horario_timezone: row.horario_timezone,
    plantilla_fuera_horario: row.plantilla_fuera_horario,
    activa: row.activa,
    nota: row.nota,
    rollback_de: row.rollback_de,
    creada_por: row.creada_por,
    created_at: row.created_at,
  };
}

export class SupabaseAgenteConfigRepository implements AgenteConfigRepository {
  constructor(private readonly db: AppClient) {}

  async findActiva(): Promise<AgenteConfig | null> {
    const { data, error } = await this.db.from(TABLA).select("*").eq("activa", true).maybeSingle();
    if (error) throw mapPostgrestError(error);
    return data ? aDominio(data as unknown as Row) : null;
  }

  async findById(id: string): Promise<AgenteConfig | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from(TABLA).select("*").eq("id", id).maybeSingle();
    if (error) throw mapPostgrestError(error);
    return data ? aDominio(data as unknown as Row) : null;
  }

  async list(limit: number = DEFAULT_LIST_LIMIT): Promise<AgenteConfig[]> {
    const { data, error } = await this.db
      .from(TABLA)
      .select("*")
      .order("version", { ascending: false })
      .limit(limit);
    if (error) throw mapPostgrestError(error);
    return (data ?? []).map((r) => aDominio(r as unknown as Row));
  }

  async siguienteVersion(): Promise<number> {
    const { data, error } = await this.db
      .from(TABLA)
      .select("version")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw mapPostgrestError(error);
    const fila = data as { version: number } | null;
    return (fila?.version ?? 0) + 1;
  }

  async crear(input: AgenteConfigInsert): Promise<AgenteConfig> {
    const { data, error } = await this.db
      .from(TABLA)
      .insert({ ...input, horario: input.horario as never, activa: false })
      .select("*")
      .single();
    if (error) throw mapPostgrestError(error);
    return aDominio(data as unknown as Row);
  }

  /**
   * Desactivar primero y activar despues, en ese orden. El indice unico parcial
   * `agente_config_una_activa` hace fallar el orden inverso en vez de dejar dos
   * activas — el error ruidoso es la conducta deseada.
   */
  async activar(id: string): Promise<AgenteConfig> {
    if (!isUuid(id)) throw new NotFoundError(`config no encontrada: ${id}`, "agente_config", id);

    const desactivar = await this.db.from(TABLA).update({ activa: false }).eq("activa", true);
    if (desactivar.error) throw mapPostgrestError(desactivar.error);

    const { data, error } = await this.db
      .from(TABLA)
      .update({ activa: true })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw mapPostgrestError(error);
    if (!data) throw new NotFoundError(`config no encontrada: ${id}`, "agente_config", id);

    return aDominio(data as unknown as Row);
  }
}
