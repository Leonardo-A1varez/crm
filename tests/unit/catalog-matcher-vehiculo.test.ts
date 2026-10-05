import { beforeEach, describe, expect, test } from "vitest";
import { BuscarRepuestoInputSchema, BuscarRepuestoOutputSchema } from "@/lib/validation/ai";
import {
  InMemoryProductsRepository,
  type ProductoInsert,
} from "@/server/repositories/productos.repo";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { MODELOS } from "../helpers/catalogo-compat-fixtures";

function termostato(codigo: string, nombre: string, compat: ProductoInsert["compatibilidad"]) {
  return {
    codigo_interno: codigo,
    sku_proveedor: null,
    nombre,
    descripcion: null,
    categoria: "TERMOSTATO",
    compatibilidad: compat,
    precio: 12,
    stock: 3,
    imagen_url: null,
    activo: true,
  } satisfies ProductoInsert;
}

const acc = (desde: number | null, hasta: number | null, cil: string | null, comb = "GAS") =>
  ({
    marca: "Hyundai",
    modelo: "ACC",
    anio_desde: desde,
    anio_hasta: hasta,
    cilindrada: cil,
    combustible: comb,
  }) as never;

describe("CatalogMatcherService.buscar con vehículo", () => {
  let repo: InMemoryProductsRepository;
  let svc: DefaultCatalogMatcherService;

  beforeEach(async () => {
    repo = new InMemoryProductsRepository({ modelos: MODELOS });
    svc = new DefaultCatalogMatcherService(repo);
    await repo.create(termostato("T14", "TERMOSTATO HY ACCENT 1.4", [acc(2006, 2011, "1.4")]));
    await repo.create(termostato("T16", "TERMOSTATO HY ACCENT 1.6", [acc(2006, 2011, "1.6")]));
    await repo.create(termostato("T16N", "TERMOSTATO HY ACCENT 12-", [acc(2012, null, "1.6")]));
  });

  test('"Accent" encuentra lo catalogado como ACC', async () => {
    const r = await svc.buscar({ query: "termostato", marca: "Hyundai", modelo: "Accent" });
    expect(r.matches.map((m) => m.codigo_interno).sort()).toEqual(["T14", "T16", "T16N"]);
  });

  test("año 0 se trata como desconocido, no como el año cero", async () => {
    const r = await svc.buscar({ query: "termostato", modelo: "Accent", anio: 0 });
    expect(r.count).toBe(3);
  });

  test("marca y modelo vacíos o en blanco se ignoran", async () => {
    const r = await svc.buscar({ query: "termostato", marca: "  ", modelo: "" });
    expect(r.count).toBe(3);
  });

  test("la cilindrada se normaliza: '1,6' y '1.6L' filtran igual que '1.6'", async () => {
    for (const cilindrada of ["1.6", "1,6", "1.6L", "1600"]) {
      const r = await svc.buscar({ query: "termostato", modelo: "Accent", anio: 2008, cilindrada });
      expect(
        r.matches.map((m) => m.codigo_interno),
        cilindrada,
      ).toEqual(["T16"]);
    }
  });

  test("una cilindrada ilegible no filtra nada", async () => {
    const r = await svc.buscar({ query: "termostato", modelo: "Accent", cilindrada: "diesel" });
    expect(r.count).toBe(3);
  });

  describe("diferencias", () => {
    test("avisa que difieren año y cilindrada cuando el cliente no dio ninguno", async () => {
      const r = await svc.buscar({ query: "termostato", modelo: "Accent" });
      expect(r.diferencias?.atributos).toEqual(["anio", "cilindrada"]);
      expect(r.diferencias?.valores.cilindrada).toEqual(["1.4", "1.6"]);
      expect(r.diferencias?.valores.anio).toEqual(["2006-2011", "2012 en adelante"]);
    });

    test("no pregunta el año si ya lo dio", async () => {
      const r = await svc.buscar({ query: "termostato", modelo: "Accent", anio: 2008 });
      expect(r.diferencias?.atributos).toEqual(["cilindrada"]);
    });

    test("no hay diferencias cuando queda un solo candidato", async () => {
      const r = await svc.buscar({
        query: "termostato",
        modelo: "Accent",
        anio: 2008,
        cilindrada: "1.6",
      });
      expect(r.count).toBe(1);
      expect(r.diferencias).toBeUndefined();
    });

    test("cada candidato trae solo los atributos que difieren, para poder preguntar", async () => {
      const r = await svc.buscar({ query: "termostato", modelo: "Accent", anio: 2008 });
      const t14 = r.matches.find((m) => m.codigo_interno === "T14");
      const t16 = r.matches.find((m) => m.codigo_interno === "T16");
      expect(t14?.cilindradas).toEqual(["1.4"]);
      expect(t16?.cilindradas).toEqual(["1.6"]);
      expect(t14?.anios).toBeUndefined();
      expect(t14?.combustibles).toBeUndefined();
    });

    test("una búsqueda sin compatibilidad cargada no inventa diferencias", async () => {
      const vacio = new InMemoryProductsRepository();
      await vacio.create(termostato("A", "TERMOSTATO A", []));
      await vacio.create(termostato("B", "TERMOSTATO B", []));
      const r = await new DefaultCatalogMatcherService(vacio).buscar({ query: "termostato" });
      expect(r.count).toBe(2);
      expect(r.diferencias).toBeUndefined();
      expect(r.matches[0]?.anios).toBeUndefined();
    });

    test("la salida cumple su schema", async () => {
      const r = await svc.buscar({ query: "termostato", modelo: "Accent" });
      expect(() => BuscarRepuestoOutputSchema.parse(r)).not.toThrow();
    });
  });
});

describe("BuscarRepuestoInputSchema", () => {
  test("acepta cilindrada opcional", () => {
    expect(BuscarRepuestoInputSchema.parse({ query: "x", cilindrada: "1.6" }).cilindrada).toBe(
      "1.6",
    );
    expect(BuscarRepuestoInputSchema.parse({ query: "x" }).cilindrada).toBeUndefined();
  });

  test("le dice al modelo que omita el año desconocido y no mande 0", () => {
    const desc = BuscarRepuestoInputSchema.shape.anio.description ?? "";
    expect(desc).toMatch(/omit/i);
    expect(desc).toMatch(/\b0\b/);
  });
});
