/**
 * Búsqueda de las mini-pantallas de filtro: sin mayúsculas, sin espacios de
 * borde y sin tildes.
 *
 * Quien escribe "peugeot" espera encontrar "Peugeot", y quien escribe "frio"
 * espera encontrar "frío": un buscador que obliga a acertar la tilde es un
 * buscador que no se usa.
 */
export function normalizarBusqueda(texto: string): string {
  return texto
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Las opciones que coinciden con lo escrito, conservando el orden de entrada.
 *
 * Sin consulta devuelve la lista entera: abrir el selector tiene que mostrar
 * qué hay, no una lista vacía esperando que se adivine el nombre.
 */
export function filtrarOpciones<T extends { texto: string }>(
  opciones: readonly T[],
  consulta: string,
): T[] {
  const buscado = normalizarBusqueda(consulta);
  if (buscado === "") return [...opciones];
  return opciones.filter((o) => normalizarBusqueda(o.texto).includes(buscado));
}
