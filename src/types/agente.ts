export const TONO = ["formal", "neutro", "cercano"] as const;
export type Tono = (typeof TONO)[number];

export const LARGO = ["corto", "medio", "detallado"] as const;
export type Largo = (typeof LARGO)[number];

export const EMOJIS = ["nunca", "ocasional", "libre"] as const;
export type Emojis = (typeof EMOJIS)[number];

export const POLITICA_TOPE = ["pausar", "solo_reglas", "seguir"] as const;
export type PoliticaTope = (typeof POLITICA_TOPE)[number];

export const DIAS_SEMANA = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"] as const;
export type DiaSemana = (typeof DIAS_SEMANA)[number];

/** Rango en "HH:MM" 24h, hora local de `horario_timezone`. */
export interface RangoHorario {
  desde: string;
  hasta: string;
}

/**
 * Lista de rangos por día y no un rango único: un negocio que cierra al
 * mediodía necesita dos, y modelarlo como uno obliga a rehacer la tabla.
 * Día con lista vacía = cerrado.
 */
export type Horario = Record<DiaSemana, RangoHorario[]>;

/** Los campos que un admin configura. Sin metadatos de versión. */
export interface AgenteConfigValores {
  modelo: string;
  instrucciones: string;
  tono: Tono;
  largo: Largo;
  emojis: Emojis;
  descuento_max_pct: number;
  max_pasos_tool: number;
  ventana_contexto_mensajes: number;
  umbral_resumen_turnos: number;
  /** §4.4. Corte de `buscar_repuesto`; al vencer el turno sigue sin catálogo. */
  timeout_tool_ms: number;
  tope_gasto_diario_usd: number;
  politica_tope: PoliticaTope;
  /** §4.2. Intents desconocidos consecutivos que pausan la IA. */
  escalar_umbral_intents: number;
  /** §4.2. Escalan sin importar el intent detectado. Se comparan normalizadas. */
  escalar_palabras: string[];
  /** §4.2. Monto cotizado desde el cual escala. `null` = condición apagada. */
  escalar_cotizacion_desde: number | null;
  horario: Horario;
  horario_timezone: string;
  plantilla_fuera_horario: string;
  /** Aviso neutral que recibe el cliente al escalar automáticamente. */
  plantilla_escalado: string;
}

/** Una versión persistida: valores + procedencia. */
export interface AgenteConfig extends AgenteConfigValores {
  id: string;
  version: number;
  activa: boolean;
  nota: string | null;
  rollback_de: string | null;
  creada_por: string | null;
  created_at: string;
}
