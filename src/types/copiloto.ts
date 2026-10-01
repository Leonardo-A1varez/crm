import type { UUID } from "./entities";

/** Preferencia por conversación. `null` en la base = "Según horario". */
export const MODOS_OVERRIDE = ["copiloto", "automatico"] as const;
export type ModoOverride = (typeof MODOS_OVERRIDE)[number];

/**
 * Qué hace el pipeline con un mensaje entrante (§3.2):
 * - `copiloto`: la IA redacta un borrador; no se manda nada por la API.
 * - `automatico`: la IA contesta por la API, como siempre.
 * - `fuera_de_horario`: plantilla de fuera de horario si hay, o nada; sin LLM.
 */
export type ModoDecidido = "copiloto" | "automatico" | "fuera_de_horario";

export const ESTADOS_BORRADOR = ["redactando", "listo", "usado", "error", "descartado"] as const;
export type EstadoBorrador = (typeof ESTADOS_BORRADOR)[number];

/** Los que compiten por el índice único parcial: a lo sumo uno por conversación. */
export const ESTADOS_VIGENTES = ["redactando", "listo", "error"] as const;

export const ORIGENES_BORRADOR = ["ia", "regla"] as const;
export type OrigenBorrador = (typeof ORIGENES_BORRADOR)[number];

export const VIAS_USO_BORRADOR = ["insertar", "copiar", "abrir_web", "al_composer"] as const;
export type ViaUsoBorrador = (typeof VIAS_USO_BORRADOR)[number];

/** Espeja el CHECK de `borradores_ia.error_codigo`: un código corto, nunca texto libre. */
export const CODIGO_ERROR_BORRADOR = /^[a-z_]{1,40}$/;

/** Una respuesta que la IA redactó en modo Copiloto (`borradores_ia`). */
export interface BorradorIa {
  id: UUID;
  conversacion_id: UUID;
  lead_session_id: UUID;
  /** El entrante que lo disparó. */
  mensaje_origen_id: UUID;
  estado: EstadoBorrador;
  /** Texto de la respuesta. Nunca se loguea. `null` mientras redacta o si falló. */
  contenido: string | null;
  origen: OrigenBorrador | null;
  regla_id: UUID | null;
  /** Código corto (`llm_error`, `tope_diario`…), nunca texto del proveedor. */
  error_codigo: string | null;
  usado_at: Date | null;
  usado_via: ViaUsoBorrador | null;
  usado_por: UUID | null;
  created_at: Date;
  updated_at: Date;
}
/** El borrador como lo consume la UI: sin ids internos de FK y con fechas en ISO (viajan a componentes cliente). */
export interface BorradorVista {
  id: UUID;
  estado: EstadoBorrador;
  contenido: string | null;
  origen: OrigenBorrador | null;
  /** "Regla: <nombre>" cuando `origen = "regla"`; `null` si la regla ya no existe. */
  reglaNombre: string | null;
  errorCodigo: string | null;
  usadoVia: ViaUsoBorrador | null;
  creadoAt: string;
}

export interface EstadoCopiloto {
  conversacionId: UUID;
  /** `null` = "Según horario". */
  override: ModoOverride | null;
  /** Lo que el pipeline haría si llegara un mensaje ahora (§3.2). */
  modoEfectivo: ModoDecidido;
  borrador: BorradorVista | null;
}
