import { describe, expect, test, beforeEach } from "vitest";
import type { ProductoInsert, ProductsRepository } from "@/server/repositories/productos.repo";

function baseInsert(overrides: Partial<ProductoInsert> = {}): ProductoInsert {
  return {
    codigo_interno: "PF-COR-001",
    sku_proveedor: "BR-AC234",
    nombre: "Pastilla de freno Corolla 2014-2018",
    descripcion: "Juego delantero, cerámica",
    categoria: "frenos",
    compatibilidad: [{ marca: "Toyota", modelo: "Corolla", anio_desde: 2014, anio_hasta: 2018 }],
    precio: 120000,
    stock: 12,
    imagen_url: null,
    activo: true,
    ...overrides,
  };
}

export function runProductosContract(makeRepo: () => ProductsRepository) {
  describe("ProductsRepository contract", () => {
    let repo: ProductsRepository;

    beforeEach(() => {
      repo = makeRepo();
    });

    test("create asigna id + created_at + updated_at + persiste", async () => {
      const p = await repo.create(baseInsert());
      expect(p.id).toBeTypeOf("string");
      expect(p.created_at).toBeInstanceOf(Date);
      expect(p.updated_at).toBeInstanceOf(Date);
      expect(p.codigo_interno).toBe("PF-COR-001");
      expect(await repo.findById(p.id)).toEqual(p);
    });

    test("create rechaza codigo_interno duplicado", async () => {
      await repo.create(baseInsert());
      await expect(repo.create(baseInsert())).rejects.toThrow(/codigo_interno|duplicad/i);
    });

    test("findByCodigoInterno localiza producto", async () => {
      const p = await repo.create(baseInsert());
      const found = await repo.findByCodigoInterno("PF-COR-001");
      expect(found?.id).toBe(p.id);
      expect(await repo.findByCodigoInterno("NOPE")).toBeNull();
    });

    test("update aplica patch + bumpea updated_at + bloquea codigo_interno change", async () => {
      const p = await repo.create(baseInsert());
      const before = p.updated_at.getTime();
      await new Promise((r) => setTimeout(r, 5));

      const patched = await repo.update(p.id, { precio: 130000, stock: 10 });
      expect(patched.precio).toBe(130000);
      expect(patched.stock).toBe(10);
      expect(patched.codigo_interno).toBe(p.codigo_interno);
      expect(patched.updated_at.getTime()).toBeGreaterThan(before);
    });

    test("update throws cuando id falta", async () => {
      await expect(repo.update("missing", { precio: 1 })).rejects.toThrow();
    });

    test("list devuelve todos cuando no hay filter", async () => {
      await repo.create(baseInsert());
      await repo.create(baseInsert({ codigo_interno: "X-2", nombre: "Otro" }));
      const all = await repo.list();
      expect(all).toHaveLength(2);
    });

    test("list filtra por activo", async () => {
      await repo.create(baseInsert({ activo: true }));
      await repo.create(baseInsert({ codigo_interno: "X-INA", activo: false }));

      const activos = await repo.list({ activo: true });
      expect(activos).toHaveLength(1);
      expect(activos[0].activo).toBe(true);

      const inactivos = await repo.list({ activo: false });
      expect(inactivos).toHaveLength(1);
      expect(inactivos[0].activo).toBe(false);
    });

    test("list q matchea nombre case-insensitive", async () => {
      await repo.create(baseInsert({ codigo_interno: "A1", nombre: "Filtro de aire Honda Civic" }));
      await repo.create(baseInsert({ codigo_interno: "A2", nombre: "Pastilla Corolla" }));

      const r = await repo.list({ q: "honda" });
      expect(r).toHaveLength(1);
      expect(r[0].codigo_interno).toBe("A1");
    });

    test("list q matchea codigo_interno", async () => {
      await repo.create(baseInsert({ codigo_interno: "FA-CIV-99" }));
      await repo.create(baseInsert({ codigo_interno: "PA-COR-01", nombre: "Pastilla" }));

      const r = await repo.list({ q: "CIV" });
      expect(r).toHaveLength(1);
      expect(r[0].codigo_interno).toBe("FA-CIV-99");
    });

    test("list respeta limit + offset", async () => {
      for (let i = 0; i < 5; i++) {
        await repo.create(baseInsert({ codigo_interno: `P-${i}` }));
      }
      const page1 = await repo.list({ limit: 2, offset: 0 });
      const page2 = await repo.list({ limit: 2, offset: 2 });
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    test("list ordena por nombre asc con tiebreak codigo_interno", async () => {
      await repo.create(baseInsert({ codigo_interno: "Z-9", nombre: "Zapata" }));
      await repo.create(baseInsert({ codigo_interno: "A-2", nombre: "Amortiguador" }));
      await repo.create(baseInsert({ codigo_interno: "A-1", nombre: "Amortiguador" }));

      const all = await repo.list();
      expect(all.map((p) => p.codigo_interno)).toEqual(["A-1", "A-2", "Z-9"]);
    });

    test("bulkUpsert crea cuando no existen", async () => {
      const items = [
        baseInsert({ codigo_interno: "B-1" }),
        baseInsert({ codigo_interno: "B-2", nombre: "Otro" }),
      ];
      const result = await repo.bulkUpsert(items);
      expect(result).toHaveLength(2);
      expect(result[0].codigo_interno).toBe("B-1");
      expect(result[1].codigo_interno).toBe("B-2");
      expect(await repo.findByCodigoInterno("B-1")).not.toBeNull();
    });

    test("bulkUpsert actualiza existentes manteniendo id + created_at", async () => {
      const original = await repo.create(baseInsert({ codigo_interno: "U-1", precio: 100 }));
      const result = await repo.bulkUpsert([
        baseInsert({ codigo_interno: "U-1", precio: 200, stock: 50 }),
      ]);
      expect(result[0].id).toBe(original.id);
      expect(result[0].created_at).toEqual(original.created_at);
      expect(result[0].precio).toBe(200);
      expect(result[0].stock).toBe(50);
    });

    test("bulkUpsert mezcla creates + updates preservando orden input", async () => {
      await repo.create(baseInsert({ codigo_interno: "MIX-EXIST", precio: 100 }));
      const result = await repo.bulkUpsert([
        baseInsert({ codigo_interno: "MIX-NEW-1" }),
        baseInsert({ codigo_interno: "MIX-EXIST", precio: 999 }),
        baseInsert({ codigo_interno: "MIX-NEW-2" }),
      ]);
      expect(result.map((r) => r.codigo_interno)).toEqual(["MIX-NEW-1", "MIX-EXIST", "MIX-NEW-2"]);
      expect(result[1].precio).toBe(999);
    });

    test("bulkUpsert throws si hay codigo_interno duplicado en el input", async () => {
      await expect(
        repo.bulkUpsert([
          baseInsert({ codigo_interno: "DUP" }),
          baseInsert({ codigo_interno: "DUP", precio: 500 }),
        ]),
      ).rejects.toThrow(/dup/i);
    });

    test("bulkUpsert con array vacío devuelve []", async () => {
      expect(await repo.bulkUpsert([])).toEqual([]);
    });
  });
}
