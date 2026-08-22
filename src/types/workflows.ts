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
