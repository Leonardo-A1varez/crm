import { formatearEntero, formatearPorcentaje, formatearUsd } from "@/lib/ui/metricas";

/**
 * Formato de los números de Difusión. Se apoya en `lib/ui/metricas` para no
 * tener dos maneras distintas de escribir un entero en la misma app.
 */
export { formatearEntero, formatearPorcentaje, formatearUsd };

/** Escalón de Meta con su unidad: `2.000/día`, o `ilimitado`. */
export function formatearEscalon(n: number | "ilimitado"): string {
  return n === "ilimitado" ? "ilimitado" : `${formatearEntero(n)}/día`;
}

/**
 * Signo delante del número para las listas de exclusión: `−412`. Es el menos
 * tipográfico U+2212, no el guion del teclado: alineado con las cifras y del
 * mismo ancho en una fuente tabular.
 */
export function formatearResta(n: number): string {
  return `−${formatearEntero(n)}`;
}
