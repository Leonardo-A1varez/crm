import { beforeEach, describe, expect, test } from "vitest";
import {
  parseLote,
  parseOpcionesFaceta,
  parseProductosFiltros,
  LOTE_TAMANO,
  SIN_CATEGORIA,
  SIN_CODIGO_FABRICA,
  SIN_DESCRIPCION,
  SIN_MARCA,
  SIN_OTROS_CODIGOS,
  type OpcionesFacetaEntrada,
  type ProductosFiltrosEntrada,
} from "@/lib/validation/productos-filtros.schema";
import type { ProductoInsert, ProductsRepository } from "@/server/repositories/productos.repo";

// Contrato de filtrado, orden, lotes y listas de valores de `ProductsRepository`. Lo
// corren el repo in-memory y el de Supabase contra Postgres real: si divergen, la
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

function opc(entrada: OpcionesFacetaEntrada) {
  return parseOpcionesFaceta(entrada);
}

async function sembrar(repo: ProductsRepository, seeds: Seed[]): Promise<void> {
  for (const s of seeds) await repo.create(producto(s));
}

const nombres = (r: { filas: { nombre: string }[] }) => r.filas.map((p) => p.nombre);
const codigos = (r: { filas: { codigo_interno: string }[] }) =>
  r.filas.map((p) => p.codigo_interno);

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

/** Códigos de fábrica y alternos: solo importan en las pruebas de esas dos columnas. */
const CON_CODIGOS: Seed[] = [
  {
    codigo_interno: "K-1",
    nombre: "Bomba uno",
    codigo_fabrica: "96817-4N000",
    otros_codigos: ["ALT-555", "ZZ.99"],
  },
  { codigo_interno: "K-2", nombre: "Bomba dos", codigo_fabrica: "96817-4N000" },
  {
    codigo_interno: "K-3",
    nombre: "Bomba tres",
    codigo_fabrica: " TOY-77\t",
    otros_codigos: ["ZZ.99"],
  },
  { codigo_interno: "K-4", nombre: "Bomba cuatro", codigo_fabrica: "   " },
  { codigo_interno: "K-5", nombre: "Bomba cinco", codigo_fabrica: null, otros_codigos: [] },
];

export function runProductosFiltrosContract(makeRepo: () => ProductsRepository) {
  describe("ProductsRepository: filtrado, orden, lotes y listas de valores", () => {
    let repo: ProductsRepository;

    beforeEach(() => {
      repo = makeRepo();
    });

    const lote = (entrada: ProductosFiltrosEntrada = {}, n = 1) =>
      repo.listarLote(filtros(entrada), parseLote(n));
    const faceta = (columna: string, entrada: ProductosFiltrosEntrada = {}, extra = {}) =>
      repo.faceta(filtros(entrada), opc({ columna, ...extra }));
    const valoresDe = (f: { valores: { valor: string }[] }) => f.valores.map((v) => v.valor);

    describe("listarLote: filtros", () => {
      beforeEach(async () => {
        await sembrar(repo, CATALOGO);
      });

      test("sin filtros devuelve todo ordenado por descripción, con el total real y la forma del lote", async () => {
        const r = await lote();
        expect(r.total).toBe(7);
        expect(r.lote).toBe(1);
        expect(r.desde).toBe(0);
        expect(r.filas).toHaveLength(7);
        // Solo lo que muestra la tabla y pide el formulario de edición.
        expect(Object.keys(r.filas[0] ?? {}).sort()).toEqual(
          [
            "activo",
            "categoria",
            "codigo_fabrica",
            "codigo_interno",
            "descripcion",
            "id",
            "nombre",
            "otros_codigos",
            "precio",
            "precio_matriz",
            "precio_magdalena",
            "precio_koreanos",
            "precio_sas_repuestos",
            "codigo_difiere",
            "erp_actualizado_at",
            "sku_proveedor",
            "stock",
          ].sort(),
        );
        const orden = nombres(r);
        expect(orden).toEqual([...orden].sort((a, b) => a.localeCompare(b)));
      });

      test("nombres iguales se desempatan por código", async () => {
        await sembrar(repo, [
          { codigo_interno: "Z-2", nombre: "Gemelo" },
          { codigo_interno: "Z-1", nombre: "Gemelo" },
        ]);
        const r = await lote({ descripciones: "Gemelo" });
        expect(codigos(r)).toEqual(["Z-1", "Z-2"]);
      });

      test("codigos es un IN exacto: B-1 no trae B-100", async () => {
        const r = await lote({ codigos: ["B-100", "A-001"] });
        expect(codigos(r).sort()).toEqual(["A-001", "B-100"]);
        const parcial = await lote({ codigos: "B-1" });
        expect(parcial.total).toBe(0);
      });

      test("los comodines de LIKE en un código son texto literal", async () => {
        expect(codigos(await lote({ codigos: "C%1" }))).toEqual(["C%1"]);
        expect(codigos(await lote({ codigos: "C_2" }))).toEqual(["C_2"]);
        expect((await lote({ codigos: "C%" })).total).toBe(0);
      });

      test("descripciones es un IN exacto sobre el nombre", async () => {
        const r = await lote({ descripciones: ["Radiador Aveo", "Filtro aceite"] });
        expect(nombres(r).sort()).toEqual(["Filtro aceite", "Radiador Aveo"]);
        // Exacto: ni subcadena ni otras mayúsculas.
        expect((await lote({ descripciones: "Radiador" })).total).toBe(0);
        expect((await lote({ descripciones: "radiador aveo" })).total).toBe(0);
      });

      test("categorias es un IN", async () => {
        const r = await lote({ categorias: ["RADIADOR", "FRENOS"] });
        expect(r.total).toBe(3);
        expect((await lote({ categorias: "FILTRO" })).total).toBe(2);
        expect((await lote({ categorias: ["NO EXISTE"] })).total).toBe(0);
      });

      test("marcas es un IN sobre descripcion; (sin marca) es nula o en blanco", async () => {
        const mobis = await lote({ marcas: ["MOBIS"] });
        expect(codigos(mobis).sort()).toEqual(["A-001", "B-100"]);
        const sin = await lote({ marcas: [SIN_MARCA] });
        expect(codigos(sin).sort()).toEqual(["B-200", "C%1"]);
        expect((await lote({ marcas: [SIN_MARCA, "GM"] })).total).toBe(4);
      });

      test("precio y stock: rangos inclusivos", async () => {
        const precio = await lote({ precioMin: 80, precioMax: 200 });
        expect(codigos(precio).sort()).toEqual(["A-002", "B-200"]);
        expect(codigos(await lote({ precioMin: 250.5 }))).toEqual(["B-100"]);
        const stock = await lote({ stockMin: 3, stockMax: 7 });
        expect(codigos(stock).sort()).toEqual(["B-100", "B-200"]);
      });

      test("conStock true es stock > 0 y false es stock = 0", async () => {
        expect((await lote({ conStock: true })).total).toBe(5);
        expect(codigos(await lote({ conStock: false })).sort()).toEqual(["A-002", "D-9"]);
      });

      test("estado activo / inactivo", async () => {
        expect((await lote({ estado: "activo" })).total).toBe(5);
        expect(codigos(await lote({ estado: "inactivo" })).sort()).toEqual(["C_2", "D-9"]);
      });

      test("los filtros de columnas distintas se combinan con AND", async () => {
        const r = await lote({
          categorias: ["RADIADOR"],
          marcas: ["MOBIS"],
          conStock: true,
          estado: "activo",
          descripciones: ["Radiador Spark", "Radiador Aveo"],
          precioMax: 300,
        });
        expect(codigos(r)).toEqual(["B-100"]);
        expect(r.total).toBe(1);
      });

      test("sinMarcas excluye: todas menos las elegidas, incluida (sin marca)", async () => {
        const menosMobis = await lote({ sinMarcas: ["MOBIS"] });
        expect(codigos(menosMobis).sort()).toEqual(["A-002", "B-200", "C%1", "C_2", "D-9"]);
        expect((await lote({ sinMarcas: [SIN_MARCA] })).total).toBe(5);
        const menosTres = await lote({ sinMarcas: ["MOBIS", "GM", SIN_MARCA] });
        expect(codigos(menosTres)).toEqual(["A-002"]);
      });

      test("sinCategorias excluye y se combina con marcas de la otra columna", async () => {
        expect((await lote({ sinCategorias: ["RADIADOR", "FRENOS"] })).total).toBe(4);
        const comb = await lote({ sinCategorias: ["RADIADOR"], marcas: ["MOBIS"] });
        expect(codigos(comb)).toEqual(["A-001"]);
      });

      test("sinCodigos y sinDescripciones excluyen valores exactos", async () => {
        const r = await lote({
          sinCodigos: ["A-001", "A-002"],
          sinDescripciones: ["Filtro aceite"],
        });
        expect(codigos(r).sort()).toEqual(["B-100", "B-200", "C%1", "D-9"]);
      });

      test("categoría nula o en blanco se agrupa en (sin categoría) y se puede marcar o excluir", async () => {
        await sembrar(repo, [
          { codigo_interno: "N-1", nombre: "Sin cat nula", categoria: null },
          { codigo_interno: "N-2", nombre: "Sin cat blanca", categoria: " \t " },
        ]);
        const incluir = await lote({ categorias: [SIN_CATEGORIA] });
        expect(codigos(incluir).sort()).toEqual(["N-1", "N-2"]);
        expect((await lote({ sinCategorias: [SIN_CATEGORIA] })).total).toBe(7);
        const f = await faceta("categoria");
        expect(f.valores.find((v) => v.valor === SIN_CATEGORIA)?.cantidad).toBe(2);
      });

      test("los espacios de los bordes (espacio, tab, CR, LF, NBSP) no cambian la marca ni la categoría", async () => {
        await sembrar(repo, [
          {
            codigo_interno: "W-1",
            nombre: "Con espacios uno",
            descripcion: "\tMOBIS ",
            categoria: " FRENOS\r\n",
          },
          {
            codigo_interno: "W-2",
            nombre: "Con espacios dos",
            descripcion: " MOBIS ",
            categoria: " FRENOS",
          },
        ]);
        const marca = await lote({ marcas: ["MOBIS"] });
        expect(codigos(marca).sort()).toEqual(["A-001", "B-100", "W-1", "W-2"]);
        const cat = await lote({ categorias: ["FRENOS"] });
        expect(codigos(cat).sort()).toEqual(["B-200", "W-1", "W-2"]);

        // El valor que devuelve la lista es exactamente el que se filtra.
        const marcas = await faceta("marca");
        const cats = await faceta("categoria");
        expect(marcas.valores.find((v) => v.valor === "MOBIS")?.cantidad).toBe(4);
        expect(cats.valores.find((v) => v.valor === "FRENOS")?.cantidad).toBe(3);
        for (const v of [...marcas.valores, ...cats.valores]) {
          expect(v.valor).toBe(v.valor.replace(/^[ \t\r\n\u00a0]+|[ \t\r\n\u00a0]+$/g, ""));
        }
      });

      test("sin coincidencias: filas vacías y total 0", async () => {
        const r = await lote({ codigos: "zzz" });
        expect(r).toMatchObject({ filas: [], total: 0, lote: 1, desde: 0 });
      });
    });

    describe("listarLote: columnas de códigos", () => {
      beforeEach(async () => {
        await sembrar(repo, CON_CODIGOS);
      });

      test("codigosFabrica es un IN sobre el valor recortado; (sin cód. de fábrica) es nulo o en blanco", async () => {
        expect(codigos(await lote({ codigosFabrica: "96817-4N000" })).sort()).toEqual([
          "K-1",
          "K-2",
        ]);
        // El valor de la lista es el recortado: el de K-3 llegó con espacio y tab.
        expect(codigos(await lote({ codigosFabrica: "TOY-77" }))).toEqual(["K-3"]);
        const sin = await lote({ codigosFabrica: [SIN_CODIGO_FABRICA] });
        expect(codigos(sin).sort()).toEqual(["K-4", "K-5"]);
        expect(codigos(await lote({ sinCodigosFabrica: [SIN_CODIGO_FABRICA] })).sort()).toEqual([
          "K-1",
          "K-2",
          "K-3",
        ]);
      });

      test("otrosCodigos filtra por el texto de la celda: los alternos unidos con coma y espacio", async () => {
        expect(codigos(await lote({ otrosCodigos: "ALT-555, ZZ.99" }))).toEqual(["K-1"]);
        expect(codigos(await lote({ otrosCodigos: "ZZ.99" }))).toEqual(["K-3"]);
        // Es la celda entera, no un código suelto.
        expect((await lote({ otrosCodigos: "ALT-555" })).total).toBe(0);
        const sin = await lote({ otrosCodigos: [SIN_OTROS_CODIGOS] });
        expect(codigos(sin).sort()).toEqual(["K-2", "K-4", "K-5"]);
      });

      test("las listas de las dos columnas dicen lo mismo que se filtra", async () => {
        const fab = await faceta("codigoFabrica");
        // Empate de cantidad: orden binario, "(" antes que los dígitos.
        expect(fab.valores).toEqual([
          { valor: SIN_CODIGO_FABRICA, cantidad: 2 },
          { valor: "96817-4N000", cantidad: 2 },
          { valor: "TOY-77", cantidad: 1 },
        ]);
        const otros = await faceta("otrosCodigos");
        expect(otros.valores).toEqual([
          { valor: SIN_OTROS_CODIGOS, cantidad: 3 },
          { valor: "ALT-555, ZZ.99", cantidad: 1 },
          { valor: "ZZ.99", cantidad: 1 },
        ]);
      });
    });

    describe("listarLote: orden", () => {
      test("la descripción es el orden por defecto y vacío es lo mismo que sin orden", async () => {
        await sembrar(repo, CATALOGO);
        const por = await lote();
        const explicito = await lote({ orden: "descripcion", dir: "asc" });
        expect(codigos(explicito)).toEqual(codigos(por));
      });

      test("descendente invierte el sentido", async () => {
        await sembrar(repo, CATALOGO);
        const asc = await lote({ orden: "precio", dir: "asc" });
        const desc = await lote({ orden: "precio", dir: "desc" });
        expect(asc.filas.map((p) => p.precio)).toEqual([5, 12, 15, 50, 80, 200, 250.5]);
        expect(desc.filas.map((p) => p.precio)).toEqual([250.5, 200, 80, 50, 15, 12, 5]);
      });

      test("precio a consultar (null) va al final en las dos direcciones y no entra en un rango", async () => {
        await sembrar(repo, [
          { codigo_interno: "1", nombre: "a", precio: 10 },
          { codigo_interno: "2", nombre: "b", precio: null },
          { codigo_interno: "3", nombre: "c", precio: 30 },
        ]);
        expect(codigos(await lote({ orden: "precio", dir: "asc" }))).toEqual(["1", "3", "2"]);
        expect(codigos(await lote({ orden: "precio", dir: "desc" }))).toEqual(["3", "1", "2"]);
        expect(codigos(await lote({ precioMin: 0 })).sort()).toEqual(["1", "3"]);
        expect(codigos(await lote({ precioMax: 1000 })).sort()).toEqual(["1", "3"]);
        const fila = (await lote()).filas.find((f) => f.codigo_interno === "2");
        expect(fila).toMatchObject({
          precio: null,
          precio_matriz: null,
          codigo_difiere: false,
          erp_actualizado_at: null,
        });
      });

      test("el código se ordena como número: 2, 10, 100 y no 10, 100, 2; los no numéricos al final", async () => {
        await sembrar(repo, [
          { codigo_interno: "100", nombre: "c" },
          { codigo_interno: "2", nombre: "a" },
          { codigo_interno: "ZZ-1", nombre: "z" },
          { codigo_interno: "10", nombre: "b" },
          { codigo_interno: "1", nombre: "d" },
          { codigo_interno: "AA-1", nombre: "y" },
        ]);
        expect(codigos(await lote({ orden: "codigo" }))).toEqual([
          "1",
          "2",
          "10",
          "100",
          "AA-1",
          "ZZ-1",
        ]);
        // Descendente: los números de mayor a menor; los no numéricos siguen al final.
        expect(codigos(await lote({ orden: "codigo", dir: "desc" }))).toEqual([
          "100",
          "10",
          "2",
          "1",
          "ZZ-1",
          "AA-1",
        ]);
      });

      test("los vacíos van al final en las dos direcciones", async () => {
        await sembrar(repo, [
          { codigo_interno: "1", nombre: "a", descripcion: "BETA" },
          { codigo_interno: "2", nombre: "b", descripcion: null },
          { codigo_interno: "3", nombre: "c", descripcion: "ALFA" },
          { codigo_interno: "4", nombre: "d", descripcion: "  " },
        ]);
        expect(codigos(await lote({ orden: "marca", dir: "asc" }))).toEqual(["3", "1", "2", "4"]);
        expect(codigos(await lote({ orden: "marca", dir: "desc" }))).toEqual(["1", "3", "2", "4"]);
      });

      test("hasta tres niveles: el segundo desempata solo dentro de los empates del primero", async () => {
        await sembrar(repo, [
          { codigo_interno: "1", nombre: "a", categoria: "B", precio: 10, stock: 1 },
          { codigo_interno: "2", nombre: "b", categoria: "A", precio: 30, stock: 2 },
          { codigo_interno: "3", nombre: "c", categoria: "B", precio: 20, stock: 3 },
          { codigo_interno: "4", nombre: "d", categoria: "A", precio: 30, stock: 4 },
          { codigo_interno: "5", nombre: "e", categoria: "A", precio: 5, stock: 5 },
        ]);
        const r = await lote({
          orden: ["categoria", "precio", "stock"],
          dir: ["asc", "desc", "desc"],
        });
        // A: 30 (stock 4, 2), después 5. B: 20 y después 10.
        expect(codigos(r)).toEqual(["4", "2", "5", "3", "1"]);
      });

      test("un cuarto nivel se ignora", async () => {
        await sembrar(repo, [
          { codigo_interno: "1", nombre: "x", categoria: "A", precio: 1, stock: 1 },
          { codigo_interno: "2", nombre: "x", categoria: "A", precio: 1, stock: 1 },
        ]);
        const r = await lote({
          orden: ["categoria", "precio", "stock", "estado"],
          dir: ["asc", "asc", "asc", "desc"],
        });
        expect(codigos(r)).toEqual(["1", "2"]);
      });

      test("estado: ascendente es activos primero", async () => {
        await sembrar(repo, [
          { codigo_interno: "1", nombre: "a", activo: false },
          { codigo_interno: "2", nombre: "b", activo: true },
          { codigo_interno: "3", nombre: "c", activo: false },
        ]);
        expect(codigos(await lote({ orden: "estado" }))).toEqual(["2", "1", "3"]);
        expect(codigos(await lote({ orden: "estado", dir: "desc" }))).toEqual(["1", "3", "2"]);
      });

      test("el orden por otras columnas de texto: códigos de fábrica y alternos", async () => {
        await sembrar(repo, CON_CODIGOS);
        expect(codigos(await lote({ orden: "codigoFabrica" }))).toEqual([
          "K-1",
          "K-2",
          "K-3",
          "K-4",
          "K-5",
        ]);
        expect(codigos(await lote({ orden: "otrosCodigos", dir: "desc" }))).toEqual([
          "K-3",
          "K-1",
          "K-2",
          "K-4",
          "K-5",
        ]);
      });

      test("un campo que no existe se descarta y manda el orden por defecto", async () => {
        await sembrar(repo, CATALOGO);
        const por = await lote();
        const raro = await lote({ orden: "nombre; drop table productos", dir: "desc" });
        expect(codigos(raro)).toEqual(codigos(por));
      });
    });

    describe("listarLote: lotes", () => {
      test("un lote fuera de rango da filas vacías con el total correcto", async () => {
        await sembrar(repo, CATALOGO);
        const r = await lote({}, 3);
        expect(r).toMatchObject({ filas: [], total: 7, lote: 3, desde: 2 * LOTE_TAMANO });
      });

      test("más de 1.000 filas: los lotes cubren todo el catálogo, sin repetir ni saltear (lección 12)", async () => {
        const N = 2300;
        await repo.bulkUpsert(
          Array.from({ length: N }, (_, i) => ({
            codigo_interno: String(i + 1),
            sku_proveedor: null,
            nombre: `Repuesto ${String(i).padStart(5, "0")}`,
            descripcion: `M${i % 10}`,
            categoria: i % 5 === 0 ? "CINCO" : "OTRA",
            precio: i,
            stock: i % 3,
          })),
        );

        const l1 = await lote({}, 1);
        const l2 = await lote({}, 2);
        const l3 = await lote({}, 3);
        const l4 = await lote({}, 4);
        expect([l1.filas.length, l2.filas.length, l3.filas.length, l4.filas.length]).toEqual([
          1000, 1000, 300, 0,
        ]);
        expect([l1.total, l2.total, l3.total, l4.total]).toEqual([N, N, N, N]);
        expect([l1.desde, l2.desde, l3.desde]).toEqual([0, 1000, 2000]);
        const todos = [...codigos(l1), ...codigos(l2), ...codigos(l3)];
        expect(new Set(todos).size).toBe(N);
        // Orden por defecto: descripción, que acá crece con el código.
        expect(todos).toEqual(Array.from({ length: N }, (_, i) => String(i + 1)));

        // Dos niveles y desempate: marca asc, precio desc. Es un orden total, así que
        // los lotes encajan sin pisarse.
        const orden = { orden: ["marca", "precio"], dir: ["asc", "desc"] };
        const vistos: string[] = [];
        for (let n = 1; n <= 3; n++) vistos.push(...codigos(await lote(orden, n)));
        expect(new Set(vistos).size).toBe(N);
        const esperado = Array.from({ length: N }, (_, i) => i)
          .sort((a, b) => (a % 10) - (b % 10) || b - a)
          .map((i) => String(i + 1));
        expect(vistos).toEqual(esperado);

        // Un filtro que deja más de 1.000 filas también cuenta todas.
        const marca = await lote({ marcas: ["M3"] });
        expect(marca.total).toBe(230);

        // Las listas cuentan sobre el catálogo entero, no sobre una muestra.
        const cats = await faceta("categoria");
        expect(cats.valores).toEqual([
          { valor: "OTRA", cantidad: 1840 },
          { valor: "CINCO", cantidad: 460 },
        ]);
      }, 120_000);

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
        const lista = await faceta("marca", {}, { limite: 500 });
        expect(lista.valores).toHaveLength(500);
        expect(lista.distintos).toBe(N);

        // Una marca fuera del top se encuentra buscándola.
        const buscada = await faceta("marca", {}, { limite: 500, q: "m0699" });
        expect(buscada.valores).toEqual([{ valor: "M0699", cantidad: 1 }]);
        expect(buscada.distintos).toBe(1);

        // Todas menos 3: tres valores en la URL, no 697.
        const menos3 = await lote({ sinMarcas: [marca(0), marca(1), marca(2)] });
        expect(menos3.total).toBe(N - 3);
        expect(menos3.filas.map((p) => p.descripcion)).not.toContain(marca(0));

        // Y la lista de marcas, con esa exclusión, sigue mostrando las 3 excluidas.
        const f = await faceta("marca", { sinMarcas: [marca(0), marca(1), marca(2)] });
        expect(valoresDe(f)).toEqual(expect.arrayContaining([marca(0), marca(1), marca(2)]));
      }, 120_000);
    });

    describe("faceta: una lista por columna", () => {
      beforeEach(async () => {
        await sembrar(repo, CATALOGO);
      });

      test("sin filtros: valores distintos con su cantidad, de mayor a menor y por valor", async () => {
        const cats = await faceta("categoria");
        expect(cats.valores).toEqual([
          { valor: "FILTRO", cantidad: 2 },
          { valor: "RADIADOR", cantidad: 2 },
          { valor: "VALVULA", cantidad: 2 },
          { valor: "FRENOS", cantidad: 1 },
        ]);
        expect(cats.distintos).toBe(4);
        // Empate de cantidad: por valor en orden binario ("(" antes que las letras).
        const marcas = await faceta("marca");
        expect(marcas.valores).toEqual([
          { valor: SIN_MARCA, cantidad: 2 },
          { valor: "GM", cantidad: 2 },
          { valor: "MOBIS", cantidad: 2 },
          { valor: "CHINA", cantidad: 1 },
        ]);
        expect(marcas.distintos).toBe(4);
      });

      test("la descripción y el código también tienen su lista", async () => {
        const desc = await faceta("descripcion");
        expect(desc.distintos).toBe(7);
        expect(desc.valores.every((v) => v.cantidad === 1)).toBe(true);
        const cods = await faceta("codigo");
        expect(cods.distintos).toBe(7);
        expect(valoresDe(cods)).toContain("C%1");
      });

      test("cada lista respeta todos los filtros menos los de su propia columna (AND acumulativo)", async () => {
        const entrada = { categorias: ["RADIADOR"], marcas: ["MOBIS"] };
        // Categorías: marca MOBIS aplicada, categoría ignorada → VALVULA y RADIADOR.
        expect((await faceta("categoria", entrada)).valores).toEqual([
          { valor: "RADIADOR", cantidad: 1 },
          { valor: "VALVULA", cantidad: 1 },
        ]);
        // Marcas: categoría RADIADOR aplicada, marca ignorada → CHINA y MOBIS.
        expect((await faceta("marca", entrada)).valores).toEqual([
          { valor: "CHINA", cantidad: 1 },
          { valor: "MOBIS", cantidad: 1 },
        ]);
        // Una tercera columna recibe las dos: solo el producto que cumple ambas.
        expect(valoresDe(await faceta("descripcion", entrada))).toEqual(["Radiador Spark"]);
      });

      test("quitar un filtro devuelve las filas que ese filtro ocultaba, si cumplen los demás", async () => {
        const con = await lote({ categorias: ["RADIADOR"], marcas: ["MOBIS"] });
        expect(codigos(con)).toEqual(["B-100"]);
        const sinMarca = await lote({ categorias: ["RADIADOR"] });
        expect(codigos(sinMarca).sort()).toEqual(["A-002", "B-100"]);
        const sinCategoria = await lote({ marcas: ["MOBIS"] });
        expect(codigos(sinCategoria).sort()).toEqual(["A-001", "B-100"]);
        expect((await lote()).total).toBe(7);
      });

      test("los demás filtros (precio, stock, estado) sí recortan la lista", async () => {
        const f = await faceta("categoria", { estado: "activo", conStock: true });
        expect(f.valores).toEqual([
          { valor: "FILTRO", cantidad: 1 },
          { valor: "FRENOS", cantidad: 1 },
          { valor: "RADIADOR", cantidad: 1 },
          { valor: "VALVULA", cantidad: 1 },
        ]);
        const marcas = await faceta("marca", { estado: "activo", conStock: true });
        expect(valoresDe(marcas).sort()).toEqual(["MOBIS", SIN_MARCA].sort());
        expect(marcas.valores.find((v) => v.valor === SIN_MARCA)?.cantidad).toBe(2);
      });

      test("el orden no afecta las listas", async () => {
        const a = await faceta("marca", { orden: "precio", dir: "desc" });
        const b = await faceta("marca");
        expect(a).toEqual(b);
      });

      test("limite recorta la lista pero distintos cuenta todos", async () => {
        const f = await faceta("categoria", {}, { limite: 2 });
        expect(f.valores).toHaveLength(2);
        expect(f.distintos).toBe(4);
      });

      test("en modo excluir, la lista de esa columna ignora la exclusión y la otra la aplica", async () => {
        const marcas = await faceta("marca", { sinMarcas: ["MOBIS"] });
        expect(marcas.valores.find((v) => v.valor === "MOBIS")?.cantidad).toBe(2);
        expect(marcas.distintos).toBe(4);
        const cats = await faceta("categoria", { sinMarcas: ["MOBIS"] });
        expect(cats.valores).toEqual([
          { valor: "FILTRO", cantidad: 2 },
          { valor: "FRENOS", cantidad: 1 },
          { valor: "RADIADOR", cantidad: 1 },
          { valor: "VALVULA", cantidad: 1 },
        ]);
      });

      test("q busca dentro de la lista: plegado, contiene, sin tildes", async () => {
        const marcas = await faceta("marca", {}, { q: "mob" });
        expect(marcas.valores).toEqual([{ valor: "MOBIS", cantidad: 2 }]);
        expect(marcas.distintos).toBe(1);
        const cats = await faceta("categoria", {}, { q: "VÁLV" });
        expect(cats.valores).toEqual([{ valor: "VALVULA", cantidad: 2 }]);
        const sin = await faceta("marca", {}, { q: "sin marca" });
        expect(sin.valores).toEqual([{ valor: SIN_MARCA, cantidad: 2 }]);
        const desc = await faceta("descripcion", {}, { q: "aveo" });
        expect(valoresDe(desc).sort()).toEqual(["Radiador Aveo", "Válvula EGR Aveo"]);
      });

      test("la búsqueda dentro de la lista trata los comodines como texto", async () => {
        expect(await faceta("marca", {}, { q: "%" })).toEqual({ valores: [], distintos: 0 });
        expect(await faceta("categoria", {}, { q: "_" })).toEqual({ valores: [], distintos: 0 });
        // En la descripción hay un "100%" de verdad.
        expect(valoresDe(await faceta("descripcion", {}, { q: "100%" }))).toEqual([
          "Filtro 100% aire",
        ]);
      });

      test("la búsqueda se aplica antes del límite: un valor de pocas filas igual aparece", async () => {
        const sin = await faceta("marca", {}, { limite: 1 });
        expect(valoresDe(sin)).not.toContain("CHINA");
        const con = await faceta("marca", {}, { limite: 1, q: "chin" });
        expect(con.valores).toEqual([{ valor: "CHINA", cantidad: 1 }]);
      });

      test("la búsqueda también recorta los valores seleccionados que no coinciden", async () => {
        const f = await faceta("marca", { marcas: ["GM"] }, { q: "mob" });
        expect(valoresDe(f)).toEqual(["MOBIS"]);
      });

      test("los filtros activos siguen recortando las cantidades de la lista buscada", async () => {
        const f = await faceta("marca", { categorias: ["RADIADOR"] }, { q: "mob" });
        expect(f.valores).toEqual([{ valor: "MOBIS", cantidad: 1 }]);
      });

      test("distintos no cuenta los valores seleccionados sin filas", async () => {
        const cat = await faceta("categoria", { categorias: ["FANTASMA"] });
        expect(cat.valores.find((v) => v.valor === "FANTASMA")?.cantidad).toBe(0);
        expect(cat.distintos).toBe(4);
        const marca = await faceta("marca", { sinMarcas: ["OTRO FANTASMA"] });
        expect(marca.valores.find((v) => v.valor === "OTRO FANTASMA")?.cantidad).toBe(0);
        expect(marca.distintos).toBe(4);
      });

      test("un valor seleccionado aparece aunque quede fuera del límite, o sin filas (cantidad 0)", async () => {
        const f = await faceta("categoria", { categorias: ["FRENOS", "FANTASMA"] }, { limite: 1 });
        expect(valoresDe(f)).toContain("FRENOS");
        expect(valoresDe(f)).toContain("FANTASMA");
        expect(f.valores.find((v) => v.valor === "FANTASMA")?.cantidad).toBe(0);
      });

      test("una columna que no existe se rechaza antes de llegar al repo", () => {
        expect(() => opc({ columna: "precio" })).toThrow();
      });
    });

    describe("faceta del código: identificador", () => {
      beforeEach(async () => {
        await sembrar(repo, [
          { codigo_interno: "3", nombre: "a" },
          { codigo_interno: "13", nombre: "b" },
          { codigo_interno: "30", nombre: "c" },
          { codigo_interno: "100", nombre: "d" },
          { codigo_interno: "2", nombre: "e" },
          { codigo_interno: "AB-3", nombre: "f" },
        ]);
      });

      test("la lista va en orden numérico y los no numéricos al final", async () => {
        const f = await faceta("codigo");
        expect(valoresDe(f)).toEqual(["2", "3", "13", "30", "100", "AB-3"]);
      });

      test("la búsqueda compara por igualdad: buscar 3 ofrece solo 3, no 13 ni 30", async () => {
        expect(valoresDe(await faceta("codigo", {}, { q: "3" }))).toEqual(["3"]);
        expect(valoresDe(await faceta("codigo", {}, { q: " ab-3 " }))).toEqual(["AB-3"]);
        expect((await faceta("codigo", {}, { q: "A" })).valores).toEqual([]);
      });

      test("las demás columnas siguen buscando por subcadena", async () => {
        expect(valoresDe(await faceta("descripcion", {}, { q: "" }))).toHaveLength(6);
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

      const buscar = async (entrada: ProductosFiltrosEntrada) =>
        codigos(await lote(entrada)).sort();

      test("sin q, o en blanco, no filtra", async () => {
        expect((await lote({ q: "   " })).total).toBe(5);
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

      test("las listas respetan q", async () => {
        const cats = await faceta("categoria", { q: "bomba" });
        expect(cats.valores).toEqual([{ valor: "ENFRIAMIENTO", cantidad: 1 }]);
        const marcas = await faceta("marca", { q: "bomba" });
        expect(marcas.valores).toEqual([{ valor: "MOBIS", cantidad: 1 }]);
      });

      test("en la lista, q se combina con los filtros de las otras columnas", async () => {
        // "o" aparece en los cinco productos (bomba, radiador, filtro, tapón, Ñuñoa).
        const entrada = { q: "o", categorias: ["MOTOR"] };
        const marcas = await faceta("marca", entrada);
        expect(valoresDe(marcas).sort()).toEqual([SIN_MARCA, "Ñuñoa Parts"].sort());
        // Categorías ignora las suyas pero aplica q.
        const cats = await faceta("categoria", entrada);
        expect(valoresDe(cats).sort()).toEqual(["BOMBA", "ENFRIAMIENTO", "MOTOR"]);
      });

      test("la descripción vacía usa su sentinela en la lista", async () => {
        await sembrar(repo, [{ codigo_interno: "Q-006", nombre: "   " }]);
        const f = await faceta("descripcion", { q: "q-006" });
        expect(f.valores).toEqual([{ valor: SIN_DESCRIPCION, cantidad: 1 }]);
      });
    });

    test("catálogo vacío: lote y listas vacíos", async () => {
      for (const columna of [
        "codigo",
        "codigoFabrica",
        "otrosCodigos",
        "categoria",
        "descripcion",
        "marca",
      ]) {
        expect(await faceta(columna)).toEqual({ valores: [], distintos: 0 });
      }
      expect(await lote()).toMatchObject({ filas: [], total: 0 });
    });
  });
}
