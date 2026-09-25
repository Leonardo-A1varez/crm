import { ValidationError } from "@/lib/errors";

/**
 * PostgREST corta en 1.000 filas y no avisa (AGENTS.md, lección 12): una
 * lectura sin límite explícito miente sobre el total en cuanto la tabla crece.
 * Toda lectura paginada lleva un límite explícito, acotado a lo que PostgREST
 * devuelve de verdad.
 */
export const LIMITE_MAX_PAGINA = 1000;

export function exigirPagina(limite: number, desde = 0): void {
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAX_PAGINA) {
    throw new ValidationError(
      `limite tiene que ser un entero entre 1 y ${LIMITE_MAX_PAGINA} (llegó ${limite})`,
    );
  }
  if (!Number.isInteger(desde) || desde < 0) {
    throw new ValidationError(`desde tiene que ser un entero ≥ 0 (llegó ${desde})`);
  }
}
