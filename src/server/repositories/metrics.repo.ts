import type { Canal, CurrentStage, Sender } from "@/types/domain";

/** Sesión reducida a lo que las métricas necesitan contar. */
export interface FilaSesionMetrica {
  /** Correlaciona la sesión con sus mensajes: sin esto no se sabe si intervino un humano. */
  id: string;
  current_stage: CurrentStage;
  resultado: "exito" | "perdido" | null;
  motivo_perdida: string | null;
  started_at: Date;
  /** Monto TOTAL de la cotización, no unitario. null si no se cotizó nada. */
  precio_cotizado: number | null;
  codigo_interno: string | null;
  /** null mientras la sesión sigue abierta. */
  closed_at: Date | null;
  cantidad: number | null;
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
  /** Solo entrantes; null en históricos o payload sin timestamp válido. */
  platform_created_at?: Date | null;
}

export interface FilaHandoffMetrica {
  lead_session_id: string;
  action: "pause" | "resume";
  reason_code: string;
  created_at: Date;
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
  /** Solo se usa para tool_name === 'buscar_repuesto'; null en el resto. */
  args: { query?: string; marca?: string; modelo?: string } | null;
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
 * Una llamada al modelo con lo que costó (`llm_usage`). Es la única fuente del
 * gasto: el contador en memoria del `CostTracker` no sobrevive al proceso ni
 * atribuye nada a una conversación.
 */
export interface FilaLlmUsageMetrica {
  /** `null` en las llamadas que no nacen de una sesión, o cuya sesión se purgó. */
  lead_session_id: string | null;
  modelo: string;
  input_tokens: number;
  output_tokens: number;
  costo_usd: number;
  workflow: string;
  created_at: Date;
}

/** Turnos que el LLM resolvió con cada intent. `intent_id: null` = no reconoció ninguno. */
export interface ConteoClasificacionMetrica {
  intent_id: string | null;
  turnos: number;
}

/** Pausas de la IA (`action = 'pause'`) por motivo. Las reanudaciones no entran. */
export interface ConteoPausaMetrica {
  reason_code: string;
  cantidad: number;
}

/** Gasto de un workflow en la ventana: suma de `llm_usage` agrupada por `workflow`. */
export interface GastoWorkflowMetrica {
  workflow: string;
  llamadas: number;
  costo_usd: number;
  input_tokens: number;
  output_tokens: number;
}

/**
 * Lectura para métricas, en dos formas según lo que el service hace con ella:
 *
 * - **Filas** (`list*`) cuando el service necesita recorrerlas: los hilos de
 *   mensajes para medir primeras respuestas, las sesiones para cruzarlas con
 *   ellos, los `args` de cada búsqueda de repuesto. La impl de Supabase las
 *   pagina.
 * - **Agregados** (`contar*`, `resumir*`) cuando solo se cuentan o suman. Se
 *   calculan en la base: traer las filas para contarlas en TypeScript chocaba
 *   con el corte de 1.000 filas de PostgREST (AGENTS.md, lección 12) y el
 *   tablero salía de una muestra sin que fallara nada.
 *
 * La impl in-memory agrega sobre las mismas filas de fixture, así que los tests
 * del service siguen sembrando filas.
 */
export interface MetricsRepository {
  listSesionesDesde(desde: Date, hasta: Date): Promise<FilaSesionMetrica[]>;
  listMensajesDesde(desde: Date, hasta: Date): Promise<FilaMensajeMetrica[]>;
  listToolExecutionsDesde(desde: Date, hasta: Date): Promise<FilaToolExecutionMetrica[]>;
  contarLeadsDesde(desde: Date, hasta: Date): Promise<number>;
  /** Turnos que contestó una regla IF/THEN: una fila de `rule_executions` es un turno. */
  contarRuleExecutionsDesde(desde: Date, hasta: Date): Promise<number>;
  contarClasificacionesPorIntent(desde: Date, hasta: Date): Promise<ConteoClasificacionMetrica[]>;
  contarPausasPorMotivo(desde: Date, hasta: Date): Promise<ConteoPausaMetrica[]>;
  resumirGastoPorWorkflow(desde: Date, hasta: Date): Promise<GastoWorkflowMetrica[]>;
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
  gastos?: FilaLlmUsageMetrica[];
  handoffs?: FilaHandoffMetrica[];
}

/** `[desde, hasta)`: el mismo corte que aplican las consultas de Supabase. */
function enVentana(fecha: Date, desde: Date, hasta: Date): boolean {
  return fecha.getTime() >= desde.getTime() && fecha.getTime() < hasta.getTime();
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
  private readonly gastos: FilaLlmUsageMetrica[];
  private readonly handoffs: FilaHandoffMetrica[];

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
    this.gastos = fixture.gastos ?? [];
    this.handoffs = fixture.handoffs ?? [];
  }

  async listSesionesDesde(desde: Date, hasta: Date): Promise<FilaSesionMetrica[]> {
    return this.sesiones.filter((s) => enVentana(s.started_at, desde, hasta));
  }

  async listMensajesDesde(desde: Date, hasta: Date): Promise<FilaMensajeMetrica[]> {
    return this.mensajes.filter((m) => enVentana(m.created_at, desde, hasta));
  }

  async listToolExecutionsDesde(desde: Date, hasta: Date): Promise<FilaToolExecutionMetrica[]> {
    return this.tools.filter((t) => enVentana(t.created_at, desde, hasta));
  }

  async contarLeadsDesde(desde: Date, hasta: Date): Promise<number> {
    return this.leads.filter((l) => enVentana(l.created_at, desde, hasta)).length;
  }

  async contarRuleExecutionsDesde(desde: Date, hasta: Date): Promise<number> {
    return this.reglas.filter((r) => enVentana(r.created_at, desde, hasta)).length;
  }

  async contarClasificacionesPorIntent(
    desde: Date,
    hasta: Date,
  ): Promise<ConteoClasificacionMetrica[]> {
    const porIntent = new Map<string | null, number>();
    for (const c of this.clasificaciones) {
      if (!enVentana(c.created_at, desde, hasta)) continue;
      porIntent.set(c.intent_id, (porIntent.get(c.intent_id) ?? 0) + 1);
    }
    return [...porIntent].map(([intent_id, turnos]) => ({ intent_id, turnos }));
  }

  async contarPausasPorMotivo(desde: Date, hasta: Date): Promise<ConteoPausaMetrica[]> {
    const porMotivo = new Map<string, number>();
    for (const e of this.handoffs) {
      if (e.action !== "pause" || !enVentana(e.created_at, desde, hasta)) continue;
      porMotivo.set(e.reason_code, (porMotivo.get(e.reason_code) ?? 0) + 1);
    }
    return [...porMotivo].map(([reason_code, cantidad]) => ({ reason_code, cantidad }));
  }

  async resumirGastoPorWorkflow(desde: Date, hasta: Date): Promise<GastoWorkflowMetrica[]> {
    const porWorkflow = new Map<string, GastoWorkflowMetrica>();
    for (const g of this.gastos) {
      if (!enVentana(g.created_at, desde, hasta)) continue;
      const fila = porWorkflow.get(g.workflow) ?? {
        workflow: g.workflow,
        llamadas: 0,
        costo_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
      };
      fila.llamadas++;
      fila.costo_usd += g.costo_usd;
      fila.input_tokens += g.input_tokens;
      fila.output_tokens += g.output_tokens;
      porWorkflow.set(g.workflow, fila);
    }
    return [...porWorkflow.values()];
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
