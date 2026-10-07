import { abreviaturaActiva, type Abreviatura } from "@/lib/catalogo/abreviaturas";

/**
 * Lectura de las abreviaturas del inventario (`catalogo_abreviaturas`). Solo las activas
 * (confirmadas por el dueño o con confianza alta). Las escribe el dueño con
 * `scripts/catalogo/cargar-abreviaturas.mjs` o el panel de admin, no la aplicación.
 */
export interface CatalogoAbreviaturasRepository {
  listarActivas(): Promise<Abreviatura[]>;
}

export class InMemoryCatalogoAbreviaturasRepository implements CatalogoAbreviaturasRepository {
  constructor(private readonly abreviaturas: readonly Abreviatura[] = []) {}

  async listarActivas(): Promise<Abreviatura[]> {
    return this.abreviaturas.filter(abreviaturaActiva).map((a) => ({ ...a }));
  }
}
