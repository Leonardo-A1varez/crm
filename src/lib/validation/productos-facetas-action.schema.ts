import { z } from "zod";
import { LISTA_MAX, TEXTO_MAX, VALOR_LISTA_MAX } from "@/lib/validation/productos-filtros.schema";
import type { ProductosFacetas } from "@/types/productos";

/**
 * Entrada de la Server Action que alimenta las listas de filtro de /productos.
 *
 * Acota el tamaño de lo que cruza el límite cliente→servidor; el significado de
 * cada filtro (rangos, incluir contra excluir) lo valida `facetasProductos`.
 * Las claves son las de la URL, así que la acción recibe tal cual lo que el
 * navegador ya tiene.
 */
const escalar = z.string().max(VALOR_LISTA_MAX);
const lista = z.union([escalar, z.array(escalar).max(LISTA_MAX)]);

export const FacetasActionSchema = z.object({
  filtros: z.object({
    q: escalar.optional(),
    codigo: escalar.optional(),
    codigoModo: escalar.optional(),
    descripcion: escalar.optional(),
    descripcionModo: escalar.optional(),
    categorias: lista.optional(),
    sinCategorias: lista.optional(),
    marcas: lista.optional(),
    sinMarcas: lista.optional(),
    precioMin: escalar.optional(),
    precioMax: escalar.optional(),
    stockMin: escalar.optional(),
    stockMax: escalar.optional(),
    conStock: escalar.optional(),
    estado: escalar.optional(),
  }),
  /** Búsqueda dentro de la lista de categorías o de marcas. */
  qCategoria: z.string().max(TEXTO_MAX).optional(),
  qMarca: z.string().max(TEXTO_MAX).optional(),
  /** Qué lista calcular; sin ella, las dos. */
  columna: z.enum(["categoria", "marca"]).optional(),
});

export type FacetasActionInput = z.input<typeof FacetasActionSchema>;

export type FacetasActionResult =
  | { ok: true; facetas: ProductosFacetas }
  | { ok: false; error: string };
