/**
 * Patrón "contains" seguro para ilike dentro de .or() de PostgREST.
 * - Escapa wildcards LIKE (\ % _) para que el input sea substring literal.
 * - Encierra en comillas dobles (chars reservados del filter tree: , ( ) ),
 *   escapando \ y " del resultado anterior. Necesario: el des-escapado de
 *   comillas de PostgREST resuelve CUALQUIER \X → X (no solo \" y \\), así
 *   que un \ sin doblar introducido por el paso LIKE no sobrevive al viaje
 *   y % / _ vuelven a actuar como wildcard (verificado contra Supabase real).
 * Uso: query.or(`nombre.ilike.${ilikeContains(q)},codigo.ilike.${ilikeContains(q)}`)
 */
export function ilikeContains(q: string): string {
  const quoted = escaparLike(q).replace(/[\\"]/g, "\\$&");
  return `"%${quoted}%"`;
}

/**
 * Escapa los wildcards de LIKE (\ % _) para un `.ilike()` directo, donde el
 * valor viaja como parámetro y no atraviesa el árbol de filtros: ahí no hay
 * comillas que agregar ni des-escapado de PostgREST que compensar. Sin esto un
 * código con guion bajo —`FRE_1234`— matchearía cualquier carácter en su lugar.
 */
export function escaparLike(q: string): string {
  return q.replace(/[\\%_]/g, "\\$&");
}
