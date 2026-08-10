"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Cierra un popover cuando el click cae afuera o cuando se aprieta `Escape`.
 *
 * Dos trampas que este hook evita, y que son la razón de que exista en vez de
 * un `onBlur` en cada componente:
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

    const alApuntar = (e: PointerEvent) => {
      const destino = e.target;
      if (destino instanceof Node && ref.current?.contains(destino)) return;
      alCerrar.current();
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") alCerrar.current();
    };

    document.addEventListener("pointerdown", alApuntar);
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.removeEventListener("pointerdown", alApuntar);
      document.removeEventListener("keydown", alTeclear);
    };
  }, [abierto, ref]);
}
