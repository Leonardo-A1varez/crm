"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Los contenedores de los popovers abiertos en este momento.
 *
 * Existe para que `Escape` cierre **uno solo** cuando hay popovers anidados.
 * Cada instancia del hook pone un listener de `keydown` en `document`, así que
 * no hay propagación que frenar —los listeners son hermanos, no padre e hijo—:
 * un `stopPropagation` en cualquiera de ellos no impide que el otro corra.
 *
 * La regla es "cierra el más interno". Se decide por contención del DOM y no
 * por orden de apertura: el orden en que corren los efectos de React es
 * hijo→padre en el montaje, con lo cual una pila daría vuelta la respuesta
 * justo en el caso de un anidado que nace abierto. `contains` describe el
 * anidamiento que se ve en pantalla, que es de lo que habla la regla.
 */
const abiertos = new Set<HTMLElement>();

/**
 * `true` si algún otro popover abierto está dentro de éste: entonces el
 * `Escape` es del otro y éste no se tiene que cerrar todavía.
 */
function tieneAnidadoAbierto(propio: HTMLElement): boolean {
  for (const otro of abiertos) {
    if (otro !== propio && propio.contains(otro)) return true;
  }
  return false;
}

/**
 * Cierra un popover cuando el click cae afuera o cuando se aprieta `Escape`.
 *
 * Con popovers anidados —el selector de etiquetas dentro del buscador del
 * Inbox, los del Twin— el primer `Escape` cierra solo el de adentro y el
 * segundo el de afuera. Ver `abiertos`.
 *
 * Dos trampas más que este hook evita, y que son la razón de que exista en vez
 * de un `onBlur` en cada componente:
 *
 * 1. **`pointerdown` y no `click`.** React despacha sus handlers durante la
 *    propagación del click hasta el root, y descarga el `setState` antes de que
 *    ese mismo evento termine de subir a `document`. Con un listener de `click`,
 *    el efecto lo engancharía a tiempo para recibir el click que acaba de abrir
 *    el popover y lo cerraría en el acto: abrir sería un parpadeo.
 * 2. **`contains` contra el contenedor.** Sin la guarda, tipear en el input o
 *    elegir del `<select>` de adentro contaría como "click afuera". El `ref` va
 *    al elemento que envuelve todo lo que el popover considera suyo.
 *
 * El callback se lee de un `ref` para que una función nueva en cada render no
 * desenganche y reenganche los listeners en cada tecla que se escribe.
 */
export function useCerrarAlSalir(
  /** Solo escucha mientras está abierto: cerrado no hay nada que cerrar. */
  abierto: boolean,
  ref: RefObject<HTMLElement | null>,
  cerrar: () => void,
): void {
  const alCerrar = useRef(cerrar);
  useEffect(() => {
    alCerrar.current = cerrar;
  });

  useEffect(() => {
    if (!abierto) return;

    // El contenedor se registra mientras el popover está abierto. Sin `ref`
    // resuelto no hay forma de ubicarlo en el anidamiento y el hook se comporta
    // como antes: `Escape` lo cierra sin preguntar.
    const propio = ref.current;
    if (propio) abiertos.add(propio);

    const alApuntar = (e: PointerEvent) => {
      const destino = e.target;
      if (destino instanceof Node && ref.current?.contains(destino)) return;
      alCerrar.current();
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (propio && tieneAnidadoAbierto(propio)) return;
      alCerrar.current();
    };

    document.addEventListener("pointerdown", alApuntar);
    document.addEventListener("keydown", alTeclear);
    return () => {
      if (propio) abiertos.delete(propio);
      document.removeEventListener("pointerdown", alApuntar);
      document.removeEventListener("keydown", alTeclear);
    };
  }, [abierto, ref]);
}
