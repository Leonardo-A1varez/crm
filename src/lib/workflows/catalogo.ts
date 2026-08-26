/**
 * El vocabulario de un workflow: qué lo dispara y qué puede hacer.
 *
 * Vive en `lib/` porque lo necesitan dos lados que no se pueden ver entre sí:
 * el motor (`inngest/**`, `server/**`) y la pantalla que arma los flujos
 * (`components/**`, que por boundaries no puede importar ninguno de los dos).
 *
 * `Nodo.config` sigue siendo `Record<string, unknown>` en el dominio a
 * propósito —el motor la trata como opaca— pero la UI necesita ofrecer opciones
 * concretas en vez de un campo de texto libre donde cualquier typo se descubre
 * en producción con un `accion_desconocida`.
 */

/**
 * Los eventos de dominio que arrancan una corrida.
 *
 * Los emite `workflow-disparar`, que busca las versiones publicadas cuyo nodo
 * disparador matchea. Agregar uno acá no lo hace existir: hay que emitirlo.
 */
export const DISPARADORES = ["mensaje_recibido", "etiqueta_asignada", "etapa_cambiada"] as const;
export type DisparadorWorkflow = (typeof DISPARADORES)[number];

/**
 * Las acciones que el motor sabe ejecutar.
 *
 * **El registro real se arma en `src/inngest/bootstrap.ts`** con
 * `crearRegistro({...crearAccionesInternas(...), enviar_mensaje: ...})`. Esta
 * lista es la que ve la UI. Si se agrega un handler allá y no acá, la pantalla
 * no lo ofrece; si se agrega acá y no allá, el motor tira `accion_desconocida`
 * en la corrida. Las dos tienen que moverse juntas.
 */
export const ACCIONES = [
  "enviar_mensaje",
  "poner_etiqueta",
  "cambiar_etapa",
  "escalar_a_humano",
] as const;
export type AccionWorkflow = (typeof ACCIONES)[number];

/** Cómo se nombra cada cosa en pantalla. */
export const ETIQUETA_DISPARADOR: Record<DisparadorWorkflow, string> = {
  mensaje_recibido: "Llega un mensaje",
  etiqueta_asignada: "Se le pone una etiqueta",
  etapa_cambiada: "Cambia de etapa",
};

export const ETIQUETA_ACCION: Record<AccionWorkflow, string> = {
  enviar_mensaje: "Enviar un mensaje",
  poner_etiqueta: "Poner una etiqueta",
  cambiar_etapa: "Cambiar la etapa",
  escalar_a_humano: "Pasar a un vendedor",
};

export const ETIQUETA_NODO: Record<string, string> = {
  disparador: "Disparador",
  accion: "Acción",
  condicion: "Condición",
  espera: "Espera",
  fin: "Fin",
};

export const ETIQUETA_PUERTO: Record<string, string> = {
  salida: "sigue",
  verdadero: "si se cumple",
  falso: "si no se cumple",
};
