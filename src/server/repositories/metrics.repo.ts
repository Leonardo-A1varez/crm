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
  /**
   * Qué persona lo escribió. Solo en `sender = 'humano'`, y `null` en todo lo
   * anterior a que el envío del panel empezara a propagarlo: el corte por
   * vendedor sale de acá y no tiene otra fuente.
   */
  sender_user_id: string | null;
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
 * Turno que resolvió el LLM porque ninguna regla lo cubría. Es el complemento
 * de `FilaRuleExecutionMetrica`: sin esta tabla no hay forma de saber cuánto se
 * usa un intent que todavía no tiene regla.
 */
export interface FilaTurnClassificationMetrica {
  /** `null` cuando el clasificador no reconoció ningún intent activo. */
  intent_id: string | null;
  created_at: Date;
}

/** Usuario reducido a lo que la tabla por vendedor necesita: ponerle nombre a un id. */
export interface FilaUsuarioMetrica {
  id: string;
  nombre: string;
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
  listTurnClassificationsDesde(desde: Date): Promise<FilaTurnClassificationMetrica[]>;
  listToolExecutionsDesde(desde: Date): Promise<FilaToolExecutionMetrica[]>;
  /**
   * Sin ventana: intents y reglas son configuración, no eventos. Cuáles tienen
   * regla es una foto del estado de hoy y no algo que haya pasado en el período.
   */
  listIntentsActivos(): Promise<FilaIntentMetrica[]>;
  listReglasActivas(): Promise<FilaReglaActivaMetrica[]>;
  /** Todos, no solo los activos: un vendedor dado de baja atendió sesiones que siguen contando. */
  listUsuarios(): Promise<FilaUsuarioMetrica[]>;
}

/** Filas con las que se arma un `InMemoryMetricsRepository`. Todas opcionales. */
export interface MetricsFixture {
  sesiones?: FilaSesionMetrica[];
  mensajes?: FilaMensajeMetrica[];
  leads?: FilaLeadMetrica[];
  reglas?: FilaRuleExecutionMetrica[];
  tools?: FilaToolExecutionMetrica[];
  intents?: FilaIntentMetrica[];
  reglasActivas?: FilaReglaActivaMetrica[];
  clasificaciones?: FilaTurnClassificationMetrica[];
  usuarios?: FilaUsuarioMetrica[];
}

export class InMemoryMetricsRepository implements MetricsRepository {
  private readonly sesiones: FilaSesionMetrica[];
  private readonly mensajes: FilaMensajeMetrica[];
  private readonly leads: FilaLeadMetrica[];
  private readonly reglas: FilaRuleExecutionMetrica[];
  private readonly tools: FilaToolExecutionMetrica[];
  private readonly intents: FilaIntentMetrica[];
  private readonly reglasActivas: FilaReglaActivaMetrica[];
  private readonly clasificaciones: FilaTurnClassificationMetrica[];
  private readonly usuarios: FilaUsuarioMetrica[];

  // Un objeto y no 9 parámetros posicionales: con nueve listas del mismo tipo
  // base, equivocarse de posición compila y falla en silencio.
  constructor(fixture: MetricsFixture = {}) {
    this.sesiones = fixture.sesiones ?? [];
    this.mensajes = fixture.mensajes ?? [];
    this.leads = fixture.leads ?? [];
    this.reglas = fixture.reglas ?? [];
    this.tools = fixture.tools ?? [];
    this.intents = fixture.intents ?? [];
    this.reglasActivas = fixture.reglasActivas ?? [];
    this.clasificaciones = fixture.clasificaciones ?? [];
    this.usuarios = fixture.usuarios ?? [];
  }

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

  async listTurnClassificationsDesde(desde: Date): Promise<FilaTurnClassificationMetrica[]> {
    return this.clasificaciones.filter((c) => c.created_at.getTime() >= desde.getTime());
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

  async listUsuarios(): Promise<FilaUsuarioMetrica[]> {
    return this.usuarios;
  }
}
