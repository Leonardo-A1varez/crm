import type { Metricas } from "@/types/metricas";

export interface MetricsService {
  /**
   * Métricas del rango `[desde, hasta)`: `desde` inclusive, `hasta` exclusivo.
   * El repositorio aplica las dos cotas en cada `listXDesde` — no es solo el
   * tamaño de la ventana lo que se deriva de `hasta`, también qué filas entran.
   * Contrato real, no aspiracional: `tests/repositories/metrics.contract.ts`
   * prueba ambos extremos contra las impls in-memory y Supabase.
   *
   * `ahora` es la hora real usada para el corte de "hoy" del gasto de IA —
   * tiene que coincidir con el día UTC que usa el `CostTracker` para el kill
   * switch, por eso es independiente de `hasta`. Por defecto `new Date()`;
   * los tests pueden fijarla para bucketing determinístico.
   */
  obtener(desde: Date, hasta: Date, ahora?: Date): Promise<Metricas>;
}
