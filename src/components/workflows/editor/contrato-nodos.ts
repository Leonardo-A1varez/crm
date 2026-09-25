/**
 * **Único punto de acoplamiento** entre el editor y el sistema visual de los
 * nodos, que mantiene otro stream en `@/lib/ui/workflow-nodos` y
 * `../canvas/nodos/NodoBase`.
 *
 * Los componentes de esta carpeta importan de acá y nunca de allá. Si el otro
 * stream renombra un export o le cambia la firma, rompe este archivo y nada
 * más: se adapta en un lugar en vez de en quince. Es la razón entera de que
 * exista un módulo que casi sólo re-exporta.
 *
 * ---
 *
 * ## Qué es de ellos y qué es mío
 *
 * `NodoBase` **ya dibuja la tarjeta entera**: chip de categoría, nombre,
 * resumen, etiqueta de estado, chips de puerto y los `Handle` de React Flow.
 * Este editor no vuelve a dibujar nada de eso. Lo único que agrega —en
 * `NodoConPuertos`— son dos afordancias que `NodoBase` no tiene porque no son
 * suyas:
 *
 *  - **la marca de severidad**, porque `EstadoNodo` es un valor y un nodo puede
 *    estar roto y desactualizado a la vez;
 *  - **el botón de borrar con previsualización de la costura**, que es un gesto
 *    del editor y no un estado del nodo.
 *
 * ## El desajuste de `sin_publicar`, y por qué no se arregla allá
 *
 * `EstadoNodo` tiene `error` y `stale`, que son dos de las tres severidades que
 * el editor pinta. La tercera —"editado, todavía no publicado"— **no está y no
 * debería estar**: `EstadoNodo` describe qué le pasó al nodo *al ejecutarse*, y
 * "sin publicar" no es un hecho de ejecución sino una diferencia contra otra
 * versión del grafo. Es información del editor, no del nodo. Por eso vive en
 * `./severidad` y se dibuja como marca superpuesta en vez de ensancharle el
 * enum a un módulo que no es de este stream.
 */

export {
  categoriaChipFondo,
  categoriaColor,
  categoriaDescripcion,
  categoriaLabel,
  clasesEtiquetaEstado,
  clasesPuerto,
  clasesTarjetaNodo,
  etiquetaEstado,
  posicionPuerto,
  tonoDePuerto,
  CATEGORIAS_NODO,
  ESTADOS_NODO,
  TONOS_PUERTO,
  type EstadoNodo,
  type EtiquetaEstado,
  type TonoPuerto,
} from "@/lib/ui/workflow-nodos";

export { NodoBase, Dato, type IconoNodo, type SalidaNodo } from "../canvas/nodos/NodoBase";

export type { CategoriaVisual } from "@/types/workflows";

import type { ReactNode } from "react";
import type { CategoriaVisual, Nodo } from "@/types/workflows";
import type { IconoNodo, SalidaNodo } from "../canvas/nodos/NodoBase";

/**
 * Cómo se presenta un nodo del dominio como tarjeta.
 *
 * Los tres lienzos —editor, diff y corrida— reciben `Nodo[]` del dominio, que
 * sólo tiene `id`, `tipo`, `config` y `posicion`. Convertir eso en "Enviar
 * mensaje / mensajería / ícono de sobre / «Hola nombre, gracias por…»" necesita
 * el catálogo de los 57 tipos, y **ningún componente de esta carpeta lo
 * importa**: lo recibe como función.
 *
 * No es purismo. El catálogo lo mantiene otro stream y cambia seguido; que los
 * lienzos dependan de su forma exacta convertiría cada tipo nuevo de nodo en un
 * cambio en tres pantallas. Además hace que estas pantallas se puedan montar
 * con datos armados a mano, sin catálogo.
 */
export interface PresentacionNodo {
  nombre: string;
  categoria: CategoriaVisual;
  icono?: IconoNodo;
  /** Prosa con los valores envueltos en `<Dato>`. Nunca JSON. */
  resumen?: ReactNode;
  salidas?: SalidaNodo[];
  /** `true` sólo en disparadores. */
  sinEntrada?: boolean;
}

export type ResolverNodo = (nodo: Nodo) => PresentacionNodo;
