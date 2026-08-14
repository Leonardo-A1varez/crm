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
 * Motivo por el que una conversación cae en "Requieren tu atención". El orden
 * del array ES el orden de prioridad de la bandeja. No se persiste: se
 * recalcula a partir de la sesión (ver `lib/triage`).
 *
 * `seguimiento` va último de los cuatro y no es un descuido: los tres primeros
 * son cosas que están pasando ahora —alguien pidió una persona, algo la traba,
 * un pago sin comprobante— y `seguimiento` es una cita que nos pusimos nosotros.
 * Importa que aparezca, no que desplace a un cliente que está esperando.
 */
export const MOTIVO_TRIAGE = ["humano", "bloqueo", "pago", "seguimiento"] as const;
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

/**
 * Ciclo de vida de un recordatorio de seguimiento ("volver a contactar en 2
 * días").
 *
 * `avisado` es el estado que enciende el chip en el Inbox: lo escribe el
 * workflow de Inngest cuando se despierta, y es lo único que hace al
 * dispararse. **No se le manda nada al cliente**; para eso está la
 * reactivación, que es otra cosa y tiene su propio cooldown.
 *
 * No hay estado terminal "atendido": el recordatorio deja de molestar cuando lo
 * cancelan a mano o cuando el cliente escribe, y las dos cosas caen en
 * `cancelado`. Un tercer estado obligaría al vendedor a marcar como leído algo
 * que ya resolvió contestando.
 */
export const ESTADO_RECORDATORIO = ["pendiente", "avisado", "cancelado"] as const;
export type EstadoRecordatorio = (typeof ESTADO_RECORDATORIO)[number];

/**
 * Por qué se apagó un recordatorio. `respondio` es el caso que hace que el
 * seguimiento tenga sentido: el recordatorio existe porque el cliente se quedó
 * callado, así que en cuanto escribe deja de hacer falta.
 */
export const MOTIVO_CANCELACION_RECORDATORIO = ["manual", "respondio"] as const;
export type MotivoCancelacionRecordatorio = (typeof MOTIVO_CANCELACION_RECORDATORIO)[number];

export const TAG_SOURCE = ["manual", "workflow"] as const;
export type TagSource = (typeof TAG_SOURCE)[number];

/**
 * Los datos que identifican a una persona y que no es normal tener repetidos.
 *
 * Son la base del detector de duplicados: dos leads que comparten uno son casi
 * seguro la misma persona. El nombre NO está acá a propósito — hay cientos de
 * "Carlos Gómez" y proponerlos como duplicados es ruido.
 */
export const IDENTIFICADOR_TIPO = ["telefono", "email", "ruc", "placa", "vin"] as const;
export type IdentificadorTipo = (typeof IDENTIFICADOR_TIPO)[number];

/**
 * Cuánta certeza da compartir cada tipo, de 0 a 1.
 *
 * El VIN identifica un auto único en el mundo y el RUC una empresa registrada:
 * compartirlos no admite coincidencia. Un correo se comparte más seguido
 * —cuentas de trabajo, familiares— así que pesa menos.
 */
export const CERTEZA_IDENTIFICADOR: Record<IdentificadorTipo, number> = {
  vin: 1,
  ruc: 1,
  placa: 0.95,
  telefono: 0.9,
  email: 0.85,
};

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
