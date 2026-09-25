import type { Grupo } from "@/lib/ui/condiciones";
import type { ParametroPlantilla } from "./parametros";
import type { UUID } from "@/types/entities";

/**
 * El modelo de dominio de Difusión: sus enums, sus reglas cerradas y las
 * entidades que devuelven los repositorios.
 *
 * Vive en `lib/` y no en `types/` por una sola razón: `Difusion.audiencia` ES
 * el árbol de condiciones de `lib/ui/condiciones.ts` —el mismo que usa el
 * editor de workflows—, y `types/` no puede importar de `lib/`
 * (`eslint-plugin-boundaries`). Copiar el tipo del árbol a `types/` crearía dos
 * definiciones que se separan en silencio, que es justo lo que ese archivo
 * existe para evitar.
 *
 * Los enums están duplicados en la migración `*_difusion.sql`, que es lo que la
 * base hace cumplir. `tests/unit/difusion/modelo-vs-migracion.test.ts` falla si
 * se separan.
 */

export const ESTADO_DIFUSION = [
  "borrador",
  "programada",
  "enviando",
  "en_revision",
  "completada",
  "detenida",
] as const;
export type EstadoDifusion = (typeof ESTADO_DIFUSION)[number];

/** Congelada manda a los que coinciden hoy; dinámica sigue sumando a quien empiece a coincidir. */
export const MODO_AUDIENCIA = ["congelada", "dinamica"] as const;
export type ModoAudiencia = (typeof MODO_AUDIENCIA)[number];

/** La asigna Meta al aprobar la plantilla. Sólo `marketing` cuenta contra el cap por persona (131049). */
export const CATEGORIA_PLANTILLA = ["marketing", "utility"] as const;
export type CategoriaPlantilla = (typeof CATEGORIA_PLANTILLA)[number];

/**
 * Los estados honestos de un envío (PRD §6.6).
 *
 * `aceptado` NO es `enviado`: es el 200 de la Cloud API con un wamid, y nada
 * más. `excluido` es un envío que nunca iba a salir y lleva su motivo;
 * `cancelado`, uno que iba a salir y se detuvo antes.
 */
export const ESTADO_ENVIO = [
  "excluido",
  "en_cola",
  "aceptado",
  "entregado",
  "leido",
  "fallido",
  "cancelado",
] as const;
export type EstadoEnvio = (typeof ESTADO_ENVIO)[number];

/** Lo que ya llegó a Meta: detener no lo recupera (§8.5). */
export const ESTADOS_QUE_SALIERON = [
  "aceptado",
  "entregado",
  "leido",
] as const satisfies readonly EstadoEnvio[];

/** Gratis dentro de la ventana de servicio de 24 h, o por plantilla paga fuera de ella. */
export const RUTA_ENVIO = ["ventana_abierta", "plantilla"] as const;
export type RutaEnvio = (typeof RUTA_ENVIO)[number];

/**
 * Por qué un lead de la audiencia no recibe. **El orden del array es la
 * precedencia**: si a un lead le aplican dos motivos, se informa el primero.
 *
 * Los que protegen al número o a una conversación en curso van antes que los
 * dos eximibles, para que eximir uno nunca "suelte" a alguien que igual tenía
 * que quedar afuera por otra razón.
 *
 * `baja_meta` = 131050 o webhook `user_preferences`; `saturado_meta` = 131049
 * reciente, sólo si iría por plantilla de marketing.
 */
export const MOTIVO_EXCLUSION = [
  "sin_telefono",
  "duplicado_telefono",
  "baja_propia",
  "baja_meta",
  "requiere_humano",
  "conversacion_activa",
  "sin_ventana",
  "saturado_meta",
  "cap_frecuencia",
  "en_negociacion",
] as const;
export type MotivoExclusion = (typeof MOTIVO_EXCLUSION)[number];

export const ORIGEN_SUPRESION = [
  "palabra_clave",
  "boton_baja",
  "meta_131050",
  "meta_preferencias",
  "manual",
] as const;
export type OrigenSupresion = (typeof ORIGEN_SUPRESION)[number];

const MOTIVO_POR_ORIGEN: Record<OrigenSupresion, "baja_propia" | "baja_meta"> = {
  palabra_clave: "baja_propia",
  boton_baja: "baja_propia",
  manual: "baja_propia",
  meta_131050: "baja_meta",
  meta_preferencias: "baja_meta",
};

/** Una baja la pidió la persona acá, o Meta la informó. Las dos son irrenunciables. */
export function motivoDeSupresion(origen: OrigenSupresion): "baja_propia" | "baja_meta" {
  return MOTIVO_POR_ORIGEN[origen];
}

/**
 * Los únicos motivos que una campaña puede levantar, y sólo explícitamente
 * (`difusiones.incluir_en_negociacion`, `difusiones.exenta_tope_frecuencia`),
 * para que la exención quede auditada en la fila (§7.4).
 */
const EXIMIBLES: ReadonlySet<MotivoExclusion> = new Set(["cap_frecuencia", "en_negociacion"]);

export function esMotivoEximible(motivo: MotivoExclusion): boolean {
  return EXIMIBLES.has(motivo);
}

/**
 * Las transiciones legales de un envío. La misma tabla la hace cumplir el
 * trigger `difusion_envios_transicion`.
 *
 * - Nada vuelve a `en_cola`: volver a la cola es la forma de mandar dos veces.
 * - `cancelado → aceptado | fallido`: lo que estaba en vuelo al detener
 *   termina como diga Meta. Si Meta lo aceptó, salió, y la fila no puede decir
 *   otra cosa.
 * - `en_cola → excluido`: re-evaluado contra la audiencia al momento de salir
 *   (§8.6) —se dio de baja entre el plan y su tanda, por ejemplo—.
 */
const TRANSICIONES: Record<EstadoEnvio, readonly EstadoEnvio[]> = {
  excluido: [],
  en_cola: ["aceptado", "fallido", "cancelado", "excluido"],
  cancelado: ["aceptado", "fallido"],
  aceptado: ["entregado", "leido", "fallido"],
  entregado: ["leido"],
  leido: [],
  fallido: [],
};

/** `false` para `desde === hacia`: quedarse en el mismo estado no es una transición. */
export function transicionEnvioPermitida(desde: EstadoEnvio, hacia: EstadoEnvio): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

/** Desde qué estados se puede llegar a `hacia`. */
export function estadosPrevios(hacia: EstadoEnvio): EstadoEnvio[] {
  return ESTADO_ENVIO.filter((desde) => transicionEnvioPermitida(desde, hacia));
}

// =========================================================================
// Entidades — una por tabla, con las columnas tal como están en la base.
// =========================================================================

export interface Difusion {
  id: UUID;
  nombre: string;
  estado: EstadoDifusion;
  audiencia: Grupo;
  /**
   * Se eligió mandarle a toda la base, a propósito. Va con el árbol vacío; un
   * árbol vacío sin esta marca no se programa (migración `*_difusion_resolver.sql`).
   */
  audiencia_toda_la_base: boolean;
  audiencia_modo: ModoAudiencia;
  plantilla_nombre: string | null;
  plantilla_categoria: CategoriaPlantilla | null;
  /** El código con que Meta aprobó la plantilla (`es`, `es_AR`). Obligatorio para programar. */
  plantilla_idioma: string | null;
  /** Las variables del cuerpo en orden: la 0 es `{{1}}`. */
  plantilla_parametros: ParametroPlantilla[];
  incluir_en_negociacion: boolean;
  exenta_tope_frecuencia: boolean;
  canary_tamano: number | null;
  /** La muestra salió y se frenó para revisarla: al reanudar no se vuelve a frenar. */
  canary_revisado_at: Date | null;
  programada_para: Date | null;
  iniciada_at: Date | null;
  finalizada_at: Date | null;
  /** Null con `estado = 'detenida'`: la frenó el sistema (368, 131031, 131048). */
  detenida_por: UUID | null;
  motivo_detencion: string | null;
  /** Por qué el sistema la pasó a revisión (132015, canary). Null = la pausó una persona. */
  motivo_revision: string | null;
  creada_por: UUID | null;
  created_at: Date;
  updated_at: Date;
}

export interface DifusionEnvio {
  id: UUID;
  difusion_id: UUID;
  /** Null sólo si el lead se borró después de planificar: la fila queda por las cifras. */
  lead_id: UUID | null;
  /** Dígitos E.164 sin `+`. Null sólo con `motivo_exclusion = 'sin_telefono'`. */
  telefono: string | null;
  estado: EstadoEnvio;
  motivo_exclusion: MotivoExclusion | null;
  ruta: RutaEnvio | null;
  tanda: number | null;
  programado_para: Date | null;
  meta_message_id: string | null;
  error_codigo: string | null;
  error_detalle: string | null;
  /**
   * Reservado para mandarse: se escribe antes de llamar a Meta. En cola con
   * reserva = en vuelo, o desenlace desconocido si quedó así: nunca se reenvía.
   */
  intento_at: Date | null;
  created_at: Date;
  /** Cuándo entró al estado actual. Sólo lo mueve un cambio de estado. */
  estado_at: Date;
}

/**
 * Una baja de difusión. La baja es del número, no del lead, pero **el número no
 * se guarda**: la base tiene su HMAC (`telefono_hash`) y la versión de la clave
 * con que se calculó. Ni el teléfono ni el hash salen de la capa de repos
 * (docs/data-retention.md §3).
 */
export interface SupresionDifusion {
  id: UUID;
  /** Versión de la clave HMAC con que se hasheó el teléfono (rotación cada 90 días). */
  clave_version: number;
  origen: OrigenSupresion;
  detalle: string | null;
  lead_id: UUID | null;
  difusion_id: UUID | null;
  registrada_por: UUID | null;
  created_at: Date;
  reactivada_at: Date | null;
  reactivada_por: UUID | null;
  reactivacion_motivo: string | null;
}

/**
 * Una baja activa encontrada al buscar por teléfono. `telefono` es el número
 * que buscó quien llama, normalizado (dígitos E.164 sin `+`): no sale de la
 * base, que no lo tiene.
 */
export interface SupresionEncontrada extends SupresionDifusion {
  telefono: string;
}

export interface ConteoEnvios {
  total: number;
  porEstado: Record<EstadoEnvio, number>;
  /** Sólo de los `excluido`. */
  porMotivo: Record<MotivoExclusion, number>;
}

export function conteoVacio(): ConteoEnvios {
  return {
    total: 0,
    porEstado: Object.fromEntries(ESTADO_ENVIO.map((e) => [e, 0])) as Record<EstadoEnvio, number>,
    porMotivo: Object.fromEntries(MOTIVO_EXCLUSION.map((m) => [m, 0])) as Record<
      MotivoExclusion,
      number
    >,
  };
}
