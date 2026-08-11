import { normalizarBusqueda } from "@/lib/ui/selector-buscable";
import type { Tag } from "@/types/entities";

/**
 * Comparación tolerante: sin mayúsculas, sin espacios de borde y sin tildes.
 * "Flota Municipal" y "flota municipal" son la misma etiqueta para quien la
 * escribe, y `tags.nombre` es UNIQUE — ofrecer crear la segunda terminaría en
 * un error de duplicado que el vendedor no puede entender.
 *
 * Es la misma normalización que usa el buscador de las mini-pantallas de
 * filtro, y por eso delega en vez de tener su copia: dos copias que derivan
 * harían que el selector encontrara una etiqueta que el chequeo de duplicados
 * considera nueva.
 */
export function normalizarEtiqueta(texto: string): string {
  return normalizarBusqueda(texto);
}

export interface OpcionesSelector {
  /** Del catálogo, las que el lead todavía no tiene y matchean lo escrito. */
  candidatas: Tag[];
  /**
   * `true` cuando lo escrito no existe en el catálogo entero. Se mira contra
   * todo el catálogo y no contra las candidatas: si el nombre ya existe pero el
   * lead no la tiene, lo que corresponde es asignarla, no crear una gemela.
   */
  puedeCrear: boolean;
}

/** Qué le ofrece el selector del Twin a lo que se está escribiendo. */
export function opcionesSelector(
  disponibles: Tag[],
  puestas: Tag[],
  consulta: string,
): OpcionesSelector {
  const yaTiene = new Set(puestas.map((t) => t.id));
  const buscado = normalizarEtiqueta(consulta);
  const sinPoner = disponibles.filter((t) => !yaTiene.has(t.id));

  return {
    candidatas:
      buscado === ""
        ? sinPoner
        : sinPoner.filter((t) => normalizarEtiqueta(t.nombre).includes(buscado)),
    puedeCrear:
      buscado !== "" && !disponibles.some((t) => normalizarEtiqueta(t.nombre) === buscado),
  };
}
