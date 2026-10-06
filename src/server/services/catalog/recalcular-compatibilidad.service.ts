import { diccionarioDesdeModelos } from "@/lib/catalogo/diccionario-desde-modelos";
import { traducirDescripcion } from "@/lib/catalogo/traducir-descripcion";
import type { CatalogoModelosRepository } from "@/server/repositories/catalogo-modelos.repo";
import type { ProductsRepository } from "@/server/repositories/productos.repo";

export interface RecalcularCompatibilidadResultado {
  /** Productos pendientes que se leyeron en esta pasada. */
  leidos: number;
  /** Los que quedaron con la compatibilidad nueva y la marca de pendiente baja. */
  actualizados: number;
  /** De los actualizados, cuántos no tienen ningún vehículo reconocido (quedan en `[]`). */
  sinVehiculo: number;
  /** El nombre cambió mientras se traducía: siguen pendientes para la próxima pasada. */
  descartados: number;
}

export interface RecalcularCompatibilidadService {
  recalcular(limite: number): Promise<RecalcularCompatibilidadResultado>;
}

const CONCURRENCIA = 20;

/**
 * Recalcula `productos.compatibilidad` de los productos cuyo `nombre` cambió.
 *
 * El traductor trabaja con el diccionario ACTIVO de `catalogo_modelos`
 * (confirmado por el dueño o confianza alta), no con el CSV: así lo que el dueño
 * confirma en la base se refleja sin redesplegar. Un nombre sin ningún vehículo
 * reconocido deja la compatibilidad en `[]` y baja igual la marca: la
 * compatibilidad vieja era de otro nombre y ya no vale.
 */
export class DefaultRecalcularCompatibilidadService implements RecalcularCompatibilidadService {
  constructor(
    private readonly deps: {
      productos: Pick<
        ProductsRepository,
        "listarCompatibilidadPendiente" | "guardarCompatibilidad"
      >;
      modelos: CatalogoModelosRepository;
    },
  ) {}

  async recalcular(limite: number): Promise<RecalcularCompatibilidadResultado> {
    const pendientes = await this.deps.productos.listarCompatibilidadPendiente(limite);
    if (pendientes.length === 0) {
      return { leidos: 0, actualizados: 0, sinVehiculo: 0, descartados: 0 };
    }
    const diccionario = diccionarioDesdeModelos(await this.deps.modelos.listarActivos());

    let actualizados = 0;
    let sinVehiculo = 0;
    let descartados = 0;
    for (let i = 0; i < pendientes.length; i += CONCURRENCIA) {
      const grupo = pendientes.slice(i, i + CONCURRENCIA);
      const resultados = await Promise.all(
        grupo.map(async (p) => {
          const compatibilidad = traducirDescripcion(p.nombre, diccionario);
          const guardado = await this.deps.productos.guardarCompatibilidad(
            p.id,
            p.nombre,
            compatibilidad,
          );
          return { guardado, vacio: compatibilidad.length === 0 };
        }),
      );
      for (const r of resultados) {
        if (!r.guardado) descartados += 1;
        else {
          actualizados += 1;
          if (r.vacio) sinVehiculo += 1;
        }
      }
    }
    return { leidos: pendientes.length, actualizados, sinVehiculo, descartados };
  }
}
