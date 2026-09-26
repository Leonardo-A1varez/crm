import type { NotificacionesRepository } from "@/server/repositories/notificaciones.repo";
import type { UUID } from "@/types/entities";
import type { PanelNotificaciones } from "@/types/notificaciones";

/** Cuántas trae el panel: las más nuevas. Las viejas leídas no le sirven a nadie en un popover. */
export const NOTIFICACIONES_EN_PANEL = 20;

/**
 * Los avisos del panel de quien mira ("Avisar al equipo"). Cada método recibe
 * el usuario de la sesión: el repo filtra por él y la RLS también.
 */
export class NotificacionesService {
  constructor(private readonly repo: NotificacionesRepository) {}

  async panel(usuarioId: UUID): Promise<PanelNotificaciones> {
    const [filas, noLeidas] = await Promise.all([
      this.repo.listarDeUsuario(usuarioId, NOTIFICACIONES_EN_PANEL),
      this.repo.contarNoLeidas(usuarioId),
    ]);
    return {
      noLeidas,
      items: filas.map((n) => ({
        id: n.id,
        texto: n.texto,
        leadNombre: n.lead_id ? n.lead_nombre?.trim() || "Lead sin nombre" : null,
        href: n.lead_id ? `/inbox/${n.lead_id}` : null,
        creadaAt: n.created_at.toISOString(),
        leida: n.leida_at !== null,
      })),
    };
  }

  marcarLeida(usuarioId: UUID, id: UUID): Promise<void> {
    return this.repo.marcarLeida(usuarioId, id);
  }

  marcarTodasLeidas(usuarioId: UUID): Promise<void> {
    return this.repo.marcarTodasLeidas(usuarioId);
  }
}
