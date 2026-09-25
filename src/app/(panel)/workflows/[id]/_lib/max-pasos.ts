/**
 * El tope de pasos por corrida: cuántos bloques puede recorrer una corrida
 * antes de que el motor la corte. Es la red contra un ciclo mal armado (PRD
 * §6.2); una corrida que lo alcanza falla con motivo `tope_pasos`.
 *
 * `MIN` y `MAX` son los de `GuardarVersionSchema.maxPasos`
 * (`src/lib/validation/workflows.schema.ts`): `max-pasos.test.ts` compara uno
 * contra el otro, para que el campo no acepte algo que "Guardar" rebota.
 * `POR_DEFECTO` es el `default` de la columna `workflow_versiones.max_pasos`
 * en `supabase/migrations/20260822044955_workflows_grafo.sql`.
 */
export const TOPE_PASOS = { MIN: 1, MAX: 500, POR_DEFECTO: 500 } as const;

export type LecturaTopePasos = { ok: true; valor: number } | { ok: false; error: string };

/**
 * Lee el texto del campo. Sólo dígitos: `1.5`, `1e2` o `-3` los aceptaría
 * `Number()` a su manera, y un tope que el campo "entendió" distinto de lo que
 * se tipeó es peor que un error.
 */
export function leerTopePasos(texto: string): LecturaTopePasos {
  const limpio = texto.trim();
  if (/^\d+$/.test(limpio)) {
    const valor = Number(limpio);
    if (valor >= TOPE_PASOS.MIN && valor <= TOPE_PASOS.MAX) return { ok: true, valor };
  }
  return {
    ok: false,
    error: `Poné un número entero entre ${TOPE_PASOS.MIN} y ${TOPE_PASOS.MAX}.`,
  };
}
