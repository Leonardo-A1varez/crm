/**
 * Medidas y motion del editor de workflows.
 *
 * Está en un módulo propio y no repartido en cada componente por dos razones
 * concretas, no por gusto:
 *
 *  1. **La escala es de 2 px.** Todo valor de espaciado, alto y ancho de este
 *     editor es par. El prototipo venía con 7, 9 y 11 px sueltos; acá se
 *     redondean a 8, 10 y 12. Tener los números en un solo archivo es lo que
 *     permite revisarlo de un vistazo en vez de auditar 20 componentes.
 *  2. **No hay librería de animación en el proyecto** (no está `motion/react`
 *     ni `framer-motion` en `package.json`), así que el motion es CSS puro.
 *
 * El motion y el foco ya no se definen acá: viven en `@/lib/ui/motion` desde
 * que el constructor de condiciones se compartió con Difusión, y este módulo
 * los re-exporta para que los componentes del editor sigan importando de un
 * solo lugar. Lo que queda propio son las medidas del lienzo y el área de
 * toque extendida, que no aplican fuera de esta pantalla.
 */

export { CURVA, DURACION, FOCO, PRESION_TACTIL, TRANSICION_CONTROL } from "@/lib/ui/motion";

/**
 * Medidas del layout. En píxeles, todas pares.
 *
 * `NODO_ANCHO` coincide con el `w-[200px]` del `NodoBase` que mantiene el otro
 * agente. No es casualidad ni hay que "arreglarlo": el lienzo del diff y el de
 * la corrida dibujan los mismos nodos que el editor, y si divergen el diff
 * mostraría cada nodo como movido.
 */
export const MEDIDAS = {
  /** Alto de la barra superior de las cuatro pantallas. */
  BARRA: 52,
  /** Paleta de bloques, panel izquierdo del editor. */
  PALETA: 240,
  /** Panel de configuración del editor. */
  PANEL_CONFIG: 320,
  /** Panel del constructor de condiciones: tres selectores + anidado no entran en 320. */
  PANEL_CONDICION: 400,
  /** Panel del diff y de la corrida: lista de cambios o de pasos. */
  PANEL_LATERAL: 360,
  /** Ancho fijo de un nodo en el lienzo. */
  NODO_ANCHO: 200,
  /** Alto del encabezado de un nodo. */
  NODO_HEADER: 32,
  /** Lado del minimapa. */
  MINIMAPA_ANCHO: 152,
  MINIMAPA_ALTO: 96,
} as const;

/**
 * Área de toque mínima de un control chico.
 *
 * Los controles del lienzo (zoom, encuadrar) son íconos de 16 px dentro de una
 * caja de 28 px, que queda por debajo de los 40 px recomendados. En vez de
 * agrandar la caja visible —arruinaría la densidad del lienzo— se extiende el
 * área con un pseudo-elemento. La caja se ve de 28 y se clickea como de 40.
 *
 * Los controles que usan esto no pueden quedar pegados: 12 px de separación
 * mínima entre dos, o las áreas extendidas se pisan y el clic cae en el
 * vecino.
 */
export const AREA_EXTENDIDA =
  "relative after:absolute after:top-1/2 after:left-1/2 after:h-10 after:w-10 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']";
