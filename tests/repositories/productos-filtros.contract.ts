import { beforeEach, describe, expect, test } from "vitest";
import {
  parseProductosFiltros,
  SIN_MARCA,
  type ProductosFiltrosEntrada,
} from "@/lib/validation/productos-filtros.schema";
import type { ProductoInsert, ProductsRepository } from "@/server/repositories/productos.repo";

// Contrato de filtrado, paginación y facetas de `ProductsRepository`. Lo corren
// el repo in-memory y el de Supabase contra Postgres real: si divergen, la
// pantalla muestra distinto según dónde corra y nadie se entera.

type Seed = Partial<ProductoInsert> & { codigo_interno: string; nombre: string };

function producto(s: Seed): ProductoInsert {
  return {
    sku_proveedor: null,
    descripcion: null,
    categoria: "FRENOS",
    compatibilidad: [],
    precio: 100,
    stock: 5,
    imagen_url: null,
    activo: true,
    ...s,
  };
}

function filtros(entrada: ProductosFiltrosEntrada = {}) {
  return parseProductosFiltros(entrada);
}

async function sembrar(repo: ProductsRepository, seeds: Seed[]): Promise<void> {
  for (const s of seeds) await repo.create(producto(s));
}

const nombres = (r: { items: { nombre: string }[] }) => r.items.map((p) => p.nombre);

/** Catálogo chico con un caso de cada borde que importa. */
const CATALOGO: Seed[] = [
  {
    codigo_interno: "A-001",
    nombre: "Válvula EGR Aveo",
    categoria: "VALVULA",
    descripcion: "MOBIS",
    precio: 50,
    stock: 10,
  },
  {
    codigo_interno: "A-002",
    nombre: "Radiador Aveo",
    categoria: "RADIADOR",
    descripcion: "CHINA",
    precio: 200,
    stock: 0,
  },
  {
    codigo_interno: "B-100",
    nombre: "Radiador Spark",
    categoria: "RADIADOR",
    descripcion: "MOBIS",
    precio: 250.5,
    stock: 3,
  },
  {
    codigo_interno: "B-200",
    nombre: "Pastilla freno Corolla",
    categoria: "FRENOS",
    descripcion: null,
    precio: 80,
    stock: 7,
  },
  {
    codigo_interno: "C%1",
    nombre: "Filtro 100% aire",
    categoria: "FILTRO",
    descripcion: "   ",
    precio: 15,
    stock: 20,
  },
  {
    codigo_interno: "C_2",
    nombre: "Filtro aceite",
    categoria: "FILTRO",
    descripcion: "GM",
    precio: 12,
    stock: 1,
    activo: false,
  },
  {
    codigo_interno: "D-9",
    nombre: "Ñandú tapón",
    categoria: "VALVULA",
    descripcion: "GM",
    precio: 5,
    stock: 0,
    activo: false,
  },
];

export function runProductosFiltrosContract(makeRepo: () => ProductsRepository) {
  describe("ProductsRepository: filtrado, paginación y facetas", () => {
    let repo: ProductsRepository;

    beforeEach(() => {
      repo = makeRepo();
    });

    describe("listarFiltrado", () => {
      beforeEach(async () => {
        await sembrar(repo, CATALOGO);
      });

      test("sin filtros devuelve todo ordenado por nombre y codigo_interno, con el total real", async () => {
        const r = await repo.listarFiltrado(filtros());
        expect(r.total).toBe(7);
        expect(r.pagina).toBe(1);
        expect(r.porPagina).toBe(50);
        expect(r.items).toHaveLength(7);
        expect(r.items[0]).toMatchObject({ id: expect.any(String), compatibilidad: [] });
        expect(r.items[0]?.created_at).toBeInstanceOf(Date);
        // Orden por nombre: el desempate por codigo_interno se prueba abajo.
        const orden = nombres(r);
        expect(orden).toEqual([...orden].sort((a, b) => a.localeCompare(b)));
      });

      test("nombres iguales se desempatan por codigo_interno", async () => {
        await sembrar(repo, [
          { codigo_interno: "Z-2", nombre: "Gemelo" },
          { codigo_interno: "Z-1", nombre: "Gemelo" },
        ]);
        const r = await repo.listarFiltrado(filtros({ descripcion: "gemelo" }));
        expect(r.items.map((p) => p.codigo_interno)).toEqual(["Z-1", "Z-2"]);
      });

      test("codigo contiene: sin distinguir mayúsculas", async () => {
        const r = await repo.listarFiltrado(filtros({ codigo: "b-" }));
        expect(r.items.map((p) => p.codigo_interno).sort()).toEqual(["B-100", "B-200"]);
        expect(r.total).toBe(2);
      });

      test("codigo empieza no matchea en el medio", async () => {
        const contiene = await repo.listarFiltrado(filtros({ codigo: "100" }));
        expect(contiene.items.map((p) => p.codigo_interno)).toEqual(["B-100"]);
        const empieza = await repo.listarFiltrado(
          filtros({ codigo: "100", codigoModo: "empieza" }),
        );
        expect(empieza.total).toBe(0);
        const empieza2 = await repo.listarFiltrado(
          filtros({ codigo: "A-", codigoModo: "empieza" }),
        );
        expect(empieza2.items.map((p) => p.codigo_interno).sort()).toEqual(["A-001", "A-002"]);
      });

      test("los comodines de LIKE en el texto son literales", async () => {
        const porcentaje = await repo.listarFiltrado(filtros({ codigo: "%" }));
        expect(porcentaje.items.map((p) => p.codigo_interno)).toEqual(["C%1"]);
        const guion = await repo.listarFiltrado(filtros({ codigo: "_" }));
        expect(guion.items.map((p) => p.codigo_interno)).toEqual(["C_2"]);
        const enNombre = await repo.listarFiltrado(filtros({ descripcion: "100%" }));
        expect(enNombre.items.map((p) => p.codigo_interno)).toEqual(["C%1"]);
        const barra = await repo.listarFiltrado(filtros({ codigo: "\\" }));
        expect(barra.total).toBe(0);
      });

      test("descripcion filtra sobre nombre, sin distinguir tildes ni mayúsculas", async () => {
        const r = await repo.listarFiltrado(filtros({ descripcion: "VALVULA" }));
        expect(nombres(r)).toEqual(["Válvula EGR Aveo"]);
        const r2 = await repo.listarFiltrado(filtros({ descripcion: "válvula egr" }));
        expect(nombres(r2)).toEqual(["Válvula EGR Aveo"]);
        const r3 = await repo.listarFiltrado(filtros({ descripcion: "nandu" }));
        expect(nombres(r3)).toEqual(["Ñandú tapón"]);
      });

      test("descripcion empieza vs contiene", async () => {
        const empieza = await repo.listarFiltrado(
          filtros({ descripcion: "radiador", descripcionModo: "empieza" }),
        );
        expect(empieza.total).toBe(2);
        const noEmpieza = await repo.listarFiltrado(
          filtros({ descripcion: "aveo", descripcionModo: "empieza" }),
        );
        expect(noEmpieza.total).toBe(0);
        const contiene = await repo.listarFiltrado(filtros({ descripcion: "aveo" }));
        expect(contiene.total).toBe(2);
      });

      test("categorias es un IN", async () => {
        const r = await repo.listarFiltrado(filtros({ categorias: ["RADIADOR", "FRENOS"] }));
        expect(r.total).toBe(3);
        const una = await repo.listarFiltrado(filtros({ categorias: "FILTRO" }));
        expect(una.total).toBe(2);
        const ninguna = await repo.listarFiltrado(filtros({ categorias: ["NO EXISTE"] }));
        expect(ninguna.total).toBe(0);
      });

      test("marcas es un IN sobre descripcion; (sin marca) es nula o en blanco", async () => {
        const mobis = await repo.listarFiltrado(filtros({ marcas: ["MOBIS"] }));
        expect(mobis.items.map((p) => p.codigo_interno).sort()).toEqual(["A-001", "B-100"]);
        const sin = await repo.listarFiltrado(filtros({ marcas: [SIN_MARCA] }));
        expect(sin.items.map((p) => p.codigo_interno).sort()).toEqual(["B-200", "C%1"]);
        const mezcla = await repo.listarFiltrado(filtros({ marcas: [SIN_MARCA, "GM"] }));
        expect(mezcla.total).toBe(4);
      });

      test("precio y stock: rangos inclusivos", async () => {
        const precio = await repo.listarFiltrado(filtros({ precioMin: 80, precioMax: 200 }));
        expect(precio.items.map((p) => p.codigo_interno).sort()).toEqual(["A-002", "B-200"]);
        const soloMin = await repo.listarFiltrado(filtros({ precioMin: 250.5 }));
        expect(soloMin.items.map((p) => p.codigo_interno)).toEqual(["B-100"]);
        const stock = await repo.listarFiltrado(filtros({ stockMin: 3, stockMax: 7 }));
        expect(stock.items.map((p) => p.codigo_interno).sort()).toEqual(["B-100", "B-200"]);
      });

      test("conStock true es stock > 0 y false es stock = 0", async () => {
        const con = await repo.listarFiltrado(filtros({ conStock: true }));
        expect(con.total).toBe(5);
        const sin = await repo.listarFiltrado(filtros({ conStock: false }));
        expect(sin.items.map((p) => p.codigo_interno).sort()).toEqual(["A-002", "D-9"]);
      });

      test("estado activo / inactivo", async () => {
        const activos = await repo.listarFiltrado(filtros({ estado: "activo" }));
        expect(activos.total).toBe(5);
        const inactivos = await repo.listarFiltrado(filtros({ estado: "inactivo" }));
        expect(inactivos.items.map((p) => p.codigo_interno).sort()).toEqual(["C_2", "D-9"]);
      });

      test("los filtros se combinan con AND", async () => {
        const r = await repo.listarFiltrado(
          filtros({
            categorias: ["RADIADOR"],
            marcas: ["MOBIS"],
            conStock: true,
            estado: "activo",
            descripcion: "spark",
            precioMax: 300,
          }),
        );
        expect(r.items.map((p) => p.codigo_interno)).toEqual(["B-100"]);
        expect(r.total).toBe(1);
      });

      test("sin coincidencias: items vacío y total 0", async () => {
        const r = await repo.listarFiltrado(filtros({ codigo: "zzz" }));
        expect(r).toMatchObject({ items: [], total: 0, pagina: 1, porPagina: 50 });
      });

      test("paginación: el total es el filtrado y no el de la página; fuera de rango da vacío con total", async () => {
        const p1 = await repo.listarFiltrado(filtros({ porPagina: 3 }));
        const p2 = await repo.listarFiltrado(filtros({ porPagina: 3, pagina: 2 }));
        const p3 = await repo.listarFiltrado(filtros({ porPagina: 3, pagina: 3 }));
        const p4 = await repo.listarFiltrado(filtros({ porPagina: 3, pagina: 4 }));
        expect([p1.items.length, p2.items.length, p3.items.length, p4.items.length]).toEqual([
          3, 3, 1, 0,
        ]);
        expect([p1.total, p2.total, p3.total, p4.total]).toEqual([7, 7, 7, 7]);
        expect(p4.pagina).toBe(4);
        const todos = [...p1.items, ...p2.items, ...p3.items].map((p) => p.id);
        expect(new Set(todos).size).toBe(7);
      });
    });

    describe("más de 1.000 filas (lección 12)", () => {
      test("el total y las páginas cubren todo el catálogo, sin repetir ni saltear", async () => {
        const N = 1250;
        const items = Array.from({ length: N }, (_, i) => ({
          codigo_interno: `P-${String(i).padStart(5, "0")}`,
          sku_proveedor: null,
          nombre: `Repuesto ${String(i).padStart(5, "0")}`,
          descripcion: i % 2 === 0 ? "MOBIS" : null,
          categoria: i % 5 === 0 ? "CINCO" : "OTRA",
          precio: i,
          stock: i % 3,
        }));
        await repo.bulkUpsert(items);

        const primera = await repo.listarFiltrado(filtros());
        expect(primera.total).toBe(N);

        const vistos: string[] = [];
        for (let pagina = 1; pagina <= 13; pagina++) {
          const r = await repo.listarFiltrado(filtros({ pagina, porPagina: 100 }));
          expect(r.total).toBe(N);
          vistos.push(...r.items.map((p) => p.codigo_interno));
        }
        expect(vistos).toHaveLength(N);
        expect(new Set(vistos).size).toBe(N);
        expect(vistos).toEqual([...vistos].sort());

        // Un filtro que deja más de 1.000 filas también cuenta todas.
        const mobis = await repo.listarFiltrado(filtros({ marcas: ["MOBIS"] }));
        expect(mobis.total).toBe(625);

        // Las facetas cuentan sobre el catálogo entero, no sobre una muestra.
        const f = await repo.facetas(filtros(), 500);
        expect(f.categorias.valores).toEqual([
          { valor: "OTRA", cantidad: 1000 },
          { valor: "CINCO", cantidad: 250 },
        ]);
        expect(f.marcas.valores).toEqual([
          { valor: SIN_MARCA, cantidad: 625 },
          { valor: "MOBIS", cantidad: 625 },
        ]);
      }, 60_000);
    });

    describe("facetas", () => {
      beforeEach(async () => {
        await sembrar(repo, CATALOGO);
      });

      test("sin filtros: valores distintos con su cantidad, de mayor a menor y por nombre", async () => {
        const f = await repo.facetas(filtros(), 500);
        expect(f.categorias.valores).toEqual([
          { valor: "FILTRO", cantidad: 2 },
          { valor: "RADIADOR", cantidad: 2 },
          { valor: "VALVULA", cantidad: 2 },
          { valor: "FRENOS", cantidad: 1 },
        ]);
        expect(f.categorias.distintos).toBe(4);
        // Empate de cantidad: por valor en orden binario ("(" antes que las letras).
        expect(f.marcas.valores).toEqual([
          { valor: SIN_MARCA, cantidad: 2 },
          { valor: "GM", cantidad: 2 },
          { valor: "MOBIS", cantidad: 2 },
          { valor: "CHINA", cantidad: 1 },
        ]);
        expect(f.marcas.distintos).toBe(4);
      });

      test("cada faceta respeta todos los filtros menos el de su propia columna", async () => {
        const f = await repo.facetas(filtros({ categorias: ["RADIADOR"], marcas: ["MOBIS"] }), 500);
        // Categorías: marca MOBIS aplicada, categoría ignorada → VALVULA y RADIADOR.
        expect(f.categorias.valores).toEqual([
          { valor: "RADIADOR", cantidad: 1 },
          { valor: "VALVULA", cantidad: 1 },
        ]);
        // Marcas: categoría RADIADOR aplicada, marca ignorada → CHINA y MOBIS.
        expect(f.marcas.valores).toEqual([
          { valor: "CHINA", cantidad: 1 },
          { valor: "MOBIS", cantidad: 1 },
        ]);
      });

      test("los demás filtros (texto, precio, stock, estado) sí recortan las dos facetas", async () => {
        const f = await repo.facetas(filtros({ estado: "activo", conStock: true }), 500);
        expect(f.categorias.valores).toEqual([
          { valor: "FILTRO", cantidad: 1 },
          { valor: "FRENOS", cantidad: 1 },
          { valor: "RADIADOR", cantidad: 1 },
          { valor: "VALVULA", cantidad: 1 },
        ]);
        expect(f.marcas.valores.map((v) => v.valor).sort()).toEqual(["MOBIS", SIN_MARCA].sort());
        expect(f.marcas.valores.find((v) => v.valor === SIN_MARCA)?.cantidad).toBe(2);
      });

      test("la paginación no afecta las facetas", async () => {
        const a = await repo.facetas(filtros({ pagina: 1, porPagina: 1 }), 500);
        const b = await repo.facetas(filtros({ pagina: 3, porPagina: 2 }), 500);
        expect(b).toEqual(a);
      });

      test("limite recorta la lista pero distintos cuenta todos", async () => {
        const f = await repo.facetas(filtros(), 2);
        expect(f.categorias.valores).toHaveLength(2);
        expect(f.categorias.distintos).toBe(4);
        expect(f.marcas.valores).toHaveLength(2);
        expect(f.marcas.distintos).toBe(4);
      });

      test("un valor seleccionado aparece aunque quede fuera del límite, o sin filas (cantidad 0)", async () => {
        const f = await repo.facetas(filtros({ categorias: ["FRENOS", "FANTASMA"] }), 1);
        const valores = f.categorias.valores.map((v) => v.valor);
        expect(valores).toContain("FRENOS");
        expect(valores).toContain("FANTASMA");
        expect(f.categorias.valores.find((v) => v.valor === "FANTASMA")?.cantidad).toBe(0);
      });
    });

    test("catálogo vacío: listado y facetas vacíos", async () => {
      const f = await repo.facetas(filtros(), 500);
      expect(f.categorias).toEqual({ valores: [], distintos: 0 });
      expect(f.marcas).toEqual({ valores: [], distintos: 0 });
      expect(await repo.listarFiltrado(filtros())).toMatchObject({ items: [], total: 0 });
    });
  });
}
