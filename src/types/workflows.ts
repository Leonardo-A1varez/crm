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

export const NODO_TIPOS = ["disparador", "accion", "condicion", "espera", "fin"] as const;
export type NodoTipo = (typeof NODO_TIPOS)[number];

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
    }
  | { tipo: "fin" }
  | { tipo: "fallado"; nodoId: string; error: string };

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
