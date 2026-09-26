import type { Notificacion, UUID } from "@/types/entities";
import type { Insert } from "./_types";

export type NotificacionInsert = Insert<Notificacion, "id" | "created_at" | "leida_at">;

/** Una notificación con lo que el panel muestra del lead, leído por la FK al mostrarla. */
export interface NotificacionConLead extends Notificacion {
  /** `null` si la notificación no es de un lead, o si el lead ya no existe. */
  lead_nombre: string | null;
}

/**
 * Los avisos del panel ("Avisar al equipo", decisión 3 del dueño).
 *
 * `crear` es idempotente por `(clave, usuario_id)`: el reintento del paso del
 * flujo (`wf:<runId>:<orden>`) no le duplica el aviso a nadie. Todo lo demás
 * filtra por usuario —además de la RLS—: cada uno ve y marca solo las suyas.
 */
export interface NotificacionesRepository {
  /** Devuelve cuántas quedaron escritas por primera vez. */
  crear(filas: readonly NotificacionInsert[]): Promise<number>;
  listarDeUsuario(usuarioId: UUID, limite: number): Promise<NotificacionConLead[]>;
  contarNoLeidas(usuarioId: UUID): Promise<number>;
  marcarLeida(usuarioId: UUID, id: UUID): Promise<void>;
  marcarTodasLeidas(usuarioId: UUID): Promise<void>;
}

export class InMemoryNotificacionesRepository implements NotificacionesRepository {
  private readonly store = new Map<UUID, Notificacion>();

  constructor(private readonly nombreDeLead: (leadId: UUID) => string | null = () => null) {}

  async crear(filas: readonly NotificacionInsert[]): Promise<number> {
    let nuevas = 0;
    for (const fila of filas) {
      const repetida = [...this.store.values()].some(
        (n) => n.clave === fila.clave && n.usuario_id === fila.usuario_id,
      );
      if (repetida) continue;
      const n: Notificacion = {
        ...fila,
        id: crypto.randomUUID(),
        leida_at: null,
        created_at: new Date(Date.now() + nuevas),
      };
      this.store.set(n.id, n);
      nuevas += 1;
    }
    return nuevas;
  }

  async listarDeUsuario(usuarioId: UUID, limite: number): Promise<NotificacionConLead[]> {
    return [...this.store.values()]
      .filter((n) => n.usuario_id === usuarioId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limite)
      .map((n) => ({ ...n, lead_nombre: n.lead_id ? this.nombreDeLead(n.lead_id) : null }));
  }

  async contarNoLeidas(usuarioId: UUID): Promise<number> {
    return [...this.store.values()].filter((n) => n.usuario_id === usuarioId && !n.leida_at).length;
  }

  async marcarLeida(usuarioId: UUID, id: UUID): Promise<void> {
    const n = this.store.get(id);
    if (n && n.usuario_id === usuarioId && !n.leida_at) {
      this.store.set(id, { ...n, leida_at: new Date() });
    }
  }

  async marcarTodasLeidas(usuarioId: UUID): Promise<void> {
    for (const n of this.store.values()) {
      if (n.usuario_id === usuarioId && !n.leida_at) {
        this.store.set(n.id, { ...n, leida_at: new Date() });
      }
    }
  }
}
