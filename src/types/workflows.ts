/**
 * El grafo de un workflow. Vive en `workflow_versiones.grafo` como jsonb.
 *
 * Las aristas referencian **IDs de nodo**, nunca índices posicionales. Es la
 * diferencia central con el Salesbot de Kommo, cuyo `goto: { step: 3 }` apunta
 * a una posición: insertar un paso al medio corre todos los índices y cada
 * salto queda apuntando al lugar equivocado, en silencio.
 */
export interface Grafo {
  nodos: Nodo[];
  aristas: Arista[];
}

export interface Nodo {
  /** Estable y único dentro del grafo. Las aristas apuntan acá. */
  id: string;
  tipo: NodoTipo;
  /**
   * Configuración específica del tipo. W1 la trata como objeto opaco: qué
   * disparadores y qué acciones existen lo define W3, y validarla ahora sería
   * inventar un catálogo que todavía no se diseñó.
   */
  config: Record<string, unknown>;
  /** Sólo para el canvas de W5. El motor la ignora. */
  posicion: { x: number; y: number };
}

export interface Arista {
  desde: string;
  hasta: string;
  /** Cuál salida del nodo origen. Un `condicion` tiene dos; el resto, una. */
  puerto: Puerto;
}

// Tipos de nodo legacy (compatibilidad hacia atrás)
export const NODO_TIPOS_LEGACY = ["disparador", "accion", "condicion", "espera", "fin"] as const;

// Triggers (11 tipos)
export const NODO_TIPOS_TRIGGER = [
  "trigger_mensaje",
  "trigger_webhook",
  "trigger_cron",
  "trigger_manual",
  "trigger_etiqueta",
  "trigger_etiqueta_removida",
  "trigger_etapa",
  "trigger_lead_creado",
  "trigger_vendedor_asignado",
  "trigger_inactividad",
  "trigger_formulario",
] as const;

// Mensajería (8 tipos)
export const NODO_TIPOS_MENSAJERIA = [
  "msg_texto",
  "msg_botones",
  "msg_lista",
  "msg_imagen",
  "msg_documento",
  "msg_ubicacion",
  "msg_plantilla",
  "msg_reaccion",
] as const;

// CRM (10 tipos)
export const NODO_TIPOS_CRM = [
  "crm_etiqueta_add",
  "crm_etiqueta_remove",
  "crm_etapa",
  "crm_vendedor",
  "crm_round_robin",
  "crm_campo",
  "crm_tarea",
  "crm_nota",
  "crm_spam",
  "crm_archivar",
] as const;

// Lógica (11 tipos)
export const NODO_TIPOS_LOGICA = [
  "logica_condicion",
  "logica_switch",
  "logica_validacion",
  "logica_esperar",
  "logica_esperar_respuesta",
  "logica_esperar_evento",
  "logica_loop",
  "logica_grupo",
  "logica_goto",
  "logica_detener",
  "logica_error",
] as const;

// Integraciones (6 tipos)
export const NODO_TIPOS_INTEGRACION = [
  "int_http",
  "int_webhook_out",
  "int_codigo",
  "int_email",
  "int_sheets",
  "int_db",
] as const;

// IA (7 tipos)
export const NODO_TIPOS_IA = [
  "ia_clasificar",
  "ia_responder",
  "ia_extraer",
  "ia_sentimiento",
  "ia_resumir",
  "ia_traducir",
  "ia_spam",
] as const;

// Internos (4 tipos)
export const NODO_TIPOS_INTERNO = [
  "int_notif_vendedor",
  "int_notif_grupo",
  "int_comentario",
  "int_debug",
] as const;

// Todos los tipos de nodo (57 + 5 legacy)
export const NODO_TIPOS = [
  ...NODO_TIPOS_LEGACY,
  ...NODO_TIPOS_TRIGGER,
  ...NODO_TIPOS_MENSAJERIA,
  ...NODO_TIPOS_CRM,
  ...NODO_TIPOS_LOGICA,
  ...NODO_TIPOS_INTEGRACION,
  ...NODO_TIPOS_IA,
  ...NODO_TIPOS_INTERNO,
] as const;

export type NodoTipo = (typeof NODO_TIPOS)[number];
export type NodoTipoTrigger = (typeof NODO_TIPOS_TRIGGER)[number];
export type NodoTipoMensajeria = (typeof NODO_TIPOS_MENSAJERIA)[number];
export type NodoTipoCRM = (typeof NODO_TIPOS_CRM)[number];
export type NodoTipoLogica = (typeof NODO_TIPOS_LOGICA)[number];
export type NodoTipoIntegracion = (typeof NODO_TIPOS_INTEGRACION)[number];
export type NodoTipoIA = (typeof NODO_TIPOS_IA)[number];
export type NodoTipoInterno = (typeof NODO_TIPOS_INTERNO)[number];

/** Categoría de un nodo, para asignar estilos visuales */
export type CategoriaVisual =
  | "trigger"
  | "mensajeria"
  | "crm"
  | "logica"
  | "integracion"
  | "ia"
  | "interno";

/** Devuelve la categoría visual de un tipo de nodo */
export function categoriaDeTipo(tipo: NodoTipo): CategoriaVisual | null {
  if ((NODO_TIPOS_TRIGGER as readonly string[]).includes(tipo)) return "trigger";
  if ((NODO_TIPOS_MENSAJERIA as readonly string[]).includes(tipo)) return "mensajeria";
  if ((NODO_TIPOS_CRM as readonly string[]).includes(tipo)) return "crm";
  if ((NODO_TIPOS_LOGICA as readonly string[]).includes(tipo)) return "logica";
  if ((NODO_TIPOS_INTEGRACION as readonly string[]).includes(tipo)) return "integracion";
  if ((NODO_TIPOS_IA as readonly string[]).includes(tipo)) return "ia";
  if ((NODO_TIPOS_INTERNO as readonly string[]).includes(tipo)) return "interno";
  return null; // Legacy types
}

/**
 * Clasificadores de tipo compartidos entre el validador (`validar-grafo.ts`,
 * `validar-workflow.ts`) y el motor (`engine/ejecutar-workflow.ts`).
 *
 * El canvas visual persiste `Nodo.tipo` tal cual sale de la paleta —
 * "trigger_manual", "logica_condicion", etc. — nunca lo normaliza a los 5
 * tipos legacy. Comparar contra un solo literal (`tipo === "disparador"`)
 * reconoce únicamente grafos armados antes del catálogo de 57 tipos.
 */
export function esTrigger(tipo: NodoTipo): boolean {
  return tipo === "disparador" || (NODO_TIPOS_TRIGGER as readonly string[]).includes(tipo);
}

/** Únicos tipos con dos puertos de salida (`verdadero`/`falso`). */
export function esCondicion(tipo: NodoTipo): boolean {
  return tipo === "condicion" || tipo === "logica_condicion";
}

/** Cortan el segmento y programan una reanudación — cuentan como "espera" para `ciclo_sin_espera`. */
export function esEspera(tipo: NodoTipo): boolean {
  return (
    tipo === "espera" ||
    tipo === "logica_esperar" ||
    tipo === "logica_esperar_respuesta" ||
    tipo === "logica_esperar_evento"
  );
}

/** Nodos terminales: no tienen ningún puerto de salida. */
export function esFinal(tipo: NodoTipo): boolean {
  return tipo === "fin" || tipo === "logica_detener";
}

export const PUERTOS = ["salida", "verdadero", "falso"] as const;
export type Puerto = (typeof PUERTOS)[number];

export const REGLAS_VALIDACION = [
  "disparador_unico",
  "disparador_sin_entrantes",
  "nodo_inalcanzable",
  "salida_sin_conectar",
  "arista_a_nodo_inexistente",
  "condicion_puertos",
  "ciclo_sin_espera",
] as const;
export type ReglaValidacion = (typeof REGLAS_VALIDACION)[number];

export interface ProblemaGrafo {
  regla: ReglaValidacion;
  /** Nodos involucrados, para que el canvas de W5 los pueda pintar en rojo. */
  nodos: string[];
  mensaje: string;
}

/**
 * Por qué falló un segmento. Task 10 (el step de Inngest) lo usa para decidir
 * si reintenta: comparar contra este enum en vez de contra el texto de
 * `error` es lo que sobrevive a un reword del mensaje.
 */
export const MOTIVOS_FALLO = [
  "tope_pasos",
  "grafo_invalido",
  "condicion_invalida",
  "accion_fallo",
] as const;
export type MotivoFallo = (typeof MOTIVOS_FALLO)[number];

/** Lo que el ejecutor le devuelve a quien lo llamó al terminar un segmento. */
export type ResultadoSegmento =
  | {
      tipo: "espera";
      /** El nodo donde se cortó. Para la observabilidad de W4. */
      nodoId: string;
      hasta: Date;
      /**
       * Con qué nodo arranca el segmento siguiente. NO siempre es el que sigue:
       * un nodo `espera` reanuda en el que le sigue, pero una acción diferida
       * (fuera de horario) reanuda en SÍ MISMA, porque todavía no se ejecutó.
       * Lo resuelve el ejecutor y no quien llama, así la regla vive en un solo
       * lado en vez de repetirse en el runtime y en el simulador.
       */
      reanudarEn: string;
      /**
       * El contexto de la corrida al cortar el segmento -- con los merges de
       * cada acción ya aplicados (ver `ResultadoAccion.contexto`). Task 10
       * (el wiring a Inngest) lo necesita para persistir `workflow_runs.contexto`
       * en `runs.esperar()`: sin esto, el segmento siguiente arrancaría con el
       * contexto de ANTES de esta corrida en vez del real. `fin` y `fallado`
       * no lo llevan porque `terminar()`/`fallar()` no reciben contexto -- la
       * corrida terminó, nadie va a reanudarla.
       */
      contexto: ContextoRun;
    }
  | { tipo: "fin" }
  | {
      tipo: "fallado";
      nodoId: string;
      /** Legible por una persona. Se persiste para mostrarlo en la UI. */
      error: string;
      motivo: MotivoFallo;
      /**
       * Si reintentar el segmento tiene sentido. Sólo `accion_fallo` puede dar
       * `true`: se calcula con `isNonRetriable()` (`src/lib/errors.ts`) sobre
       * el error crudo ANTES de aplanarlo a `error: string`, porque una vez
       * aplanado el tipo de dominio ya no existe. Todo lo demás (tope de
       * pasos, grafo mal formado, condición mal configurada) es un bug de
       * datos, no una falla transitoria: reintentarlo repite el mismo error.
       */
      retriable: boolean;
    };

/** El estado que viaja entre nodos y se persiste en `workflow_runs.contexto`. */
export type ContextoRun = Record<string, unknown>;

/** Lo que devuelve una acción: por dónde seguir y qué agregar al contexto. */
export interface ResultadoAccion {
  /** Sólo `condicion` usa `verdadero`/`falso`. El resto devuelve `salida`. */
  puerto: Puerto;
  /** Se mergea sobre el contexto de la corrida. */
  contexto?: ContextoRun;
  /** Queda en `workflow_run_pasos.salida` para la observabilidad de W4. */
  salida?: Record<string, unknown>;
  /**
   * "Todavía no, volvé a intentarme a esta hora." La acción NO se ejecutó y el
   * ejecutor corta el segmento reanudando en este mismo nodo. Lo usa
   * `enviar_mensaje` fuera del horario de atención: el mensaje sale igual, a
   * una hora razonable, en vez de descartarse en silencio.
   */
  diferirHasta?: Date;
}
