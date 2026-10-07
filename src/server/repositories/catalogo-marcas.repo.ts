import type { MarcaCatalogo } from "@/lib/catalogo/procedencia";

/**
 * Lectura de las marcas del catálogo y su procedencia (`catalogo_marcas`). Solo las
 * activas. Quien escribe la tabla es la carga del ERP (`erp_sync_cargar` con
 * `p_tabla = 'marcas'`), no la aplicación.
 */
export interface CatalogoMarcasRepository {
  listarActivas(): Promise<MarcaCatalogo[]>;
}

export class InMemoryCatalogoMarcasRepository implements CatalogoMarcasRepository {
  constructor(private readonly marcas: readonly MarcaCatalogo[] = []) {}

  async listarActivas(): Promise<MarcaCatalogo[]> {
    return this.marcas.filter((m) => m.activa).map((m) => ({ ...m, alias: [...m.alias] }));
  }
}
