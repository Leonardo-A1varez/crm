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

/**
 * El embudo son estas 6 y nada más. `perdido` y `requiere_humano` NO son los
 * pasos 7 y 8: son desvíos. Vive acá y no en `lib/ui/stage` (que es de donde se
 * consume) porque `types/` no puede importar de `lib/` y `LeadSession` necesita
 * el tipo para que `etapa_alcanzada` no pueda guardar un desvío.
 */
export const ETAPAS_EMBUDO = [
  "nuevo",
  "identificando",
  "cotizado",
  "negociando",
  "esperando_pago",
  "cerrado",
] as const satisfies readonly CurrentStage[];
export type EtapaEmbudo = (typeof ETAPAS_EMBUDO)[number];

export const URGENCIA = ["baja", "media", "alta"] as const;
export type Urgencia = (typeof URGENCIA)[number];

/**
 * Motivo por el que una conversación cae en "Requieren tu atención". Son los
 * tres del handoff y en ese orden de prioridad; el orden del array ES el orden
 * de la bandeja. No se persiste: se recalcula a partir de la sesión
 * (ver `lib/triage`).
 */
export const MOTIVO_TRIAGE = ["humano", "bloqueo", "pago"] as const;
export type MotivoTriage = (typeof MOTIVO_TRIAGE)[number];

export interface MotivoAtencion {
  tipo: MotivoTriage;
  /** Lo que lee el vendedor en el chip de la fila. */
  texto: string;
}

export const CANAL = ["wa", "ig", "fb"] as const;
export type Canal = (typeof CANAL)[number];

export const DIRECTION = ["in", "out"] as const;
export type Direction = (typeof DIRECTION)[number];

export const SENDER = ["lead", "ia", "humano", "sistema"] as const;
export type Sender = (typeof SENDER)[number];

/** Campos del Twin que una persona puede corregir a mano, escribiendo texto. */
export const CAMPOS_TWIN_EDITABLES = [
  "consulta",
  "codigo_interno",
  "precio_cotizado",
  "cantidad",
  "bloqueador",
] as const;
export type CampoTwinEditable = (typeof CAMPOS_TWIN_EDITABLES)[number];

/**
 * Campos cuya autoría se anota en `lead_session.procedencia` y que, por eso, el
 * extractor no vuelve a pisar cuando los tocó una persona.
 *
 * Es `CAMPOS_TWIN_EDITABLES` más `current_stage`. La etapa no entra en aquella
 * lista porque esa gobierna el lápiz de texto libre —y el `valor` que viaja por
 * ahí es un string arbitrario: meterla ahí dejaría que un cliente mandara
 * cualquier cosa a una columna que es un enum—. La etapa se mueve solo desde el
 * rail, que ofrece las seis del embudo y nada más.
 */
export const CAMPOS_CON_PROCEDENCIA = [...CAMPOS_TWIN_EDITABLES, "current_stage"] as const;
export type CampoConProcedencia = (typeof CAMPOS_CON_PROCEDENCIA)[number];

/**
 * Escalones de entrega que reporta Meta para un mensaje saliente. `null` en la
 * entidad significa entrante, o saliente cuyo webhook de status no llegó.
 */
export const ESTADO_ENTREGA = ["enviado", "entregado", "leido", "fallido"] as const;
export type EstadoEntrega = (typeof ESTADO_ENTREGA)[number];

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

/**
 * Con qué etiqueta queda registrada cada llamada al modelo en `llm_usage`.
 *
 * No es un enum de la base a propósito: la columna es `text` para que un
 * workflow nuevo no exija una migración, y el historial sobreviva a que uno
 * deje de existir. Estas son las que hoy escribe el código, y las que la UI
 * sabe nombrar en castellano.
 */
export const WORKFLOW_LLM = {
  /** Agente vendedor en un turno real. Es el gasto que las reglas evitan. */
  agente: "ai-agent",
  /** Preview de una config candidata desde la consola: gasto de prueba, no de producción. */
  agentePreview: "agente-preview",
  clasificador: "intent-classifier",
  extractorTwin: "twin-extractor",
  resumidor: "conversation-summarizer",
  detectorBatch: "intent-batch-detector",
} as const;

export type WorkflowLlm = (typeof WORKFLOW_LLM)[keyof typeof WORKFLOW_LLM];
