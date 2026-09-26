/**
 * Lo que el panel muestra de un aviso ("Avisar al equipo"). Plano y
 * serializable: cruza de la Server Action al componente.
 */
export interface NotificacionVista {
  id: string;
  texto: string;
  /** `null` si el aviso no es de un lead. */
  leadNombre: string | null;
  /** La conversación del lead en el Inbox. */
  href: string | null;
  /** ISO. */
  creadaAt: string;
  leida: boolean;
}

export interface PanelNotificaciones {
  noLeidas: number;
  items: NotificacionVista[];
}
