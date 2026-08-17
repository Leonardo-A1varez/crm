import type { Metricas } from "@/types/metricas";

export interface MetricsService {
  /**
   * Métricas del rango `[desde, hasta)`: `desde` inclusive, `hasta` exclusivo.
   * El repositorio aplica las dos cotas en cada `listXDesde` — no es solo el
   * tamaño de la ventana lo que se deriva de `hasta`, también qué filas entran.
   *
   * Qué está verificado y qué no, sin redondear:
   * `tests/repositories/metrics.contract.ts` prueba que los 8 cortes apliquen
   * `hasta` (una ventana vacía no devuelve nada) y, sobre `listSesionesDesde`,
   * que el instante `hasta` quede EXCLUIDO — una fila que cae justo ahí no
   * entra. **Eso corre solo contra la impl in-memory.** La impl de Supabase
   * comparte el mismo harness pero no se ejecuta: `test:integration` está
   * congelado a nivel proyecto mientras `SUPABASE_TEST_URL` apunte a la base de
   * la app (limitación preexistente y ajena a Métricas, ver AGENTS.md §2). O
   * sea: el `.lt()` de `metrics.supabase.repo.ts` está escrito, no probado.
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
