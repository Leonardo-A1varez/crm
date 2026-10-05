import type {
  BuscarRepuestoInput,
  BuscarRepuestoMatch,
  BuscarRepuestoOutput,
} from "@/lib/validation/ai";
import {
  diferenciasEntre,
  etiquetasDeCompatibilidad,
  normalizarCilindrada,
} from "@/lib/catalogo/compatibilidad";
import { avisoSobremedida } from "@/lib/catalogo/sobremedida";
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

/** Un texto vacío o en blanco es "no lo dijo". */
const textoUtil = (s: string | undefined): string | undefined => {
  const t = s?.trim();
  return t ? t : undefined;
};

export class DefaultCatalogMatcherService implements CatalogMatcherService {
  constructor(private readonly productos: ProductsRepository) {}

  async buscar(input: BuscarRepuestoInput): Promise<BuscarRepuestoOutput> {
    // Los modelos de lenguaje mandan `0` cuando no saben el año aunque el schema
    // les diga que lo omitan. El año 0 no existe: es "desconocido", y buscarlo
    // como año descartaría todo producto con rango de años cargado.
    const anio = input.anio !== undefined && input.anio > 0 ? input.anio : undefined;
    const cilindrada = normalizarCilindrada(input.cilindrada);

    const hits = await this.productos.search({
      q: input.query,
      marca: textoUtil(input.marca),
      modelo: textoUtil(input.modelo),
      anio,
      cilindrada,
      tope: TOPE_PARA_EL_AGENTE,
    });

    // En qué se diferencian los mejores candidatos: lo único que el agente tiene
    // que preguntar. Lo que el cliente ya dijo (año, cilindrada) no entra.
    const diferencias = diferenciasEntre(hits, { anio, cilindrada });

    const matches: BuscarRepuestoMatch[] = hits.map((h) => {
      const base: BuscarRepuestoMatch = {
        id: h.id,
        codigo_interno: h.codigo_interno,
        nombre: h.nombre,
        precio: h.precio,
        stock: h.stock,
      };
      if (!diferencias) return base;
      // A cada candidato, solo los atributos que lo distinguen de los otros.
      const e = etiquetasDeCompatibilidad(h.compatibilidad);
      const dif = diferencias.atributos;
      return {
        ...base,
        ...(dif.includes("anio") && e.anio.length > 0 ? { anios: e.anio } : {}),
        ...(dif.includes("cilindrada") && e.cilindrada.length > 0
          ? { cilindradas: e.cilindrada }
          : {}),
        ...(dif.includes("combustible") && e.combustible.length > 0
          ? { combustibles: e.combustible }
          : {}),
      };
    });

    const aviso = avisoSobremedida(hits);

    // El aviso va primero a propósito: es lo que el modelo tiene que leer antes
    // de mirar precios.
    return {
      ...(aviso ? { aviso } : {}),
      matches,
      count: matches.length,
      ...(diferencias ? { diferencias } : {}),
    };
  }
}
