/**
 * Destinatarios distintos por día de plantillas que salieron por este CRM
 * fuera de la ventana de 24 h. Lo calcula Postgres (`uso_cupo_whatsapp`): un
 * `count(distinct)` sobre tres tablas no se puede hacer trayendo filas, porque
 * PostgREST corta en 1.000 y no avisa.
 *
 * No hay implementación en memoria: la lógica entera es el SQL, y un doble
 * que la reimplementara probaría el doble, no la función. Los tests del
 * servicio usan un stub; la función se probó contra Postgres del stack local.
 */
export interface UsoPorDia {
  /** `YYYY-MM-DD` en la zona pedida. */
  dia: string;
  destinatarios: number;
}

export interface UsoDeLaVentana {
  /** Del más viejo al de hoy, uno por día aunque sea 0. */
  dias: UsoPorDia[];
  /** Distintos en toda la ventana: no es la suma de los días. */
  totalVentana: number;
}

export interface UsoCupoRepository {
  destinatariosPorDia(dias: number, zona: string): Promise<UsoDeLaVentana>;
}
