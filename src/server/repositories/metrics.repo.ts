import type { Canal, CurrentStage, Sender } from "@/types/domain";

/** Sesión reducida a lo que las métricas necesitan contar. */
export interface FilaSesionMetrica {
  /** Correlaciona la sesión con sus mensajes: sin esto no se sabe si intervino un humano. */
  id: string;
  current_stage: CurrentStage;
  resultado: "exito" | "perdido" | null;
  motivo_perdida: string | null;
  started_at: Date;
}

/** Mensaje reducido a lo que las métricas necesitan contar. */
export interface FilaMensajeMetrica {
  sender: Sender;
  created_at: Date;
  /** Canal de la conversación que lo contiene: el volumen por canal sale de acá. */
  canal: Canal;
  lead_session_id: string;
}

/** Lead reducido a lo que las métricas necesitan contar: solo cuándo entró. */
export interface FilaLeadMetrica {
  created_at: Date;
}

/**
 * Turno que resolvió una regla IF/THEN en vez del LLM. Se audita contra el
 * mensaje entrante que la disparó, así que una fila equivale a un turno.
 */
export interface FilaRuleExecutionMetrica {
  created_at: Date;
}

/** Llamada del agente a una herramienta. `error` no nulo es una llamada fallida. */
export interface FilaToolExecutionMetrica {
  tool_name: string;
  created_at: Date;
  error: string | null;
}

/** Intent activo. `auto_detectado` marca los que propuso el detector batch. */
export interface FilaIntentMetrica {
  id: string;
  nombre: string;
  descripcion: string;
  auto_detectado: boolean;
  created_at: Date;
}

/** Solo el intent al que apunta una regla activa: alcanza para saber cuáles tienen cobertura. */
export interface FilaReglaActivaMetrica {
  intent_id: string;
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
  listLeadsDesde(desde: Date): Promise<FilaLeadMetrica[]>;
  listRuleExecutionsDesde(desde: Date): Promise<FilaRuleExecutionMetrica[]>;
  listToolExecutionsDesde(desde: Date): Promise<FilaToolExecutionMetrica[]>;
  /**
   * Sin ventana: intents y reglas son configuración, no eventos. Cuáles tienen
   * regla es una foto del estado de hoy y no algo que haya pasado en el período.
   */
  listIntentsActivos(): Promise<FilaIntentMetrica[]>;
  listReglasActivas(): Promise<FilaReglaActivaMetrica[]>;
}

export class InMemoryMetricsRepository implements MetricsRepository {
  constructor(
    private readonly sesiones: FilaSesionMetrica[] = [],
    private readonly mensajes: FilaMensajeMetrica[] = [],
    private readonly leads: FilaLeadMetrica[] = [],
    private readonly reglas: FilaRuleExecutionMetrica[] = [],
    private readonly tools: FilaToolExecutionMetrica[] = [],
    private readonly intents: FilaIntentMetrica[] = [],
    private readonly reglasActivas: FilaReglaActivaMetrica[] = [],
  ) {}

  async listSesionesDesde(desde: Date): Promise<FilaSesionMetrica[]> {
    return this.sesiones.filter((s) => s.started_at.getTime() >= desde.getTime());
  }

  async listMensajesDesde(desde: Date): Promise<FilaMensajeMetrica[]> {
    return this.mensajes.filter((m) => m.created_at.getTime() >= desde.getTime());
  }

  async listLeadsDesde(desde: Date): Promise<FilaLeadMetrica[]> {
    return this.leads.filter((l) => l.created_at.getTime() >= desde.getTime());
  }

  async listRuleExecutionsDesde(desde: Date): Promise<FilaRuleExecutionMetrica[]> {
    return this.reglas.filter((r) => r.created_at.getTime() >= desde.getTime());
  }

  async listToolExecutionsDesde(desde: Date): Promise<FilaToolExecutionMetrica[]> {
    return this.tools.filter((t) => t.created_at.getTime() >= desde.getTime());
  }

  async listIntentsActivos(): Promise<FilaIntentMetrica[]> {
    return this.intents;
  }

  async listReglasActivas(): Promise<FilaReglaActivaMetrica[]> {
    return this.reglasActivas;
  }
}
