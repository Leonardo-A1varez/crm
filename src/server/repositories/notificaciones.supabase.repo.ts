import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { serverNowIso } from "@/server/db/server-time";
import { isUuid } from "@/server/db/uuid";
import type { Notificacion, UUID } from "@/types/entities";
import type {
  NotificacionConLead,
  NotificacionInsert,
  NotificacionesRepository,
} from "./notificaciones.repo";

interface NotificacionRow {
  id: string;
  usuario_id: string;
  lead_id: string | null;
  conversacion_id: string | null;
  workflow_run_id: string | null;
  texto: string;
  clave: string;
  leida_at: string | null;
  created_at: string;
  leads?: { nombre: string } | null;
}

function mapRow(row: NotificacionRow): Notificacion {
  return {
    id: row.id,
    usuario_id: row.usuario_id,
    lead_id: row.lead_id,
    conversacion_id: row.conversacion_id,
    workflow_run_id: row.workflow_run_id,
    texto: row.texto,
    clave: row.clave,
    leida_at: row.leida_at ? new Date(row.leida_at) : null,
    created_at: new Date(row.created_at),
  };
}

const COLS =
  "id, usuario_id, lead_id, conversacion_id, workflow_run_id, texto, clave, leida_at, created_at";

/**
 * Escribe el pipeline de flujos con service-role (`crear`); lee y marca el
 * panel con el client del usuario, donde además rige la RLS: solo las propias,
 * y del UPDATE solo `leida_at` (grant por columna). El filtro por `usuario_id`
 * se repite acá igual, para que un client de service-role mal pasado no
 * muestre las de otro.
 */
export class SupabaseNotificacionesRepository implements NotificacionesRepository {
  constructor(private readonly db: AppClient) {}

  async crear(filas: readonly NotificacionInsert[]): Promise<number> {
    if (filas.length === 0) return 0;
    const { data, error } = await this.db
      .from("notificaciones")
      .upsert(
        filas.map((f) => ({
          usuario_id: f.usuario_id,
          lead_id: f.lead_id,
          conversacion_id: f.conversacion_id,
          workflow_run_id: f.workflow_run_id,
          texto: f.texto,
          clave: f.clave,
        })),
        // El reintento del paso choca con la UNIQUE y no escribe nada.
        { onConflict: "clave,usuario_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw mapPostgrestError(error, { resource: "notificaciones" });
    return (data ?? []).length;
  }

  async listarDeUsuario(usuarioId: UUID, limite: number): Promise<NotificacionConLead[]> {
    if (!isUuid(usuarioId)) return [];
    const { data, error } = await this.db
      .from("notificaciones")
      .select(`${COLS}, leads(nombre)`)
      .eq("usuario_id", usuarioId)
      .order("created_at", { ascending: false })
      .range(0, Math.max(0, limite - 1));
    if (error) throw mapPostgrestError(error, { resource: "notificaciones" });
    return ((data ?? []) as unknown as NotificacionRow[]).map((r) => ({
      ...mapRow(r),
      lead_nombre: r.leads?.nombre ?? null,
    }));
  }

  async contarNoLeidas(usuarioId: UUID): Promise<number> {
    if (!isUuid(usuarioId)) return 0;
    const { count, error } = await this.db
      .from("notificaciones")
      .select("id", { count: "exact", head: true })
      .eq("usuario_id", usuarioId)
      .is("leida_at", null);
    if (error) throw mapPostgrestError(error, { resource: "notificaciones" });
    return count ?? 0;
  }

  async marcarLeida(usuarioId: UUID, id: UUID): Promise<void> {
    if (!isUuid(usuarioId) || !isUuid(id)) return;
    const { error } = await this.db
      .from("notificaciones")
      .update({ leida_at: await serverNowIso(this.db) })
      .eq("id", id)
      .eq("usuario_id", usuarioId)
      .is("leida_at", null);
    if (error) throw mapPostgrestError(error, { resource: "notificaciones" });
  }

  async marcarTodasLeidas(usuarioId: UUID): Promise<void> {
    if (!isUuid(usuarioId)) return;
    const { error } = await this.db
      .from("notificaciones")
      .update({ leida_at: await serverNowIso(this.db) })
      .eq("usuario_id", usuarioId)
      .is("leida_at", null);
    if (error) throw mapPostgrestError(error, { resource: "notificaciones" });
  }
}
