import type { CurrentStage, Sender } from "./domain";

export interface ConteoEtapa {
  stage: CurrentStage;
  cantidad: number;
}

export interface ConteoMotivo {
  motivo: string;
  cantidad: number;
}

/**
 * Los tres cortes del handoff sobre una ventana de días. Forma derivada, no
 * entity: la produce `MetricsService.obtener` y la consume la pantalla.
 */
export interface Metricas {
  /** Inicio de la ventana; todo lo de abajo cuenta desde acá. */
  desde: Date;
  dias: number;
  totalSesiones: number;
  /** Las 6 etapas del embudo, en orden, incluidas las que están en cero. */
  embudo: ConteoEtapa[];
  /** `perdido` y `requiere_humano`: fuera del embudo, contados aparte. */
  desvios: ConteoEtapa[];
  resultado: {
    abiertas: number;
    exito: number;
    perdido: number;
    porMotivo: ConteoMotivo[];
  };
  /** Quién escribió cada mensaje del período. */
  autoria: Record<Sender, number>;
}
