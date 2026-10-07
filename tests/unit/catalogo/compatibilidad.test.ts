import { describe, expect, test } from "vitest";
import {
  diferenciasEntre,
  elementosCompatibles,
  leerCompatibilidad,
  normalizarCilindrada,
  resolverModelos,
  type ElementoCompatibilidad,
} from "@/lib/catalogo/compatibilidad";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { CONSULTAS, MODELOS, PRODUCTOS } from "../../helpers/catalogo-compat-fixtures";

describe("normalizarCilindrada", () => {
  test.each([
    ["1.6", "1.6"],
    ["1,6", "1.6"],
    ["1.6L", "1.6"],
    ["1.6 litros", "1.6"],
    ["1.60", "1.6"],
    ["2.0", "2.0"],
    ["2", undefined],
    ["1600", "1.6"],
    ["1598cc", "1.6"],
    ["2000 cc", "2.0"],
    ["  ", undefined],
    ["diesel", undefined],
    [undefined, undefined],
  ])("%j -> %j", (entrada, esperado) => {
    expect(normalizarCilindrada(entrada)).toBe(esperado);
  });
});

/** Solo el par (marca, sigla): el nombre se prueba aparte. */
const resolver = (...args: Parameters<typeof resolverModelos>) =>
  resolverModelos(...args).map(({ marca, sigla }) => ({ marca, sigla }));

describe("leerCompatibilidad", () => {
  test("lee los elementos que escribe el traductor, con nulos y modelo_nombre", () => {
    expect(
      leerCompatibilidad([
        {
          marca: "Kia",
          modelo: "PICANT",
          modelo_nombre: "Kia Picanto",
          anio_desde: 2012,
          anio_hasta: null,
          cilindrada: "1.0",
          combustible: "GAS",
        },
      ]),
    ).toEqual([
      {
        marca: "Kia",
        modelo: "PICANT",
        modelo_nombre: "Kia Picanto",
        anio_desde: 2012,
        anio_hasta: null,
        cilindrada: "1.0",
        combustible: "GAS",
      },
    ]);
  });

  test("descarta lo que no tiene marca y modelo en vez de tirar", () => {
    expect(
      leerCompatibilidad([{ marca: "Kia" }, null, 5, "x", { marca: "Kia", modelo: "RIO" }]),
    ).toHaveLength(1);
  });

  test("lo que no es un array es una lista vacía", () => {
    expect(leerCompatibilidad(null)).toEqual([]);
    expect(leerCompatibilidad({ marca: "Kia" })).toEqual([]);
  });

  test("un año que no es número cuenta como no declarado", () => {
    const [e] = leerCompatibilidad([
      { marca: "A", modelo: "B", anio_desde: "2010", anio_hasta: NaN },
    ]);
    expect(e?.anio_desde).toBeNull();
    expect(e?.anio_hasta).toBeNull();
  });
});

describe("resolverModelos", () => {
  test("devuelve también el nombre real plegado, para comparar con modelo_nombre", () => {
    expect(resolverModelos(MODELOS, "Hyundai", "STA FE")).toEqual([
      { marca: "hyundai", sigla: "sta fe", nombre: "hyundai santa fe", exacto: true },
    ]);
  });

  test("Accent es exacto en ACC y ACCENT; la variante Verna entró por prefijo y no lo es", () => {
    const porSigla = Object.fromEntries(
      resolverModelos(MODELOS, "Hyundai", "Accent").map((r) => [r.sigla, r.exacto]),
    );
    expect(porSigla).toEqual({ acc: true, accent: true, ver: false });
  });

  test("si nadie coincide por igualdad, las generaciones que entran por prefijo valen como exactas", () => {
    const exactos = resolverModelos(MODELOS, "Hyundai", "Tucson").map((r) => r.exacto);
    expect(exactos).toEqual([true, true]);
  });

  test("un modelo con varias siglas devuelve todas", () => {
    expect(
      resolver(MODELOS, "Kia", "Picanto")
        .map((x) => x.sigla)
        .sort(),
    ).toEqual(["pic", "picant", "picanto"]);
  });

  test("Accent resuelve a las siglas del mismo nombre real y a la variante Verna", () => {
    const r = resolver(MODELOS, "Hyundai", "Accent");
    expect(r.map((x) => x.sigla).sort()).toEqual(["acc", "accent", "ver"]);
    expect(r.every((x) => x.marca === "hyundai")).toBe(true);
  });

  test("no distingue mayúsculas ni tildes", () => {
    expect(resolver(MODELOS, undefined, "ACCÉNT")).toEqual(resolver(MODELOS, undefined, "accent"));
  });

  test("la sigla misma también resuelve", () => {
    expect(resolver(MODELOS, "Hyundai", "STA FE")).toEqual([{ marca: "hyundai", sigla: "sta fe" }]);
  });

  test("un alias resuelve", () => {
    expect(resolver(MODELOS, undefined, "Santafe")).toEqual([
      { marca: "hyundai", sigla: "sta fe" },
    ]);
  });

  test("el nombre real completo, con la marca, resuelve", () => {
    expect(resolver(MODELOS, undefined, "Hyundai Santa Fe")).toEqual([
      { marca: "hyundai", sigla: "sta fe" },
    ]);
  });

  test("Tucson cubre todas las generaciones", () => {
    const siglas = resolver(MODELOS, "Hyundai", "Tucson").map((x) => x.sigla);
    expect(siglas.sort()).toEqual(["tucs", "tucs ix"]);
  });

  test("ignora los modelos que no están activos (confianza media sin confirmar)", () => {
    expect(resolver(MODELOS, undefined, "Corsa")).toEqual([]);
    expect(resolver(MODELOS, undefined, "COR")).toEqual([]);
  });

  test("usa los confirmados aunque la confianza sea baja", () => {
    expect(resolver(MODELOS, undefined, "Vitara")).toEqual([{ marca: "suzuki", sigla: "vit" }]);
  });

  test("la marca que lleva el nombre real también restringe (Chevrolet Vitara bajo Suzuki)", () => {
    expect(resolver(MODELOS, "Chevrolet", "Vitara")).toEqual([{ marca: "suzuki", sigla: "vit" }]);
  });

  test("una marca ajena no resuelve", () => {
    expect(resolver(MODELOS, "Kia", "Accent")).toEqual([]);
  });

  test("un comodín de LIKE no se interpreta como comodín", () => {
    expect(resolver(MODELOS, undefined, "acc%")).toEqual([]);
    expect(resolver(MODELOS, undefined, "%")).toEqual([]);
  });

  test("sin modelo no resuelve nada", () => {
    expect(resolver(MODELOS, "Hyundai", undefined)).toEqual([]);
    expect(resolver(MODELOS, "Hyundai", "  ")).toEqual([]);
  });
});

describe("elementosCompatibles", () => {
  const compat: ElementoCompatibilidad[] = [
    {
      marca: "Hyundai",
      modelo: "ACC",
      anio_desde: 2006,
      anio_hasta: 2011,
      cilindrada: "1.4",
      combustible: "GAS",
    },
    {
      marca: "Hyundai",
      modelo: "ACC",
      anio_desde: 2012,
      anio_hasta: null,
      cilindrada: "1.6",
      combustible: "GAS",
    },
  ];

  test("sin filtros devuelve todos", () => {
    expect(elementosCompatibles(compat, {}, [], "")).toEqual(compat);
  });

  test("devuelve solo los elementos que justifican el match", () => {
    const resueltos = resolverModelos(MODELOS, "Hyundai", "Accent");
    const r = elementosCompatibles(
      compat,
      { marca: "Hyundai", modelo: "Accent", anio: 2014 },
      resueltos,
      "",
    );
    expect(r).toEqual([compat[1]]);
  });

  test("compatibilidad vacía no tiene elementos pero el producto igual entra (lo decide el repo)", () => {
    expect(elementosCompatibles([], { marca: "Hyundai" }, [], "")).toEqual([]);
  });
});

describe("InMemoryProductsRepository.search con vehículo (mismos casos que el SQL)", () => {
  async function repoConFixtures(): Promise<InMemoryProductsRepository> {
    const repo = new InMemoryProductsRepository({ modelos: MODELOS });
    for (const p of PRODUCTOS) {
      await repo.create({
        codigo_interno: p.codigo,
        sku_proveedor: null,
        nombre: p.nombre,
        descripcion: null,
        categoria: null,
        compatibilidad: p.compatibilidad as never,
        precio: 10,
        stock: 1,
        imagen_url: null,
        activo: true,
      });
    }
    return repo;
  }

  test.each(CONSULTAS.map((c) => [c.nombre, c] as const))("%s", async (_n, c) => {
    const repo = await repoConFixtures();
    const hits = await repo.search({
      q: "termostato",
      marca: c.marca,
      modelo: c.modelo,
      anio: c.anio,
      cilindrada: c.cilindrada,
      tope: 50,
    });
    expect(hits.map((h) => h.codigo_interno).sort()).toEqual([...c.esperados].sort());
  });

  test("el hit trae solo los elementos de compatibilidad que justifican el match", async () => {
    const repo = await repoConFixtures();
    const hits = await repo.search({ q: "termostato", modelo: "Santa Fe", anio: 2014 });
    const p9 = hits.find((h) => h.codigo_interno === "P9");
    expect(p9?.compatibilidad).toHaveLength(1);
    expect(p9?.compatibilidad[0]?.cilindrada).toBe("2.4");
  });

  test("sin filtros el hit trae toda su compatibilidad", async () => {
    const repo = await repoConFixtures();
    const hits = await repo.search({ q: "termostato" });
    expect(hits.find((h) => h.codigo_interno === "P9")?.compatibilidad).toHaveLength(2);
  });
});

describe("diferenciasEntre", () => {
  const hit = (codigo: string, puntaje: number, compatibilidad: ElementoCompatibilidad[]) => ({
    codigo_interno: codigo,
    puntaje,
    compatibilidad,
  });
  const e = (
    anio_desde: number | null,
    anio_hasta: number | null,
    cilindrada: string | null,
    combustible: "GAS" | "DSL" | null,
  ): ElementoCompatibilidad => ({
    marca: "Hyundai",
    modelo: "ACC",
    anio_desde,
    anio_hasta,
    cilindrada,
    combustible,
  });

  test("sin candidatos o con uno solo no hay diferencias", () => {
    expect(diferenciasEntre([], {})).toBeNull();
    expect(diferenciasEntre([hit("A", 10, [e(2006, 2011, "1.4", "GAS")])], {})).toBeNull();
  });

  test("trae una instrucción para el agente: qué preguntar y que no cotice todavía", () => {
    const d = diferenciasEntre(
      [hit("A", 10, [e(2006, 2011, "1.4", "GAS")]), hit("B", 10, [e(2012, null, "1.6", "GAS")])],
      {},
    );
    expect(d?.instruccion).toMatch(/preguntale al cliente el año y la cilindrada/i);
    expect(d?.instruccion).toMatch(/antes de dar precios/i);
    expect(d?.instruccion).toMatch(/no listes ni cotices/i);
  });

  test("la instrucción nombra solo el atributo que difiere", () => {
    const d = diferenciasEntre(
      [hit("A", 10, [e(null, null, "1.4", null)]), hit("B", 10, [e(null, null, "1.6", null)])],
      {},
    );
    expect(d?.instruccion).toMatch(/la cilindrada/i);
    expect(d?.instruccion).not.toMatch(/el año|combustible/i);
  });

  test("detecta que difiere la cilindrada y lista los valores", () => {
    const d = diferenciasEntre(
      [hit("A", 10, [e(2006, 2011, "1.4", "GAS")]), hit("B", 10, [e(2006, 2011, "1.6", "GAS")])],
      {},
    );
    expect(d?.atributos).toEqual(["cilindrada"]);
    expect(d?.valores.cilindrada).toEqual(["1.4", "1.6"]);
    expect(d?.valores.anio).toBeUndefined();
  });

  test("detecta años, en orden, con rangos abiertos legibles", () => {
    const d = diferenciasEntre(
      [hit("A", 10, [e(null, 2005, null, null)]), hit("B", 10, [e(2006, null, null, null)])],
      {},
    );
    expect(d?.atributos).toEqual(["anio"]);
    expect(d?.valores.anio).toEqual(["hasta 2005", "2006 en adelante"]);
  });

  test("detecta combustible", () => {
    const d = diferenciasEntre(
      [hit("A", 10, [e(2010, 2012, "2.2", "DSL")]), hit("B", 10, [e(2010, 2012, "2.2", "GAS")])],
      {},
    );
    expect(d?.atributos).toEqual(["combustible"]);
    expect(d?.valores.combustible).toEqual(["DSL", "GAS"]);
  });

  test("no pregunta el año ni la cilindrada que el cliente ya dio", () => {
    const hits = [
      hit("A", 10, [e(2006, 2011, "1.4", "GAS")]),
      hit("B", 10, [e(2008, 2014, "1.6", "GAS")]),
    ];
    expect(diferenciasEntre(hits, { anio: 2009 })?.atributos).toEqual(["cilindrada"]);
    expect(diferenciasEntre(hits, { cilindrada: "1.6" })?.atributos).toEqual(["anio"]);
    expect(diferenciasEntre(hits, { anio: 2009, cilindrada: "1.6" })).toBeNull();
  });

  test("un candidato sin dato de un atributo no cuenta como diferencia", () => {
    const d = diferenciasEntre(
      [hit("A", 10, [e(null, null, "1.6", null)]), hit("B", 10, [e(null, null, null, null)])],
      {},
    );
    expect(d).toBeNull();
  });

  test("mismos valores en todos los candidatos: no difiere", () => {
    const d = diferenciasEntre(
      [hit("A", 10, [e(2006, 2011, "1.6", "GAS")]), hit("B", 10, [e(2006, 2011, "1.6", "GAS")])],
      {},
    );
    expect(d).toBeNull();
  });

  test("un producto que sirve para dos cilindradas difiere de uno que sirve para una", () => {
    const d = diferenciasEntre(
      [
        hit("A", 10, [e(2006, 2011, "1.4", null), e(2006, 2011, "1.6", null)]),
        hit("B", 10, [e(2006, 2011, "1.6", null)]),
      ],
      {},
    );
    expect(d?.atributos).toEqual(["cilindrada"]);
  });

  test("solo mira los mejores candidatos: uno muy por debajo del puntaje no cuenta", () => {
    const d = diferenciasEntre(
      [hit("A", 100, [e(2006, 2011, "1.6", "GAS")]), hit("B", 10, [e(2006, 2011, "1.4", "GAS")])],
      {},
    );
    expect(d).toBeNull();
  });

  test("mira como mucho los cinco primeros", () => {
    const iguales = Array.from({ length: 5 }, (_, i) =>
      hit(`I${i}`, 10, [e(2006, 2011, "1.6", "GAS")]),
    );
    const sexto = hit("S", 10, [e(2006, 2011, "1.4", "GAS")]);
    expect(diferenciasEntre([...iguales, sexto], {})).toBeNull();
  });
});
