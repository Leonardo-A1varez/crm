/**
 * Espejo EXACTO de `public.plegar_texto` (migración 20260815140000): minúsculas
 * y sin tildes, con el mismo alfabeto de `translate(lower(t), 'áéíóúüñ…', …)`.
 *
 * No es `plegar` de `busqueda-hilo.ts`: esa quita cualquier marca diacrítica
 * (`ç` → `c`) y ésta solo las seis vocales con tilde y la eñe, igual que el SQL.
 * Si divergen, el filtro in-memory y el de Postgres dan resultados distintos
 * con el mismo texto y la suite no se entera.
 */
const DE = "áéíóúüñÁÉÍÓÚÜÑ";
const A = "aeiouunaeiouun";

export function plegarTexto(t: string): string {
  let out = "";
  for (const c of t.toLowerCase()) {
    const i = DE.indexOf(c);
    out += i === -1 ? c : A[i];
  }
  return out;
}
