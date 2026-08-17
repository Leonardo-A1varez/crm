import type { Metricas } from "@/types/metricas";

export interface MetricsService {
  /**
   * Métricas del rango que arranca en `desde`. El repositorio solo filtra por
   * cota inferior (`>= desde`); `hasta` no se aplica como cota superior sobre
   * los datos devueltos, solo se usa para calcular el tamaño de la ventana
   * (`ventana = hasta - desde`, con la que se deriva el rango anterior para el
   * delta) y, en `resumirGasto`, únicamente para decidir el corte de "hoy".
   * El filtrado real por `hasta` queda pendiente hasta que exista un caller
   * que necesite pasar algo distinto de "ahora".
   *
   * `ahora` es la hora real usada para el corte de "hoy" del gasto de IA —
   * tiene que coincidir con el día UTC que usa el `CostTracker` para el kill
   * switch, por eso es independiente de `hasta`. Por defecto `new Date()`;
   * los tests pueden fijarla para bucketing determinístico.
   */
  obtener(desde: Date, hasta: Date, ahora?: Date): Promise<Metricas>;
}
