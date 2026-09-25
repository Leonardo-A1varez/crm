/**
 * Motion y foco compartidos por los controles densos del panel.
 *
 * Vivían en `components/workflows/editor/tokens-editor.ts`, que los sigue
 * re-exportando. Se mudaron acá cuando el constructor de condiciones pasó a ser
 * compartido: un componente de `components/shared/` no puede depender de la
 * carpeta de una pantalla, y duplicar la `cubic-bezier` en el otro lado es
 * exactamente cómo dos pantallas empiezan a moverse distinto.
 *
 * Las clases se escriben enteras y nunca se arman por interpolación
 * (`` `duration-${n}` ``): Tailwind escanea texto, y una clase construida en
 * runtime no existe en el CSS final.
 */

/**
 * Curvas de easing, como clases de Tailwind.
 *
 * `SALIDA` es un ease-out fuerte: arranca rápido, así que el primer frame ya
 * se ve moverse. Se usa para todo lo que entra o aparece. `MOVIMIENTO` es un
 * ease-in-out fuerte, para lo que se desplaza en pantalla sin entrar ni salir.
 * Las curvas nativas de CSS (`ease`, `ease-out`) son demasiado suaves y hacen
 * que la interfaz se sienta blanda.
 *
 * No hay curva de entrada (`ease-in`) a propósito: empieza lento justo en el
 * momento que la persona está mirando, y hace sentir lenta a la interfaz.
 */
export const CURVA = {
  SALIDA: "ease-[cubic-bezier(0.23,1,0.32,1)]",
  MOVIMIENTO: "ease-[cubic-bezier(0.77,0,0.175,1)]",
} as const;

/**
 * Duraciones. Todo lo que es respuesta a un clic queda debajo de 200 ms; nada
 * en estos paneles pasa de 240 ms.
 */
export const DURACION = {
  /** Feedback de presionar un control. */
  PRESION: "duration-150",
  /** Tooltips, popovers, chips de detalle. */
  FLOTANTE: "duration-150",
  /** Paneles, acordeones. */
  PANEL: "duration-200",
} as const;

/**
 * Transición estándar de un control presionable.
 *
 * Nunca `transition-all`: enumerar las propiedades es lo que evita que el
 * navegador anime cosas que no queríamos (un `height` que cambia por contenido,
 * por ejemplo) y lo que mantiene la animación en el compositor.
 */
export const TRANSICION_CONTROL = `transition-[transform,background-color,border-color,box-shadow,opacity] ${DURACION.PRESION} ${CURVA.SALIDA}`;

/**
 * Feedback táctil de un botón. `scale(0.97)` es suficiente para que se sienta
 * que la interfaz escuchó; más que eso se lee como un rebote.
 *
 * Va acompañado de `motion-reduce:active:scale-100` porque el movimiento es
 * decorativo: quien pidió menos movimiento no pierde nada de información si no
 * ocurre.
 */
export const PRESION_TACTIL = "active:scale-[0.97] motion-reduce:active:scale-100";

/**
 * Anillo de foco. Se declara acá y no en cada control porque estos paneles se
 * recorren con teclado más que la mayoría de las pantallas: el foco tiene que
 * verse igual en la paleta, en el nodo y en la fila de una condición.
 *
 * `focus-visible` y no `focus`: un control clickeado con el mouse no debe
 * quedar con anillo, sólo el que se alcanzó con el tabulador.
 */
export const FOCO =
  "outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel";
