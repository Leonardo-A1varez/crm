import type { Metricas } from "@/types/metricas";

export interface MetricsService {
  /** Métricas del rango [desde, hasta). El delta contra el período anterior compara con el rango de igual duración inmediatamente previo a `desde`. */
  obtener(desde: Date, hasta: Date): Promise<Metricas>;
}
