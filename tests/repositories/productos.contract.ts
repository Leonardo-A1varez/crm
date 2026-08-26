import { describe, expect, test, beforeEach } from "vitest";
import type {
  ProductoBulkUpsertItem,
  ProductoInsert,
  ProductsRepository,
} from "@/server/repositories/productos.repo";

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

function bulkItem(overrides: Partial<ProductoBulkUpsertItem> = {}): ProductoBulkUpsertItem {
  return {
    codigo_interno: "B-1",
    sku_proveedor: null,
    nombre: "Bulk item",
    descripcion: null,
    categoria: null,
    precio: 100,
    stock: 1,
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

    test("list q trata coma y paréntesis como literales (sin romper filtro)", async () => {
      await repo.create(
        baseInsert({ codigo_interno: "Q-1", nombre: "Pastilla, delantera (ceramica)" }),
      );
      await repo.create(baseInsert({ codigo_interno: "Q-2", nombre: "Otra cosa" }));
      const r = await repo.list({ q: "pastilla, delantera (" });
      expect(r).toHaveLength(1);
      expect(r[0]?.codigo_interno).toBe("Q-1");
    });

    test("list q trata % y _ como literales (no wildcards)", async () => {
      await repo.create(baseInsert({ codigo_interno: "W-1", nombre: "Descuento 10% real" }));
      await repo.create(baseInsert({ codigo_interno: "W-2", nombre: "Descuento 10 grande" }));
      const r = await repo.list({ q: "10%" });
      expect(r).toHaveLength(1);
      expect(r[0]?.codigo_interno).toBe("W-1");
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
        bulkItem({ codigo_interno: "B-1" }),
        bulkItem({ codigo_interno: "B-2", nombre: "Otro" }),
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
        bulkItem({ codigo_interno: "U-1", precio: 200, stock: 50 }),
      ]);
      expect(result[0].id).toBe(original.id);
      expect(result[0].created_at).toEqual(original.created_at);
      expect(result[0].precio).toBe(200);
      expect(result[0].stock).toBe(50);
    });

    test("bulkUpsert mezcla creates + updates preservando orden input", async () => {
      await repo.create(baseInsert({ codigo_interno: "MIX-EXIST", precio: 100 }));
      const result = await repo.bulkUpsert([
        bulkItem({ codigo_interno: "MIX-NEW-1" }),
        bulkItem({ codigo_interno: "MIX-EXIST", precio: 999 }),
        bulkItem({ codigo_interno: "MIX-NEW-2" }),
      ]);
      expect(result.map((r) => r.codigo_interno)).toEqual(["MIX-NEW-1", "MIX-EXIST", "MIX-NEW-2"]);
      expect(result[1].precio).toBe(999);
    });

    test("bulkUpsert throws si hay codigo_interno duplicado en el input", async () => {
      await expect(
        repo.bulkUpsert([
          bulkItem({ codigo_interno: "DUP" }),
          bulkItem({ codigo_interno: "DUP", precio: 500 }),
        ]),
      ).rejects.toThrow(/dup/i);
    });

    test("bulkUpsert con array vacío devuelve []", async () => {
      expect(await repo.bulkUpsert([])).toEqual([]);
    });

    test("bulkUpsert insert aplica defaults (activo true, compatibilidad [], imagen null)", async () => {
      const result = await repo.bulkUpsert([bulkItem({ codigo_interno: "DEF-1" })]);
      expect(result[0]?.activo).toBe(true);
      expect(result[0]?.compatibilidad).toEqual([]);
      expect(result[0]?.imagen_url).toBeNull();
    });

    test("bulkUpsert update preserva compatibilidad + imagen_url + activo", async () => {
      const original = await repo.create(
        baseInsert({
          codigo_interno: "PRES-1",
          compatibilidad: [
            { marca: "Toyota", modelo: "Hilux", anio_desde: 2016, anio_hasta: 2020 },
          ],
          imagen_url: "https://example.com/p.jpg",
          activo: false,
        }),
      );
      const result = await repo.bulkUpsert([bulkItem({ codigo_interno: "PRES-1", precio: 777 })]);
      expect(result[0]?.id).toBe(original.id);
      expect(result[0]?.precio).toBe(777);
      expect(result[0]?.compatibilidad).toEqual(original.compatibilidad);
      expect(result[0]?.imagen_url).toBe("https://example.com/p.jpg");
      expect(result[0]?.activo).toBe(false);
    });

    /*
     * `search` es el unico metodo con DOS implementaciones de la regla: la
     * funcion `public.buscar_productos` en Postgres y su espejo
     * `src/lib/catalogo/puntaje.ts`, que usa el repo in-memory. Este contrato
     * es lo que impide que se desincronicen — si divergen, la suite de unidad
     * queda en verde y el agente ordena distinto contra la base real.
     *
     * Los puntajes estan escritos como numeros y no como rangos a proposito:
     * un rango dejaria pasar justamente la divergencia que hay que atrapar.
     */
    describe("search", () => {
      // Sin palabras en comun entre el codigo y el nombre, el puntaje es solo
      // el del codigo: asi el numero es verificable y no depende del texto.
      const conCodigos = (o: Partial<ProductoInsert> = {}): ProductoInsert =>
        baseInsert({
          codigo_interno: "PF-1",
          codigo_fabrica: "96389106",
          otros_codigos: [],
          nombre: "Piston Aveo 1.6",
          categoria: "PISTONES",
          descripcion: "TEIKIN",
          compatibilidad: [],
          ...o,
        });

      test("el numero de fabrica dictado tal cual da 1000", async () => {
        const p = await repo.create(conCodigos());

        const hits = await repo.search({ q: "96389106" });

        expect(hits).toHaveLength(1);
        expect(hits[0]?.id).toBe(p.id);
        expect(hits[0]?.puntaje).toBe(1000);
        expect(hits[0]?.codigo_fabrica).toBe("96389106");
      });

      test("los sufijos de medida y de origen no cambian el resultado", async () => {
        // La casa escribe `/STD/K` encima del numero; el taller dicta el numero.
        await repo.create(conCodigos({ codigo_fabrica: "96389106/STD/K" }));

        const pelado = await repo.search({ q: "96389106" });
        const conSufijos = await repo.search({ q: "96389106/STD/K" });

        expect(pelado).toHaveLength(1);
        expect(conSufijos.map((h) => h.id)).toEqual(pelado.map((h) => h.id));
        expect(pelado[0]?.puntaje).toBe(1000);
      });

      test("los separadores tampoco: el cliente dicta como puede", async () => {
        const p = await repo.create(conCodigos());

        const hits = await repo.search({ q: "9638-9106" });

        expect(hits[0]?.id).toBe(p.id);
        expect(hits[0]?.puntaje).toBe(1000);
      });

      test("el codigo interno machea 900, debajo del de fabrica", async () => {
        await repo.create(conCodigos());

        const hits = await repo.search({ q: "PF-1" });

        expect(hits).toHaveLength(1);
        // 900 del codigo interno + 20: la palabra tambien acierta contra la
        // columna `codigo_interno` y acierta todas, lo que duplica.
        expect(hits[0]?.puntaje).toBe(920);
      });

      test("un codigo alterno machea, y queda debajo del de fabrica", async () => {
        // Medido sobre el catalogo real: 343 filas tienen el numero de fabrica
        // solo en esta columna. Ignorarlas cuesta 343 ventas.
        const dueno = await repo.create(conCodigos());
        const alterno = await repo.create(
          conCodigos({
            codigo_interno: "PF-2",
            codigo_fabrica: "30405",
            otros_codigos: ["96389106"],
          }),
        );

        const hits = await repo.search({ q: "96389106" });

        expect(hits.map((h) => h.id)).toEqual([dueno.id, alterno.id]);
        expect(hits[1]?.puntaje).toBe(700);
      });

      test("un producto inactivo no aparece", async () => {
        await repo.create(conCodigos({ activo: false }));

        expect(await repo.search({ q: "96389106" })).toEqual([]);
      });

      test("una consulta que no machea nada devuelve vacio", async () => {
        await repo.create(conCodigos());

        expect(await repo.search({ q: "00000000" })).toEqual([]);
      });

      test("respeta el tope", async () => {
        await repo.create(conCodigos({ codigo_interno: "PF-A", codigo_fabrica: "AAA1" }));
        await repo.create(conCodigos({ codigo_interno: "PF-B", codigo_fabrica: "AAA2" }));

        const hits = await repo.search({ q: "piston", tope: 1 });

        expect(hits).toHaveLength(1);
      });
    });
  });
}
