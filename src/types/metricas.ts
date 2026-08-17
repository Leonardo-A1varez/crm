import type { Canal, CurrentStage, Sender } from "./domain";

export interface ConteoEtapa {
  stage: CurrentStage;
  cantidad: number;
}

export interface ConteoMotivo {
  motivo: string;
  cantidad: number;
}

export interface TiempoRespuestaMedible {
  medianaSegundos: number | null;
  muestras: number;
}

export interface ConteoCanal {
  canal: Canal;
  cantidad: number;
}

/** Gasto de un tipo de llamada al modelo dentro de la ventana. */
export interface ConteoWorkflow {
  /** Valor crudo de `llm_usage.workflow`; la UI lo traduce. */
  workflow: string;
  usd: number;
  llamadas: number;
}

/**
 * Lo que costó la IA en la ventana. Sale de `llm_usage`, una fila por llamada
 * al modelo, así que todos estos números son plata efectivamente gastada — no
 * proyecciones.
 */
export interface GastoIa {
  /** USD de la ventana completa. */
  totalUsd: number;
  /** USD del día de hoy (día UTC, igual que el corte del contador diario). */
  hoyUsd: number;
  /**
   * Costo IA sobre los leads que entraron en la ventana (handoff §3.1/§3.2).
   * `null` cuando no entró ninguno: dividir por cero daría un infinito y
   * mostrar 0 diría que la IA salió gratis.
   */
  porLeadUsd: number | null;
  tokensEntrada: number;
  tokensSalida: number;
  /** Llamadas al modelo registradas, de cualquier workflow. */
  llamadas: number;
  /** Reparto por tipo de llamada, de más caro a menos. */
  porWorkflow: ConteoWorkflow[];
  /**
   * Costo promedio de un turno del agente vendedor (`workflow = ai-agent`).
   * `null` si no hubo ninguno en la ventana.
   */
  promedioTurnoUsd: number | null;
  /**
   * Ahorro estimado de las reglas IF/THEN: los turnos que contestó una regla
   * por el costo promedio de un turno del agente. **Es una estimación con
   * sesgo conocido y hacia arriba**: el promedio se calcula sobre los turnos
   * que el agente sí atendió, que son justamente los que ninguna regla cubrió
   * —normalmente más largos y con más llamadas a catálogo—. `null` cuando no
   * hay turnos del agente con los que estimar.
   */
  ahorroReglasUsd: number | null;
}

export interface ConteoHerramienta {
  nombre: string;
  llamadas: number;
  /** Llamadas que terminaron en error; no incluye las que devolvieron vacío. */
  fallidas: number;
}

/**
 * Intent activo que ninguna regla activa cubre: hoy lo contesta el LLM.
 */
export interface IntentSinRegla {
  id: string;
  nombre: string;
  descripcion: string;
  /** Lo propuso el detector batch mirando conversaciones reales. */
  autoDetectado: boolean;
  detectadoEl: Date;
  /**
   * Turnos de la ventana que el LLM contestó con este intent (tabla
   * `turn_classifications`). Es lo que costaría dejar de pagar al escribirle
   * una regla. Cuenta desde que el pipeline empezó a persistir la
   * clasificación: para ventanas anteriores a eso da cero.
   */
  usos: number;
}

/**
 * Una fila de "Rendimiento por vendedor" (handoff §3.3). Sale de cruzar
 * `mensajes.sender_user_id` con las sesiones de la ventana.
 *
 * "Ticket promedio" no está: `lead_session.precio_cotizado` es lo que se
 * cotizó, no lo que se facturó, y no existe tabla de venta ni de orden.
 */
export interface FilaVendedor {
  usuarioId: string;
  nombre: string;
  /** Sesiones en las que esta persona fue la primera en escribir. */
  tomadas: number;
  /**
   * Mediana de lo que esperó el cliente hasta la primera respuesta de esta
   * persona, en segundos. `null` si ninguna de sus sesiones tenía un mensaje
   * del cliente antes dentro de la ventana.
   */
  tomaEnSegundos: number | null;
  /** De las tomadas, las que terminaron con `resultado = exito`. */
  cerradas: number;
  /** Cerradas sobre tomadas, en porcentaje. */
  cierre: number;
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

/** Ventas realizadas del período: resultado = 'exito' en lead_session. */
export interface Ventas {
  /** Todas las resultado=exito, tengan o no precio_cotizado registrado. */
  conteo: number;
  /** De esas, cuántas tienen precio_cotizado no nulo — denominador real de monto/ticket. */
  conPrecio: number;
  /** sum(precio_cotizado), monto TOTAL (no unitario). null si conPrecio = 0. */
  montoTotalUsd: number | null;
  /** montoTotalUsd / conPrecio. null si conPrecio = 0. */
  ticketPromedioUsd: number | null;
}

/**
 * Un código de producto entre las ventas del período. `lead_session` es 1
 * producto por sesión (sin carrito): "apariciones" es la métrica primaria y
 * siempre disponible; "unidades" depende de que `cantidad` se haya registrado.
 */
export interface ConteoCodigo {
  codigoInterno: string;
  apariciones: number;
  unidades: number;
  /** Denominador de `unidades` — cuántas de las `apariciones` tienen `cantidad` registrada. */
  unidadesConDato: number;
}

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
    /** Nadie escribió como humano; puede incluir sesiones todavía abiertas. */
    sinIntervencionHumana: number;
    /** Sesiones terminadas sin que una persona haya escrito. */
    resueltasPorIa: number;
    escaladas: number;
  };
  /** Sesiones de la ventana en las que una persona llegó a escribir. */
  tomadasPorHumano: number;
  tiempoPrimeraRespuesta: {
    ia: TiempoRespuestaMedible;
    revisionAdministrativa: TiempoRespuestaMedible;
    personas: TiempoRespuestaMedible;
  };
  razonesEscalado: ConteoMotivo[];
  /** El corte por persona del §3.3. */
  vendedores: {
    /** Una fila por vendedor con al menos una sesión tomada, de más a menos. */
    filas: FilaVendedor[];
    /**
     * Sesiones que tomó una persona sin usuario registrado. Son las anteriores
     * a que el envío del panel propagara `sender_user_id`: no se pueden
     * repartir entre las filas y desaparecerlas mentiría sobre el total.
     */
    sinAtribuir: number;
    /**
     * Mediana global de la espera del cliente hasta la primera respuesta de una
     * persona, en segundos. `null` cuando no hay ninguna sesión medible.
     */
    tomaEnSegundos: number | null;
  };
  /** Sesiones cerradas con éxito, atribuidas según haya escrito un humano. */
  cierres: {
    ia: number;
    vendedor: number;
  };
  /**
   * Cómo se resolvió cada turno saliente. `regla` y `llm` reparten lo que mandó
   * la IA; `escalado` es lo que mandó una persona.
   */
  turnos: {
    regla: number;
    llm: number;
    escalado: number;
  };
  /** Lo que costó la IA en la ventana (`llm_usage`). */
  gasto: GastoIa;
  /** Llamadas del agente a sus herramientas, de la más usada a la menos. */
  herramientas: ConteoHerramienta[];
  /** Intents que hoy resuelve el LLM por no tener regla activa, del más nuevo al más viejo. */
  intentsSinRegla: IntentSinRegla[];
  ventas: Ventas;
  /** De más a menos apariciones entre las ventas del período. */
  codigosMasVendidos: ConteoCodigo[];
  repuestosMasPreguntados: {
    /** args.marca de buscar_repuesto — dato categórico limpio. */
    porMarca: ConteoMotivo[];
    /** args.query normalizado (trim + lowercase) — texto libre, puede fragmentar variantes de la misma pieza. */
    porTermino: ConteoMotivo[];
  };
  /** Mediana de closed_at - started_at sobre CUALQUIER sesión resuelta (exito o perdido) con closed_at registrado. */
  tiempoCierre: TiempoRespuestaMedible;
}
