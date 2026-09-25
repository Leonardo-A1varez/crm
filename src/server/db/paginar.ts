import { IllegalStateError } from "@/lib/errors";
import { mapPostgrestError, type PostgrestErrorLike } from "./postgrest-errors";

/**
 * PostgREST corta en `max_rows` filas —1.000 en `supabase/config.toml` y en
 * Supabase Cloud— y no avisa (AGENTS.md, lección 12). Las páginas se piden de
 * ese tamaño: si se pidieran más grandes, el servidor igual devolvería 1.000 y
 * "página incompleta = última" cortaría la lectura en la primera.
 *
 * Si alguna vez se baja `max_rows` en el proyecto, este número tiene que bajar
 * con él: una página recortada por el servidor se leería como la última.
 */
export const FILAS_POR_PAGINA = 1000;

export interface PaginaPostgrest<T> {
  data: T[] | null;
  error: PostgrestErrorLike | null;
}

/**
 * Lee todas las filas de una consulta, página por página, por keyset: cada
 * página pide `clave > última clave vista`, ordenada por esa clave. A
 * diferencia de un `offset`, una fila que entra o sale entre dos páginas no
 * hace saltear ni repetir otras. Corta cuando una página vuelve incompleta.
 *
 * `pagina` arma la consulta: aplica `.gt(columna, despuesDe)` cuando
 * `despuesDe` no es null, ordena por esa columna ascendente y pone
 * `.limit(tamanio)`. `clave` saca de cada fila el valor de esa columna, que
 * tiene que ser único dentro del resultado —el `id`, casi siempre—.
 */
export async function leerPorKeyset<T>(opciones: {
  recurso: string;
  clave: (fila: T) => string;
  pagina: (despuesDe: string | null, tamanio: number) => PromiseLike<PaginaPostgrest<T>>;
}): Promise<T[]> {
  const out: T[] = [];
  let despuesDe: string | null = null;
  for (;;) {
    const { data, error } = await opciones.pagina(despuesDe, FILAS_POR_PAGINA);
    if (error) throw mapPostgrestError(error, { resource: opciones.recurso });
    const filas = data ?? [];
    out.push(...filas);
    const ultima = filas.at(-1);
    if (filas.length < FILAS_POR_PAGINA || ultima === undefined) return out;
    const siguiente = opciones.clave(ultima);
    // Una consulta sin el `.gt()` o sin el orden devolvería la misma página
    // otra vez: se corta en vez de pedirla para siempre.
    if (despuesDe !== null && siguiente <= despuesDe) {
      throw new IllegalStateError(
        `la lectura paginada de ${opciones.recurso} no avanzó el cursor`,
        "keyset_sin_avance",
      );
    }
    despuesDe = siguiente;
  }
}
