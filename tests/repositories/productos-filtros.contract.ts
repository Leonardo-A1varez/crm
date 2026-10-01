import { beforeEach, describe, expect, test } from "vitest";
import {
  parseOpcionesFacetas,
  parseProductosFiltros,
  SIN_CATEGORIA,
  SIN_MARCA,
  type OpcionesFacetasEntrada,
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

function opc(entrada: OpcionesFacetasEntrada = {}) {
  return parseOpcionesFacetas(entrada);
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

      test("sinMarcas excluye: todas menos las elegidas, incluida (sin marca)", async () => {
        const menosMobis = await repo.listarFiltrado(filtros({ sinMarcas: ["MOBIS"] }));
        expect(menosMobis.items.map((p) => p.codigo_interno).sort()).toEqual([
          "A-002",
          "B-200",
          "C%1",
          "C_2",
          "D-9",
        ]);
        const menosSin = await repo.listarFiltrado(filtros({ sinMarcas: [SIN_MARCA] }));
        expect(menosSin.total).toBe(5);
        const menosTres = await repo.listarFiltrado(
          filtros({ sinMarcas: ["MOBIS", "GM", SIN_MARCA] }),
        );
        expect(menosTres.items.map((p) => p.codigo_interno)).toEqual(["A-002"]);
      });

      test("sinCategorias excluye y se combina con marcas de la otra columna", async () => {
        const r = await repo.listarFiltrado(filtros({ sinCategorias: ["RADIADOR", "FRENOS"] }));
        expect(r.total).toBe(4);
        const comb = await repo.listarFiltrado(
          filtros({ sinCategorias: ["RADIADOR"], marcas: ["MOBIS"] }),
        );
        expect(comb.items.map((p) => p.codigo_interno)).toEqual(["A-001"]);
      });

      test("categoría nula o en blanco se agrupa en (sin categoría) y se puede marcar o excluir", async () => {
        await sembrar(repo, [
          { codigo_interno: "N-1", nombre: "Sin cat nula", categoria: null },
          { codigo_interno: "N-2", nombre: "Sin cat blanca", categoria: " \t " },
        ]);
        const incluir = await repo.listarFiltrado(filtros({ categorias: [SIN_CATEGORIA] }));
        expect(incluir.items.map((p) => p.codigo_interno).sort()).toEqual(["N-1", "N-2"]);
        const excluir = await repo.listarFiltrado(filtros({ sinCategorias: [SIN_CATEGORIA] }));
        expect(excluir.total).toBe(7);
        const f = await repo.facetas(filtros(), opc());
        expect(f.categorias.valores.find((v) => v.valor === SIN_CATEGORIA)?.cantidad).toBe(2);
      });

      test("los espacios de los bordes (espacio, tab, CR, LF, NBSP) no cambian la marca ni la categoría", async () => {
        await sembrar(repo, [
          {
            codigo_interno: "W-1",
            nombre: "Con espacios uno",
            descripcion: "\tMOBIS ",
            categoria: " FRENOS\r\n",
          },
          {
            codigo_interno: "W-2",
            nombre: "Con espacios dos",
            descripcion: " MOBIS ",
            categoria: " FRENOS",
          },
        ]);
        const marca = await repo.listarFiltrado(filtros({ marcas: ["MOBIS"] }));
        expect(marca.items.map((p) => p.codigo_interno).sort()).toEqual([
          "A-001",
          "B-100",
          "W-1",
          "W-2",
        ]);
        const cat = await repo.listarFiltrado(filtros({ categorias: ["FRENOS"] }));
        expect(cat.items.map((p) => p.codigo_interno).sort()).toEqual(["B-200", "W-1", "W-2"]);

        // El valor que devuelve la faceta es exactamente el que se filtra.
        const f = await repo.facetas(filtros(), opc());
        expect(f.marcas.valores.find((v) => v.valor === "MOBIS")?.cantidad).toBe(4);
        expect(f.categorias.valores.find((v) => v.valor === "FRENOS")?.cantidad).toBe(3);
        for (const v of [...f.marcas.valores, ...f.categorias.valores]) {
          expect(v.valor).toBe(v.valor.replace(/^[ \t\r\n ]+|[ \t\r\n ]+$/g, ""));
        }
        const porFaceta = await repo.listarFiltrado(
          filtros({
            marcas: f.marcas.valores.filter((v) => v.valor === "MOBIS").map((v) => v.valor),
          }),
        );
        expect(porFaceta.total).toBe(4);
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
        const f = await repo.facetas(filtros(), opc());
        expect(f.categorias.valores).toEqual([
          { valor: "OTRA", cantidad: 1000 },
          { valor: "CINCO", cantidad: 250 },
        ]);
        expect(f.marcas.valores).toEqual([
          { valor: SIN_MARCA, cantidad: 625 },
          { valor: "MOBIS", cantidad: 625 },
        ]);
      }, 60_000);

      test("muchas marcas de una sola fila: todas se pueden encontrar y 'todas menos 3' son 3 valores", async () => {
        const N = 700;
        const marca = (i: number) => `M${String(i).padStart(4, "0")}`;
        await repo.bulkUpsert(
          Array.from({ length: N }, (_, i) => ({
            codigo_interno: `Q-${String(i).padStart(4, "0")}`,
            sku_proveedor: null,
            nombre: `Producto ${i}`,
            descripcion: marca(i),
            categoria: "UNICA",
            precio: 1,
            stock: 1,
          })),
        );

        // Con el tope de 500, la lista completa queda recortada y lo dice.
        const lista = await repo.facetas(filtros(), opc({ limite: 500 }));
        expect(lista.marcas.valores).toHaveLength(500);
        expect(lista.marcas.distintos).toBe(N);

        // Una marca fuera del top se encuentra buscándola.
        const buscada = await repo.facetas(filtros(), opc({ limite: 500, qMarca: "m0699" }));
        expect(buscada.marcas.valores).toEqual([{ valor: "M0699", cantidad: 1 }]);
        expect(buscada.marcas.distintos).toBe(1);

        // Todas menos 3: tres valores en la URL, no 697.
        const menos3 = await repo.listarFiltrado(
          filtros({ sinMarcas: [marca(0), marca(1), marca(2)], porPagina: 100 }),
        );
        expect(menos3.total).toBe(N - 3);
        expect(menos3.items.map((p) => p.descripcion)).not.toContain(marca(0));

        // Y la faceta de marcas, con esa exclusión, sigue mostrando las 3 excluidas.
        const f = await repo.facetas(filtros({ sinMarcas: [marca(0), marca(1), marca(2)] }), opc());
        expect(f.marcas.valores.map((v) => v.valor)).toEqual(
          expect.arrayContaining([marca(0), marca(1), marca(2)]),
        );
      }, 60_000);
    });

    describe("facetas", () => {
      beforeEach(async () => {
        await sembrar(repo, CATALOGO);
      });

      test("sin filtros: valores distintos con su cantidad, de mayor a menor y por nombre", async () => {
        const f = await repo.facetas(filtros(), opc());
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
        const f = await repo.facetas(
          filtros({ categorias: ["RADIADOR"], marcas: ["MOBIS"] }),
          opc(),
        );
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
        const f = await repo.facetas(filtros({ estado: "activo", conStock: true }), opc());
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
        const a = await repo.facetas(filtros({ pagina: 1, porPagina: 1 }), opc());
        const b = await repo.facetas(filtros({ pagina: 3, porPagina: 2 }), opc());
        expect(b).toEqual(a);
      });

      test("limite recorta la lista pero distintos cuenta todos", async () => {
        const f = await repo.facetas(filtros(), opc({ limite: 2 }));
        expect(f.categorias.valores).toHaveLength(2);
        expect(f.categorias.distintos).toBe(4);
        expect(f.marcas.valores).toHaveLength(2);
        expect(f.marcas.distintos).toBe(4);
      });

      test("en modo excluir, la faceta de esa columna ignora la exclusión y la otra la aplica", async () => {
        const f = await repo.facetas(filtros({ sinMarcas: ["MOBIS"] }), opc());
        // Marcas: la exclusión propia se ignora → MOBIS sigue en la lista, con sus 2.
        expect(f.marcas.valores.find((v) => v.valor === "MOBIS")?.cantidad).toBe(2);
        expect(f.marcas.distintos).toBe(4);
        // Categorías: sí se aplica → sin los productos MOBIS no queda VALVULA de A-001.
        expect(f.categorias.valores).toEqual([
          { valor: "FILTRO", cantidad: 2 },
          { valor: "FRENOS", cantidad: 1 },
          { valor: "RADIADOR", cantidad: 1 },
          { valor: "VALVULA", cantidad: 1 },
        ]);
      });

      test("qMarca y qCategoria buscan dentro de la lista: plegado, contiene, sin tildes", async () => {
        const marcas = await repo.facetas(filtros(), opc({ qMarca: "mob" }));
        expect(marcas.marcas.valores).toEqual([{ valor: "MOBIS", cantidad: 2 }]);
        expect(marcas.marcas.distintos).toBe(1);
        // La otra lista no se toca.
        expect(marcas.categorias.distintos).toBe(4);

        const cats = await repo.facetas(filtros(), opc({ qCategoria: "VÁLV" }));
        expect(cats.categorias.valores).toEqual([{ valor: "VALVULA", cantidad: 2 }]);
        expect(cats.marcas.distintos).toBe(4);

        const sinMarca = await repo.facetas(filtros(), opc({ qMarca: "sin marca" }));
        expect(sinMarca.marcas.valores).toEqual([{ valor: SIN_MARCA, cantidad: 2 }]);
      });

      test("la búsqueda dentro de la lista trata los comodines como texto", async () => {
        const f = await repo.facetas(filtros(), opc({ qMarca: "%", qCategoria: "_" }));
        expect(f.marcas).toEqual({ valores: [], distintos: 0 });
        expect(f.categorias).toEqual({ valores: [], distintos: 0 });
      });

      test("la búsqueda se aplica antes del límite: un valor de pocas filas igual aparece", async () => {
        // Sin búsqueda y con límite 1, CHINA (1 fila) queda fuera del top.
        const sin = await repo.facetas(filtros(), opc({ limite: 1 }));
        expect(sin.marcas.valores.map((v) => v.valor)).not.toContain("CHINA");
        const con = await repo.facetas(filtros(), opc({ limite: 1, qMarca: "chin" }));
        expect(con.marcas.valores).toEqual([{ valor: "CHINA", cantidad: 1 }]);
      });

      test("la búsqueda también recorta los valores seleccionados que no coinciden", async () => {
        const f = await repo.facetas(filtros({ marcas: ["GM"] }), opc({ qMarca: "mob" }));
        expect(f.marcas.valores.map((v) => v.valor)).toEqual(["MOBIS"]);
      });

      test("los filtros activos siguen recortando las cantidades de la lista buscada", async () => {
        const f = await repo.facetas(filtros({ categorias: ["RADIADOR"] }), opc({ qMarca: "mob" }));
        expect(f.marcas.valores).toEqual([{ valor: "MOBIS", cantidad: 1 }]);
      });

      test("columna calcula solo esa lista y deja la otra vacía", async () => {
        const todas = await repo.facetas(filtros({ q: "a" }), opc());
        const soloMarcas = await repo.facetas(filtros({ q: "a" }), opc({ columna: "marca" }));
        expect(soloMarcas.marcas).toEqual(todas.marcas);
        expect(soloMarcas.categorias).toEqual({ valores: [], distintos: 0 });
        const soloCats = await repo.facetas(filtros({ q: "a" }), opc({ columna: "categoria" }));
        expect(soloCats.categorias).toEqual(todas.categorias);
        expect(soloCats.marcas).toEqual({ valores: [], distintos: 0 });
      });

      test("columna respeta la búsqueda dentro de su lista y los valores seleccionados", async () => {
        const f = await repo.facetas(
          filtros({ marcas: ["GM"] }),
          opc({ columna: "marca", qMarca: "mob" }),
        );
        expect(f.marcas.valores.map((v) => v.valor)).toEqual(["MOBIS"]);
        expect(f.categorias.valores).toEqual([]);
      });

      test("distintos no cuenta los valores seleccionados sin filas", async () => {
        const cat = await repo.facetas(filtros({ categorias: ["FANTASMA"] }), opc());
        expect(cat.categorias.valores.find((v) => v.valor === "FANTASMA")?.cantidad).toBe(0);
        expect(cat.categorias.distintos).toBe(4);
        const marca = await repo.facetas(filtros({ sinMarcas: ["OTRO FANTASMA"] }), opc());
        expect(marca.marcas.valores.find((v) => v.valor === "OTRO FANTASMA")?.cantidad).toBe(0);
        expect(marca.marcas.distintos).toBe(4);
      });

      test("un valor seleccionado aparece aunque quede fuera del límite, o sin filas (cantidad 0)", async () => {
        const f = await repo.facetas(
          filtros({ categorias: ["FRENOS", "FANTASMA"] }),
          opc({ limite: 1 }),
        );
        const valores = f.categorias.valores.map((v) => v.valor);
        expect(valores).toContain("FRENOS");
        expect(valores).toContain("FANTASMA");
        expect(f.categorias.valores.find((v) => v.valor === "FANTASMA")?.cantidad).toBe(0);
      });
    });

    describe("q: buscador general", () => {
      // Catálogo propio: los códigos de fábrica y alternos solo importan acá.
      const BUSCABLE: Seed[] = [
        {
          codigo_interno: "Q-001",
          nombre: "Bomba de agua Aveo",
          categoria: "ENFRIAMIENTO",
          descripcion: "MOBIS",
          codigo_fabrica: "96817-4N000",
          otros_codigos: ["ALT-555", "ZZ.99"],
          precio: 40,
          stock: 5,
        },
        {
          codigo_interno: "Q-002",
          nombre: "Radiador Corolla",
          categoria: "ENFRIAMIENTO",
          descripcion: "Nissan",
          codigo_fabrica: "TOY-77",
          precio: 300,
          stock: 0,
        },
        {
          codigo_interno: "Q-003",
          nombre: "Filtro de aire",
          categoria: "BOMBA",
          descripcion: null,
          precio: 10,
          stock: 9,
        },
        {
          codigo_interno: "Q-004",
          nombre: "Tapón 100% hermético",
          categoria: "MOTOR",
          descripcion: "  ",
          precio: 2,
          stock: 1,
          activo: false,
        },
        {
          codigo_interno: "Q-005",
          nombre: "Cañería_larga",
          categoria: "MOTOR",
          descripcion: "Ñuñoa Parts",
          precio: 20,
          stock: 3,
        },
      ];

      beforeEach(async () => {
        await sembrar(repo, BUSCABLE);
      });

      const codigos = (r: { items: { codigo_interno: string }[] }) =>
        r.items.map((p) => p.codigo_interno).sort();
      const buscar = async (entrada: ProductosFiltrosEntrada) =>
        codigos(await repo.listarFiltrado(filtros(entrada)));

      test("sin q, o en blanco, no filtra", async () => {
        expect((await repo.listarFiltrado(filtros({ q: "   " }))).total).toBe(5);
      });

      test("busca en el código interno", async () => {
        expect(await buscar({ q: "q-003" })).toEqual(["Q-003"]);
      });

      test("busca en el código de fábrica", async () => {
        expect(await buscar({ q: "96817" })).toEqual(["Q-001"]);
        expect(await buscar({ q: "toy-77" })).toEqual(["Q-002"]);
      });

      test("busca en los códigos alternos", async () => {
        expect(await buscar({ q: "alt-55" })).toEqual(["Q-001"]);
        expect(await buscar({ q: "zz.99" })).toEqual(["Q-001"]);
      });

      test("busca en la descripción (el campo nombre)", async () => {
        expect(await buscar({ q: "radiador" })).toEqual(["Q-002"]);
      });

      test("busca en la marca, plegado y sin tildes", async () => {
        expect(await buscar({ q: "mobis" })).toEqual(["Q-001"]);
        expect(await buscar({ q: "NUNOA" })).toEqual(["Q-005"]);
      });

      test("no busca en la categoría: 'enfriamiento' no trae nada", async () => {
        expect(await buscar({ q: "enfriamiento" })).toEqual([]);
      });

      test("'bomba' trae la bomba de agua por nombre, no el filtro de la categoría BOMBA", async () => {
        expect(await buscar({ q: "bomba" })).toEqual(["Q-001"]);
      });

      test("un q con espacios no coincide a caballo entre dos campos", async () => {
        // "q-003" es el código y "filtro de aire" el nombre del mismo producto.
        expect(await buscar({ q: "q-003 filtro" })).toEqual([]);
        expect(await buscar({ q: "filtro de aire" })).toEqual(["Q-003"]);
        // Los alternos sí se buscan como una lista separada por espacios.
        expect(await buscar({ q: "alt-555 zz.99" })).toEqual(["Q-001"]);
      });

      test("la marca sentinela no es buscable: 'sin marca' no trae los productos sin marca", async () => {
        expect(await buscar({ q: "sin marca" })).toEqual([]);
      });

      test("es 'contiene': coincide en medio de un campo", async () => {
        expect(await buscar({ q: "ave" })).toEqual(["Q-001"]);
      });

      test("% y _ son texto literal, no comodines", async () => {
        expect(await buscar({ q: "100%" })).toEqual(["Q-004"]);
        expect(await buscar({ q: "ñería_l" })).toEqual(["Q-005"]);
        expect(await buscar({ q: "%" })).toEqual(["Q-004"]);
        expect(await buscar({ q: "_" })).toEqual(["Q-005"]);
      });

      test("se combina con AND con los demás filtros", async () => {
        expect(await buscar({ q: "bomba", categorias: ["ENFRIAMIENTO"] })).toEqual(["Q-001"]);
        expect(await buscar({ q: "bomba", categorias: ["MOTOR"] })).toEqual([]);
        expect(await buscar({ q: "a", conStock: false })).toEqual(["Q-002"]);
        expect(await buscar({ q: "a", estado: "inactivo" })).toEqual(["Q-004"]);
        expect(await buscar({ q: "o", estado: "activo", precioMax: 50 })).toEqual([
          "Q-001",
          "Q-003",
          "Q-005",
        ]);
      });

      test("el total y la paginación son los del resultado buscado", async () => {
        const todos = await repo.listarFiltrado(filtros({ q: "a", porPagina: 100 }));
        const r = await repo.listarFiltrado(filtros({ q: "a", pagina: 2, porPagina: 2 }));
        expect(r.total).toBe(todos.total);
        expect(r.items.map((p) => p.codigo_interno)).toEqual(
          todos.items.slice(2, 4).map((p) => p.codigo_interno),
        );
      });

      test("las facetas respetan q en las dos columnas", async () => {
        const f = await repo.facetas(filtros({ q: "bomba" }), opc());
        expect(f.categorias.valores).toEqual([{ valor: "ENFRIAMIENTO", cantidad: 1 }]);
        expect(f.marcas.valores).toEqual([{ valor: "MOBIS", cantidad: 1 }]);
      });

      test("en la faceta, q se combina con los filtros de la otra columna", async () => {
        // "o" aparece en los cinco productos (bomba, radiador, filtro, tapón, Ñuñoa).
        const f = await repo.facetas(filtros({ q: "o", categorias: ["MOTOR"] }), opc());
        // Marcas respeta categorías (MOTOR) y q.
        expect(f.marcas.valores.map((v) => v.valor).sort()).toEqual(
          [SIN_MARCA, "Ñuñoa Parts"].sort(),
        );
        // Categorías ignora las suyas pero aplica q.
        expect(f.categorias.valores.map((v) => v.valor).sort()).toEqual([
          "BOMBA",
          "ENFRIAMIENTO",
          "MOTOR",
        ]);
      });
    });

    test("catálogo vacío: listado y facetas vacíos", async () => {
      const f = await repo.facetas(filtros(), opc());
      expect(f.categorias).toEqual({ valores: [], distintos: 0 });
      expect(f.marcas).toEqual({ valores: [], distintos: 0 });
      expect(await repo.listarFiltrado(filtros())).toMatchObject({ items: [], total: 0 });
    });
  });
}
