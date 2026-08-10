import type { Canal, CurrentStage, Sender } from "./domain";

export interface ConteoEtapa {
  stage: CurrentStage;
  cantidad: number;
}

export interface ConteoMotivo {
  motivo: string;
  cantidad: number;
}

export interface ConteoCanal {
  canal: Canal;
  cantidad: number;
}

export interface ConteoHerramienta {
  nombre: string;
  llamadas: number;
  /** Llamadas que terminaron en error; no incluye las que devolvieron vacío. */
  fallidas: number;
}

/**
 * Intent activo que ninguna regla activa cubre: hoy lo contesta el LLM. No trae
 * cuántas veces se usó porque esa cuenta no existe — la clasificación de un
 * turno solo se persiste cuando matchea una regla (`rule_executions`), que es
 * justo el caso contrario al de esta lista.
 */
export interface IntentSinRegla {
  id: string;
  nombre: string;
  descripcion: string;
  /** Lo propuso el detector batch mirando conversaciones reales. */
  autoDetectado: boolean;
  detectadoEl: Date;
}

/**
 * Un valor junto al de la ventana inmediatamente anterior de igual largo: es lo
 * único con lo que la pantalla puede dibujar un delta sin inventarlo.
 * `anterior` es `null` cuando esa ventana no se consultó para esta métrica.
 */
export interface Comparado {
  valor: number;
  anterior: number | null;
}

/** Los tres cortes del handoff (§3). El corte activo viaja en `?tab=`. */
export const TABS_METRICAS = ["total", "agente", "vendedores"] as const;
export type TabMetricas = (typeof TABS_METRICAS)[number];

/**
 * Forma derivada, no entity: la produce `MetricsService.obtener` y la consume la
 * pantalla. Solo trae lo que hoy se puede contar de verdad; las métricas del
 * handoff que dependen de instrumentación inexistente no aparecen acá, para que
 * no haya forma de renderizar un número que nadie midió.
 */
export interface Metricas {
  /** Inicio de la ventana; todo lo de abajo cuenta desde acá. */
  desde: Date;
  dias: number;
  totalSesiones: number;
  /** Leads creados en la ventana. */
  leadsNuevos: Comparado;
  /** Éxito sobre las sesiones ya resueltas (éxito + perdido), en porcentaje. */
  tasaCierre: Comparado;
  /** Las 6 etapas del embudo, en orden, incluidas las que están en cero. */
  embudo: ConteoEtapa[];
  /** `perdido` y `requiere_humano`: fuera del embudo, contados aparte. */
  desvios: ConteoEtapa[];
  /** Mensajes de la ventana por canal, en orden canónico y sin los canales en cero. */
  porCanal: ConteoCanal[];
  resultado: {
    abiertas: number;
    exito: number;
    perdido: number;
    porMotivo: ConteoMotivo[];
  };
  /** Quién escribió cada mensaje del período. */
  autoria: Record<Sender, number>;
  /** Corte de sesiones según haya intervenido una persona. Suman `totalSesiones`. */
  agente: {
    /** Nadie escribió como humano ni la sesión está pidiendo uno. */
    sinHumano: number;
    /** Un humano escribió, o la sesión quedó en `requiere_humano`. */
    escaladas: number;
  };
  /** Sesiones de la ventana en las que una persona llegó a escribir. */
  tomadasPorHumano: number;
  /** Sesiones cerradas con éxito, atribuidas según haya escrito un humano. */
  cierres: {
    ia: number;
    vendedor: number;
  };
  /**
   * Cómo se resolvió cada turno saliente. `regla` y `llm` reparten lo que mandó
   * la IA; `escalado` es lo que mandó una persona. El costo de cada franja no
   * está: no se persiste el gasto por turno en ningún lado.
   */
  turnos: {
    regla: number;
    llm: number;
    escalado: number;
  };
  /** Llamadas del agente a sus herramientas, de la más usada a la menos. */
  herramientas: ConteoHerramienta[];
  /** Intents que hoy resuelve el LLM por no tener regla activa, del más nuevo al más viejo. */
  intentsSinRegla: IntentSinRegla[];
}
