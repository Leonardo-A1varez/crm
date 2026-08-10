import type { CurrentStage, Sender } from "@/types/domain";

/** Sesión reducida a lo que las métricas necesitan contar. */
export interface FilaSesionMetrica {
  current_stage: CurrentStage;
  resultado: "exito" | "perdido" | null;
  motivo_perdida: string | null;
  started_at: Date;
}

/** Mensaje reducido a lo que las métricas necesitan contar. */
export interface FilaMensajeMetrica {
  sender: Sender;
  created_at: Date;
}

/**
 * Lectura para métricas. Devuelve filas flacas y agrega en el service, no en
 * SQL: a la escala de un CRM single-org son miles de filas, y tener el corte en
 * TypeScript lo vuelve testeable sin una base al lado. Si el volumen crece, lo
 * que cambia es esta implementación y no el service.
 */
export interface MetricsRepository {
  listSesionesDesde(desde: Date): Promise<FilaSesionMetrica[]>;
  listMensajesDesde(desde: Date): Promise<FilaMensajeMetrica[]>;
}

export class InMemoryMetricsRepository implements MetricsRepository {
  constructor(
    private readonly sesiones: FilaSesionMetrica[] = [],
    private readonly mensajes: FilaMensajeMetrica[] = [],
  ) {}

  async listSesionesDesde(desde: Date): Promise<FilaSesionMetrica[]> {
    return this.sesiones.filter((s) => s.started_at.getTime() >= desde.getTime());
  }

  async listMensajesDesde(desde: Date): Promise<FilaMensajeMetrica[]> {
    return this.mensajes.filter((m) => m.created_at.getTime() >= desde.getTime());
  }
}
