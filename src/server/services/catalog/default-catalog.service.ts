import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import {
  parseProductosFiltros,
  type ProductosFiltrosEntrada,
} from "@/lib/validation/productos-filtros.schema";
import type { ProductsRepository } from "@/server/repositories/productos.repo";
import type { Producto, UUID } from "@/types/entities";
import type {
  ImportPreview,
  ImportResult,
  ProductosFacetas,
  ProductosPagina,
} from "@/types/productos";
import { parseProductosCsv } from "./csv-import";
import type {
  CatalogListInput,
  CatalogService,
  CreateProductoServiceInput,
  FacetasOpciones,
  UpdateProductoServiceInput,
} from "./catalog.service";

export const LIMITE_FACETAS_DEFAULT = 500;
export const LIMITE_FACETAS_MAX = 3000;

const LimiteFacetasSchema = z.number().int().min(1).max(LIMITE_FACETAS_MAX);

// Cap defensivo de la lista (sin paginación v1; la búsqueda acota resultados).
const LIST_LIMIT = 1000;

export interface DefaultCatalogServiceDeps {
  productos: ProductsRepository;
}

export class DefaultCatalogService implements CatalogService {
  constructor(private readonly deps: DefaultCatalogServiceDeps) {}

  async listProductos(input: CatalogListInput = {}): Promise<Producto[]> {
    // Cap defensivo: patrones absurdamente largos.
    const q = input.q?.trim().slice(0, 100);
    return this.deps.productos.list({ q: q || undefined, limit: LIST_LIMIT });
  }

  async buscarProductos(entrada: ProductosFiltrosEntrada): Promise<ProductosPagina> {
    const filtros = parseProductosFiltros(entrada);
    return this.deps.productos.listarFiltrado(filtros);
  }

  async facetasProductos(
    entrada: ProductosFiltrosEntrada,
    opciones: FacetasOpciones = {},
  ): Promise<ProductosFacetas> {
    const filtros = parseProductosFiltros(entrada);
    const limite = LimiteFacetasSchema.safeParse(opciones.limite ?? LIMITE_FACETAS_DEFAULT);
    if (!limite.success) {
      throw new ValidationError(
        `limite de facetas inválido: debe ser un entero entre 1 y ${LIMITE_FACETAS_MAX}`,
        limite.error.issues,
      );
    }
    return this.deps.productos.facetas(filtros, limite.data);
  }

  async createProducto(input: CreateProductoServiceInput): Promise<Producto> {
    return this.deps.productos.create({
      ...input,
      compatibilidad: [],
      imagen_url: null,
      activo: true,
    });
  }

  async updateProducto(id: UUID, patch: UpdateProductoServiceInput): Promise<Producto> {
    return this.deps.productos.update(id, patch);
  }

  async setProductoActivo(id: UUID, activo: boolean): Promise<Producto> {
    return this.deps.productos.update(id, { activo });
  }

  previewImport(csvText: string): ImportPreview {
    return parseProductosCsv(csvText);
  }

  async confirmImport(csvText: string): Promise<ImportResult> {
    const preview = parseProductosCsv(csvText);
    if (preview.validos.length > 0) {
      await this.deps.productos.bulkUpsert(preview.validos);
    }
    return { importados: preview.validos.length, omitidos: preview.errores.length };
  }
}
