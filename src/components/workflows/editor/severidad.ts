/**
 * Las tres severidades que puede tener un nodo, y cómo se pintan.
 *
 * **Regla de producto: la severidad se muestra SIEMPRE sobre el nodo culpable,
 * nunca en un panel aparte.** Una lista de problemas al costado obliga a leer
 * "Enviar mensaje (n4): falta la plantilla", buscar cuál de los nodos es n4 y
 * recién ahí entender. El vendedor no tiene ID de nodo en la cabeza. El
 * problema se pinta donde está.
 *
 * Las tres son **ortogonales**: un mismo nodo puede tener un error, estar
 * desactualizado y además no estar publicado. Por eso `severidadesDeNodo`
 * devuelve una lista y no un valor.
 */

import type { EstadoNodo } from "./contrato-nodos";

/**
 * - `error` — el grafo no se puede publicar así. Falta un dato obligatorio, un
 *   puerto quedó sin conectar, el nodo es inalcanzable.
 * - `stale` — el nodo apunta a algo que cambió por debajo: una etiqueta que se
 *   borró, una plantilla que Meta pausó, un intent que ya no está en el
 *   catálogo. Publica igual, pero va a fallar en corrida.
 * - `sin_publicar` — se editó y la versión publicada todavía no lo tiene.
 *   No es un problema; es información de estado.
 */
export const SEVERIDADES = ["error", "stale", "sin_publicar"] as const;
export type Severidad = (typeof SEVERIDADES)[number];

/** Un problema concreto colgado de un nodo. */
export interface ProblemaNodo {
  severidad: Severidad;
  /** Qué pasa, en una línea, en el idioma del vendedor. */
  mensaje: string;
  /**
   * La regla del validador que lo produjo, cuando viene de ahí. Se muestra en
   * letra chica bajo el mensaje: le da al mensaje una procedencia verificable
   * en vez de dejarlo como una opinión de la interfaz.
   */
  regla?: string;
  /**
   * Arreglos de un clic. El globo del lienzo los ofrece como botones.
   * Sin esto un error rojo es un reproche; con esto es una tarea.
   */
  arreglos?: ArregloSugerido[];
}

export interface ArregloSugerido {
  /** Verbo en infinitivo, lo que va a pasar: "Elegir etiqueta", "Conectar a Detener". */
  etiqueta: string;
  onAplicar: () => void;
}

/**
 * Orden de gravedad, de más a menos. Se usa para elegir qué color lleva el
 * anillo del nodo cuando hay más de un problema.
 */
const ORDEN: Record<Severidad, number> = { error: 0, stale: 1, sin_publicar: 2 };

/** Las severidades presentes en una lista de problemas, sin repetir y ordenadas. */
export function severidadesDeNodo(problemas: readonly ProblemaNodo[]): Severidad[] {
  const vistas = new Set<Severidad>();
  for (const p of problemas) vistas.add(p.severidad);
  return [...vistas].sort((a, b) => ORDEN[a] - ORDEN[b]);
}

/** La más grave de la lista, o `null` si el nodo está limpio. */
export function severidadDominante(problemas: readonly ProblemaNodo[]): Severidad | null {
  return severidadesDeNodo(problemas)[0] ?? null;
}

/** Sólo `error` frena el botón de publicar. `stale` avisa; `sin_publicar` es el motivo de publicar. */
export function bloqueaPublicar(problemas: readonly ProblemaNodo[]): boolean {
  return problemas.some((p) => p.severidad === "error");
}

export const SEVERIDAD_LABEL: Record<Severidad, string> = {
  error: "Error",
  stale: "Desactualizado",
  sin_publicar: "Sin publicar",
};

/**
 * Qué significa cada color, en una línea. Va en el tooltip de la marca y en la
 * leyenda de la barra: el color solo nunca alcanza —hay gente que no distingue
 * rojo de ámbar— así que la marca lleva siempre texto asociado.
 */
export const SEVERIDAD_AYUDA: Record<Severidad, string> = {
  error: "No se puede publicar hasta resolverlo.",
  stale: "Apunta a algo que cambió por debajo. Publica, pero puede fallar al correr.",
  sin_publicar: "Editado en el borrador. La versión publicada todavía no lo tiene.",
};

/**
 * Clases del punto de la marca de severidad.
 *
 * Usa los tokens semánticos del proyecto (`danger`, `caution`, `info`), que ya
 * están calibrados a 4.5:1 en los dos temas. No se escriben hex acá: un hex
 * literal es estático y el tema claro quedaría ilegible.
 */
export const SEVERIDAD_PUNTO: Record<Severidad, string> = {
  error: "bg-danger",
  stale: "bg-caution",
  sin_publicar: "bg-info",
};

/** Clases del texto y del borde de un bloque de aviso de esta severidad. */
export const SEVERIDAD_TEXTO: Record<Severidad, string> = {
  error: "text-danger",
  stale: "text-caution",
  sin_publicar: "text-info",
};

/**
 * Puente entre la severidad del editor y el `EstadoNodo` del sistema visual.
 *
 * `NodoBase` ya pinta el borde de la tarjeta según su `estado`, así que el
 * editor **no dibuja un anillo propio**: le pasa el estado que corresponde y
 * deja que la tarjeta se pinte sola. Dos sistemas dibujando el borde del mismo
 * nodo terminan discrepando el día que uno de los dos cambie.
 *
 * `sin_publicar` mapea a `"normal"` a propósito: no es un estado de ejecución
 * y no le toca el borde a nadie. Se comunica sólo con la marca de severidad,
 * que es información del editor y se dibuja encima.
 */
export function estadoNodoDeSeveridad(problemas: readonly ProblemaNodo[]): EstadoNodo {
  const dominante = severidadDominante(problemas);
  if (dominante === "error") return "error";
  if (dominante === "stale") return "stale";
  return "normal";
}

/**
 * Fondo tenue para bloques de aviso. `color-mix` sobre el token en vez de un
 * hex propio: sigue al tema sin declarar una paleta paralela.
 */
export const SEVERIDAD_FONDO: Record<Severidad, string> = {
  error: "bg-danger/10 border-danger/30",
  stale: "bg-caution/10 border-caution/30",
  sin_publicar: "bg-info/10 border-info/30",
};
