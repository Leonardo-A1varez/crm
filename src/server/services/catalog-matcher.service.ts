import type {
  BuscarRepuestoInput,
  BuscarRepuestoMatch,
  BuscarRepuestoOutput,
} from "@/lib/validation/ai";
import type { ProductsRepository } from "@/server/repositories/productos.repo";

/**
 * La herramienta `buscar_repuesto` que usa el agente.
 *
 * Este servicio era el que puntuaba: traía el catálogo entero con
 * `productos.list({activo:true})` y ordenaba en memoria. Eso está roto de una
 * forma que no se ve — un `list` sin `limit` no aplica ningún `range`, así que
 * manda el tope del servidor PostgREST. Con 21.009 productos el agente veía
 * 1.000 ordenados alfabéticamente, de `001 CAMISAS` a `CH COR DW LAN 1C`, y
 * respondía "no tenemos" sin un solo error en ningún log.
 *
 * `buscar_productos` se escribió el 2026-08-15 justamente para eso y nunca se
 * cableó. Ahora el puntaje vive en dos lugares y solo dos: la función de
 * Postgres y su espejo `src/lib/catalogo/puntaje.ts`, que es el que usa el
 * repo in-memory. Este servicio ya no puntúa nada — traduce.
 */
export interface CatalogMatcherService {
  buscar(input: BuscarRepuestoInput): Promise<BuscarRepuestoOutput>;
}

/**
 * Cuántas filas se le pasan al modelo.
 *
 * No es el tope de la búsqueda por gusto: es cuánto contexto vale la pena
 * gastar. Veinte candidatos alcanzan para que el agente calcule la pregunta
 * clave y cotice; mil solo queman tokens y lo confunden.
 */
const TOPE_PARA_EL_AGENTE = 20;

export class DefaultCatalogMatcherService implements CatalogMatcherService {
  constructor(private readonly productos: ProductsRepository) {}

  async buscar(input: BuscarRepuestoInput): Promise<BuscarRepuestoOutput> {
    const hits = await this.productos.search({
      q: input.query,
      marca: input.marca,
      modelo: input.modelo,
      anio: input.anio,
      tope: TOPE_PARA_EL_AGENTE,
    });

    const matches: BuscarRepuestoMatch[] = hits.map((h) => ({
      id: h.id,
      codigo_interno: h.codigo_interno,
      nombre: h.nombre,
      precio: h.precio,
      stock: h.stock,
    }));

    return { matches, count: matches.length };
  }
}
