import type { ModeloCatalogo } from "@/lib/catalogo/compatibilidad";

/**
 * Lectura del diccionario de modelos (`catalogo_modelos`). Solo las filas
 * activas: confirmadas por el dueño o con confianza alta. Quien escribe la tabla
 * es `scripts/catalogo/cargar-modelos.mjs`, no la aplicación.
 */
export interface CatalogoModelosRepository {
  listarActivos(): Promise<ModeloCatalogo[]>;
}

export class InMemoryCatalogoModelosRepository implements CatalogoModelosRepository {
  constructor(private readonly modelos: readonly ModeloCatalogo[] = []) {}

  async listarActivos(): Promise<ModeloCatalogo[]> {
    return this.modelos
      .filter((m) => m.confirmado || m.confianza === "alta")
      .map((m) => ({ ...m, alias: [...m.alias] }));
  }
}
