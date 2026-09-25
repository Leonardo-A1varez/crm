/**
 * El constructor de condiciones compartido.
 *
 * La caja recursiva con el operador del grupo, los chips repetidos, el tope de
 * anidado y los editores de valor por tipo. El modelo del árbol —y las
 * funciones puras que lo recorren— vive en `@/lib/ui/condiciones`, para que la
 * validación de un árbol que llega de la base no tenga que importar React.
 *
 * Lo que NO está acá, a propósito, porque cambia según la pantalla:
 *
 *   · el catálogo de campos y el vocabulario de sus comparadores;
 *   · el contador de resultados, que en un workflow cuenta a cuántos leads
 *     alcanza una bifurcación y en una difusión cuenta el tamaño del padrón;
 *   · las exclusiones con motivo, que sólo existen en Difusión.
 */

export { ConstructorCondiciones, type ConstructorCondicionesProps } from "./ConstructorCondiciones";
