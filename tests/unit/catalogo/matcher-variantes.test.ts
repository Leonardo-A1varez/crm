import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FilaVariante } from "@/lib/catalogo/bodega-contrato";
import type { Logger } from "@/lib/observability/logger";
import {
  InMemoryBodegaCatalogoRepository,
  type BodegaCatalogoRepository,
} from "@/server/repositories/bodega-catalogo.repo";
import { InMemoryCatalogoMarcasRepository } from "@/server/repositories/catalogo-marcas.repo";
import {
  InMemoryProductsRepository,
  type ProductoInsert,
} from "@/server/repositories/productos.repo";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { MARCAS } from "../../helpers/catalogo-marcas-fixtures";

const producto = (o: Partial<ProductoInsert>): ProductoInsert => ({
  codigo_interno: "X",
  sku_proveedor: null,
  nombre: "BOMBA DE AGUA KIA RIO 18-",
  descripcion: null,
  categoria: "BOMBA DE AGUA",
  compatibilidad: [],
  precio: 10,
  stock: 5,
  imagen_url: null,
  activo: true,
  ...o,
});

const variante = (o: Partial<FilaVariante> = {}): FilaVariante => ({
  id: "00000000-0000-4000-8000-000000000001",
  item_codigo_interno: "B-1",
  proveedor: { id: null, nombre: null, abreviatura: null },
  supplier_code_raw: null,
  supplier_code_norm: null,
  codigos_auxiliares: [],
  descripcion_raw: null,
  descripcion_limpia: null,
  descripcion_auxiliar: null,
  marca_raw: null,
  marca_canonica: "MANDO",
  marca_id: null,
  marca_procedencia: "KOREA",
  lado: null,
  categoria: null,
  estado: "CONFIRMED",
  descartada: false,
  promovida: false,
  promovida_en: null,
  primera_vez: null,
  ultima_vez: null,
  actualizado_en: "2026-10-07T10:00:00.000000+00:00",
  ...o,
});

const CURSOR = { desde: "2026-10-07T10:00:00.000000Z", despues: null };

describe("buscar_repuesto: marca, procedencia y lado desde las variantes de Bodega Web", () => {
  let productos: InMemoryProductsRepository;
  let bodega: InMemoryBodegaCatalogoRepository;

  beforeEach(async () => {
    productos = new InMemoryProductsRepository();
    bodega = new InMemoryBodegaCatalogoRepository();
    await productos.create(
      producto({ codigo_interno: "B-1", descripcion: "MOBIS", precio: 96.66 }),
    );
  });

  const servicio = (
    b: Pick<BodegaCatalogoRepository, "variantesDeItems"> = bodega,
    logger?: Logger,
  ) =>
    new DefaultCatalogMatcherService(
      productos,
      new InMemoryCatalogoMarcasRepository(MARCAS),
      logger,
      undefined,
      b,
    );

  test("una variante confiable manda sobre la descripción del ERP", async () => {
    await bodega.aplicarPagina("variantes", [variante()], CURSOR);
    const r = await servicio().buscar({ query: "bomba de agua" });
    expect(r.matches[0]).toMatchObject({ marca: "MANDO", procedencia: "Korea" });
  });

  test("una variante sin confianza o descartada no cambia nada", async () => {
    await bodega.aplicarPagina(
      "variantes",
      [
        variante({ estado: "OBSERVED" }),
        variante({ id: "00000000-0000-4000-8000-000000000002", descartada: true }),
      ],
      CURSOR,
    );
    const r = await servicio().buscar({ query: "bomba de agua" });
    expect(r.matches[0]).toMatchObject({ marca: "MOBIS", procedencia: "Original" });
  });

  test("una variante dada de baja deja de contar", async () => {
    await bodega.aplicarPagina("variantes", [variante()], CURSOR);
    await bodega.aplicarPagina(
      "bajas",
      [
        {
          id: 1,
          tabla: "variantes",
          clave: "00000000-0000-4000-8000-000000000001",
          borrado_en: "2026-10-07T11:00:00.000000+00:00",
        },
      ],
      CURSOR,
    );
    const r = await servicio().buscar({ query: "bomba de agua" });
    expect(r.matches[0]).toMatchObject({ marca: "MOBIS", procedencia: "Original" });
  });

  test("el lado de la variante confiable llega al candidato", async () => {
    await bodega.aplicarPagina("variantes", [variante({ lado: "LEFT" })], CURSOR);
    const r = await servicio().buscar({ query: "bomba de agua" });
    expect(r.matches[0]?.lado).toBe("izquierdo");
  });

  test("trae las variantes de todos los candidatos en UNA consulta", async () => {
    await productos.create(producto({ codigo_interno: "B-2", descripcion: "JUNGWOO" }));
    const espia = { variantesDeItems: vi.fn(bodega.variantesDeItems.bind(bodega)) };
    await servicio(espia).buscar({ query: "bomba de agua" });
    expect(espia.variantesDeItems).toHaveBeenCalledTimes(1);
    expect(espia.variantesDeItems.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining(["B-1", "B-2"]),
    );
  });

  test("si Bodega Web no se puede leer, el agente sigue cotizando con el ERP", async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: () => logger,
    } as unknown as Logger;
    const roto = {
      variantesDeItems: vi.fn(async () => {
        throw new Error("tabla inexistente");
      }),
    };
    const r = await servicio(roto, logger).buscar({ query: "bomba de agua" });
    expect(r.matches[0]).toMatchObject({ marca: "MOBIS", procedencia: "Original", precio: 96.66 });
    expect(logger.warn).toHaveBeenCalled();
  });

  test("sin repositorio de Bodega Web todo funciona como antes", async () => {
    const svc = new DefaultCatalogMatcherService(
      productos,
      new InMemoryCatalogoMarcasRepository(MARCAS),
    );
    const r = await svc.buscar({ query: "bomba de agua" });
    expect(r.matches[0]).toMatchObject({ marca: "MOBIS", procedencia: "Original" });
  });
});
