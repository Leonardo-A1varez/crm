import { plegarTexto } from "@/lib/catalogo/plegar-texto";

/**
 * Pistones, chaquetas y anillos existen en varias sobremedidas (STD, 0.25, 0.50…)
 * y cotizar sin saber cuál es el error más caro del catálogo: el cliente recibe
 * una pieza que no entra (docs/catalogo/como-leer-el-catalogo.md §12.3).
 *
 * El agente ya tiene la regla en el prompt, pero un modelo chico la ignora y
 * lista los precios igual. Pegada al resultado de la herramienta se obedece
 * mucho más: es el mismo recurso que `Diferencias.instruccion`.
 */

const PIEZAS_CON_SOBREMEDIDA = /\b(piston(?:es)?|chaquetas?|anillos?)\b/;

export interface CandidatoConNombre {
  nombre: string;
  categoria?: string | null;
}

/**
 * El aviso para el agente si alguno de los candidatos es de los que dependen de
 * la sobremedida; `null` si no. Mira el nombre y la categoría, sin tildes.
 */
export function avisoSobremedida(candidatos: readonly CandidatoConNombre[]): string | null {
  const aplica = candidatos.some((c) =>
    PIEZAS_CON_SOBREMEDIDA.test(plegarTexto(`${c.nombre} ${c.categoria ?? ""}`)),
  );
  if (!aplica) return null;
  return (
    "Estas piezas (pistones, chaquetas o anillos) existen en varias sobremedidas (STD, 0.25, 0.50…). " +
    "No cotices hasta que el cliente diga la sobremedida; si no la sabe, " +
    "preguntale si el motor fue rectificado y a cuánto."
  );
}
