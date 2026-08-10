import type { Metricas } from "@/types/metricas";

export interface MetricsService {
  /** Métricas de los últimos `dias` días, calculadas contra `ahora`. */
  obtener(dias: number, ahora?: Date): Promise<Metricas>;
}
