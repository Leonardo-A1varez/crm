import type { ProductsRepository } from "@/server/repositories/productos.repo";
import type { Producto, UUID } from "@/types/entities";
import type { ImportPreview, ImportResult } from "@/types/productos";
import { parseProductosCsv } from "./csv-import";
import type {
  CatalogListInput,
  CatalogService,
  CreateProductoServiceInput,
  UpdateProductoServiceInput,
} from "./catalog.service";

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
