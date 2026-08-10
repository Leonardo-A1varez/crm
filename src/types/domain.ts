export const CURRENT_STAGE = [
  "nuevo",
  "identificando",
  "cotizado",
  "negociando",
  "esperando_pago",
  "cerrado",
  "perdido",
  "requiere_humano",
] as const;
export type CurrentStage = (typeof CURRENT_STAGE)[number];

export const URGENCIA = ["baja", "media", "alta"] as const;
export type Urgencia = (typeof URGENCIA)[number];

/**
 * Prioridad de triage de una conversación. No se persiste: se recalcula en
 * cada render a partir del estado de la sesión y del hilo (ver `lib/triage`).
 */
export const PRIORIDAD = ["alta", "media", "baja"] as const;
export type Prioridad = (typeof PRIORIDAD)[number];

export const CANAL = ["wa", "ig", "fb"] as const;
export type Canal = (typeof CANAL)[number];

export const DIRECTION = ["in", "out"] as const;
export type Direction = (typeof DIRECTION)[number];

export const SENDER = ["lead", "ia", "humano", "sistema"] as const;
export type Sender = (typeof SENDER)[number];

export const TIPO_MENSAJE = [
  "text",
  "image",
  "audio",
  "video",
  "doc",
  "location",
  "template",
] as const;
export type TipoMensaje = (typeof TIPO_MENSAJE)[number];

export const METODO_PAGO = ["transferencia", "efectivo", "tarjeta"] as const;
export type MetodoPago = (typeof METODO_PAGO)[number];

export const RESULTADO = ["exito", "perdido"] as const;
export type Resultado = (typeof RESULTADO)[number];

export const MOTIVO_PERDIDA = ["precio", "stock", "tiempo", "no_responde", "otro"] as const;
export type MotivoPerdida = (typeof MOTIVO_PERDIDA)[number];

export const ROL_USUARIO = ["admin", "vendedor"] as const;
export type RolUsuario = (typeof ROL_USUARIO)[number];

export const TAG_SOURCE = ["manual", "workflow"] as const;
export type TagSource = (typeof TAG_SOURCE)[number];

export const RESPUESTA_TIPO = ["text", "template", "handoff"] as const;
export type RespuestaTipo = (typeof RESPUESTA_TIPO)[number];

export const MERGE_CANDIDATE_STATUS = ["pending", "approved", "rejected", "superseded"] as const;
export type MergeCandidateStatus = (typeof MERGE_CANDIDATE_STATUS)[number];
