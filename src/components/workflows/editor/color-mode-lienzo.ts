"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import type { ColorMode } from "@xyflow/react";

/**
 * El `colorMode` de React Flow, atado al tema de la app.
 *
 * React Flow tiene su propio tema: si no se le pasa nada queda en `light` y
 * pone la clase `.light` en su raíz, que trae fondo, controles y minimapa
 * claros dentro del panel oscuro. `system` tampoco sirve: mira el sistema
 * operativo, y la app no lo sigue (`ThemeProvider` usa `enableSystem={false}`).
 *
 * Los colores del lienzo salen de los tokens de `globals.css` (bloque
 * `.react-flow` que redefine las `--xy-*`), así que esto no pinta: sólo deja
 * la clase de React Flow coherente con el tema, para lo que no se redefine.
 */
export function colorModeDelTema(tema: string | undefined, montado: boolean): ColorMode {
  // En el server y en la hidratación no hay tema resuelto. El default de la
  // app es oscuro (`ThemeProvider`), y adivinar lo mismo que el server evita
  // un desajuste de hidratación en la clase de la raíz.
  if (!montado) return "dark";
  return tema === "light" ? "light" : "dark";
}

const suscribirNada = () => () => {};

export function useColorModeLienzo(): ColorMode {
  const { resolvedTheme } = useTheme();
  const montado = useSyncExternalStore(
    suscribirNada,
    () => true,
    () => false,
  );
  return colorModeDelTema(resolvedTheme, montado);
}
