import { describe, expect, test } from "vitest";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { ABREVIATURAS, AMORTIGUADORES_NIRO } from "../../helpers/catalogo-abreviaturas-fixtures";
import type { ProductoReal } from "../../helpers/catalogo-ranking-fixtures";

/*
 * El caso real de crm-dev (2026-10-07 19:12 UTC): «Necesito los amortiguadores
 * delanteros para el Kia niro 2020» -> la herramienta devolvió dos filas de
 * `REPUESTO EMG` sin existencia y ocultó `KIA NIRO HYB 17- LH/RH`.
 *
 * Esto prueba el espejo en memoria de `buscar_productos`; el de Postgres corre
 * los mismos casos en tests/integration/buscar-productos-abreviaturas.supabase.test.ts.
 */

async function repoCon(
  productos: readonly ProductoReal[],
  opciones: { abreviaturas?: boolean } = { abreviaturas: true },
): Promise<InMemoryProductsRepository> {
  const repo = new InMemoryProductsRepository({
    abreviaturas: opciones.abreviaturas ? ABREVIATURAS : [],
  });
  for (const p of productos) {
    await repo.create({
      codigo_interno: p.codigo,
      sku_proveedor: null,
      nombre: p.nombre,
      descripcion: p.descripcion,
      categoria: p.categoria,
      compatibilidad: p.compatibilidad as never,
      precio: p.precio,
      stock: p.stock,
      imagen_url: null,
      activo: true,
    });
  }
  return repo;
}

const NIRO = { marca: "Kia", modelo: "Niro", anio: 2020, tope: 20 } as const;

describe("buscar con abreviaturas: «amortiguadores delanteros» para el Kia Niro 2020", () => {
  test("encuentra el amortiguador delantero izquierdo y derecho, antes que la basura", async () => {
    const repo = await repoCon(AMORTIGUADORES_NIRO);
    const hits = await repo.search({ q: "amortiguadores delanteros", ...NIRO });
    expect(hits.map((h) => h.codigo_interno)).toEqual(["23868", "23869", "24695"]);
  });

  test("el amortiguador trasero no entra cuando pidió delanteros", async () => {
    const repo = await repoCon(AMORTIGUADORES_NIRO);
    const codigos = (await repo.search({ q: "amortiguadores delanteros", ...NIRO })).map(
      (h) => h.codigo_interno,
    );
    expect(codigos).not.toContain("23870");
    expect(codigos).not.toContain("24696");
  });

  test("pidiendo «traseros» sale el trasero", async () => {
    const repo = await repoCon(AMORTIGUADORES_NIRO);
    const hits = await repo.search({ q: "amortiguadores traseros", ...NIRO });
    expect(hits[0]?.codigo_interno).toBe("23870");
    expect(hits.map((h) => h.codigo_interno)).not.toContain("23868");
  });

  test("el lado izquierdo deja solo el LH y lo sin lado", async () => {
    const repo = await repoCon(AMORTIGUADORES_NIRO);
    const codigos = (await repo.search({ q: "amortiguador delantero izquierdo", ...NIRO })).map(
      (h) => h.codigo_interno,
    );
    expect(codigos[0]).toBe("23868");
    expect(codigos).not.toContain("23869");
  });

  test("sin pedir posición salen los tres del Niro, con la basura al final", async () => {
    const repo = await repoCon(AMORTIGUADORES_NIRO);
    const codigos = (await repo.search({ q: "amortiguadores", ...NIRO })).map(
      (h) => h.codigo_interno,
    );
    expect(codigos.slice(0, 3).sort()).toEqual(["23868", "23869", "23870"]);
    expect(codigos.slice(3).sort()).toEqual(["24695", "24696"]);
  });

  test("sin vehículo la basura de REPUESTO EMG tampoco va primero", async () => {
    const repo = await repoCon(AMORTIGUADORES_NIRO);
    const codigos = (await repo.search({ q: "amortiguadores" })).map((h) => h.codigo_interno);
    expect(codigos.slice(0, 3).sort()).toEqual(["23868", "23869", "23870"]);
  });
});

describe("grupos que no son repuestos", () => {
  const gasto: ProductoReal = {
    codigo: "G1",
    nombre: "AMORTIGUADORES PAGO A PROVEEDOR",
    categoria: "GASTOS VARIOS",
    descripcion: null,
    precio: 50,
    stock: 112,
    compatibilidad: [],
  };

  test("lo que está en un grupo excluido no se busca ni se cotiza", async () => {
    const repo = new InMemoryProductsRepository({
      abreviaturas: ABREVIATURAS,
      gruposExcluidos: ["REPUESTO EMG", "GASTOS VARIOS"],
    });
    for (const p of [...AMORTIGUADORES_NIRO, gasto]) {
      await repo.create({
        codigo_interno: p.codigo,
        sku_proveedor: null,
        nombre: p.nombre,
        descripcion: p.descripcion,
        categoria: p.categoria,
        compatibilidad: p.compatibilidad as never,
        precio: p.precio,
        stock: p.stock,
        imagen_url: null,
        activo: true,
      });
    }
    const codigos = (await repo.search({ q: "amortiguadores", ...NIRO })).map(
      (h) => h.codigo_interno,
    );
    expect(codigos.sort()).toEqual(["23868", "23869", "23870"]);
  });

  test("sin lista de grupos excluidos entra todo (la lista vive en la tabla, no en el código)", async () => {
    const repo = await repoCon([...AMORTIGUADORES_NIRO, gasto]);
    const codigos = (await repo.search({ q: "amortiguadores", ...NIRO })).map(
      (h) => h.codigo_interno,
    );
    expect(codigos).toContain("G1");
  });
});

describe("buscar sin tabla de abreviaturas: el prefijo sigue encontrando AMORTIG", () => {
  test("«amortiguadores» ~ AMORTIG sin ninguna abreviatura cargada", async () => {
    const repo = await repoCon(AMORTIGUADORES_NIRO, { abreviaturas: false });
    const hits = await repo.search({ q: "amortiguadores", ...NIRO });
    expect(
      hits
        .slice(0, 3)
        .map((h) => h.codigo_interno)
        .sort(),
    ).toEqual(["23868", "23869", "23870"]);
  });
});

describe("el modelo del cliente aparece en modelo_nombre aunque no esté en catalogo_modelos", () => {
  const producto: ProductoReal = {
    codigo: "9",
    nombre: "HY 06- 1.4",
    categoria: "BOMBA DE AGUA",
    descripcion: null,
    precio: 20,
    stock: 3,
    compatibilidad: [
      {
        marca: "Hyundai",
        modelo: "ACC",
        modelo_nombre: "Hyundai Accent",
        anio_desde: 2006,
        anio_hasta: null,
        cilindrada: null,
        combustible: null,
      },
    ],
  };

  test("«Accent» sin diccionario sirve por modelo_nombre, sin importar mayúsculas", async () => {
    const repo = await repoCon([producto]);
    const hits = await repo.search({
      q: "bomba de agua",
      marca: "HYUNDAI",
      modelo: "accent",
      anio: 2008,
    });
    expect(hits.map((h) => h.codigo_interno)).toEqual(["9"]);
    expect(hits[0]?.nivel_vehiculo).toBeGreaterThanOrEqual(4);
  });

  test("otro modelo no sirve", async () => {
    const repo = await repoCon([producto]);
    const hits = await repo.search({ q: "bomba de agua", marca: "Hyundai", modelo: "Tucson" });
    expect(hits).toHaveLength(0);
  });
});
