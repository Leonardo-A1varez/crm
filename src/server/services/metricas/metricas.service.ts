import type { Metricas } from "@/types/metricas";

export interface MetricsService {
  /**
   * Métricas del rango `[desde, hasta)`: `desde` inclusive, `hasta` exclusivo.
   * El repositorio aplica las dos cotas en cada `listXDesde` — no es solo el
   * tamaño de la ventana lo que se deriva de `hasta`, también qué filas entran.
   * Contrato real, no aspiracional: `tests/repositories/metrics.contract.ts`
   * prueba ambos extremos contra las impls in-memory y Supabase.
   *
   * `ahora` es la hora real usada para el corte de "hoy" del gasto de IA:
   * `hoyUsd` sale de una consulta propia acotada a `[inicio de hoy UTC, ahora)`,
   * el mismo día UTC que usa el `CostTracker` para el kill switch — totalmente
   * aparte de `[desde, hasta)`, así que no importa qué rango se esté
   * navegando. Por defecto `new Date()`; los tests pueden fijarla para
   * bucketing determinístico.
   */
  obtener(desde: Date, hasta: Date, ahora?: Date): Promise<Metricas>;
}
