import { describe, expect, test } from "vitest";
import { diferenciasEntre, etiquetaDePieza } from "@/lib/catalogo/compatibilidad";
import { indexarMarcas } from "@/lib/catalogo/procedencia";
import { armarSalida } from "@/server/services/catalog-matcher.service";
import { MARCAS } from "../../helpers/catalogo-marcas-fixtures";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { MODELOS } from "../../helpers/catalogo-compat-fixtures";
import {
  CONSULTA_ACCENT_2006,
  TERMOSTATOS_REALES,
  type ProductoReal,
} from "../../helpers/catalogo-ranking-fixtures";

async function buscar(
  productos: ProductoReal[],
  consulta: Parameters<InMemoryProductsRepository["search"]>[0],
) {
  const repo = new InMemoryProductsRepository({ modelos: MODELOS });
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
  return repo.search(consulta);
}

const dadoReal = { anio: 2006, cilindrada: "1.6" };

describe("etiquetaDePieza", () => {
  test("una categoría de pieza suelta es la categoría", () => {
    expect(etiquetaDePieza("TERMOSTATOS", "HY ACC 06- VER GETZ 54*82C")).toBe("TERMOSTATOS");
  });

  test.each([
    ["HY ACC 1.6 06- CVVT COMPL", "conjunto completo"],
    ["HY ACC 1.4 06- VERNA GETZ COMPLETO", "conjunto completo"],
    ["HY ACC 1.6 06- CVVT BASE TERMOST", "base"],
    ["HY ACC 1.6 06- CVVT TAPA 1 GRUESA", "tapa"],
  ])("en un grupo armado, %j es %j", (nombre, sub) => {
    expect(etiquetaDePieza("TERMOSTATO ARMADO Y TAPAS", nombre)).toBe(
      `TERMOSTATO ARMADO Y TAPAS (${sub})`,
    );
  });

  test("en un grupo armado sin palabra clave queda la categoría sola", () => {
    expect(etiquetaDePieza("TERMOSTATO ARMADO Y TAPAS", "CH TAX CARCASA TERMOSTATO")).toBe(
      "TERMOSTATO ARMADO Y TAPAS",
    );
  });

  test.each([
    ["CH TAX ORING CARCASA TERMOSTATO", "oring"],
    ["HY ACC 06- VER XCITE EMPAQ", "empaque"],
    ["HY ACC EMPAQUETADURA", "empaque"],
    ["KIA RIO O-RING", "oring"],
    ["KIA RIO SELLO", "sello"],
    ["KIA RIO RETEN", "reten"],
    ["KIA RIO PERNO", "perno"],
  ])("en cualquier grupo, %j es un %s y no la pieza principal", (nombre, sub) => {
    expect(etiquetaDePieza("BOMBA DE AGUA", nombre)).toBe(`BOMBA DE AGUA (${sub})`);
  });

  test("una palabra clave que es parte de la categoría misma no parte la pieza", () => {
    expect(etiquetaDePieza("BASE MOTOR", "BASE MOTOR HY ACC")).toBe("BASE MOTOR");
    expect(etiquetaDePieza("BASE MOTOR", "BASE MOTOR HY ACC COMPL")).toBe(
      "BASE MOTOR (conjunto completo)",
    );
    expect(etiquetaDePieza("AMORTIG DELT", "KIT AMORTIG DELT TAPA")).toBe("AMORTIG DELT (tapa)");
  });

  test("la bomba de agua sin palabra clave es la bomba", () => {
    expect(etiquetaDePieza("BOMBA DE AGUA", "KIA RIO 18-")).toBe("BOMBA DE AGUA");
  });

  test("sin categoría no hay pieza", () => {
    expect(etiquetaDePieza(null, "ALGO COMPL")).toBeNull();
    expect(etiquetaDePieza("  ", "ALGO COMPL")).toBeNull();
  });
});

describe("armarSalida: conversación real del termostato para el Accent 1.6 (2006)", () => {
  const consultaTermostato = { query: "termostato", marca: "Hyundai", modelo: "Accent" };

  test("sin pieza exacta pedida, los candidatos son piezas distintas: pregunta cuál y no expone precios", async () => {
    const hits = await buscar(TERMOSTATOS_REALES, { ...CONSULTA_ACCENT_2006 });
    const salida = armarSalida(hits, dadoReal);

    expect(salida.diferencias?.atributos).toContain("pieza");
    expect(salida.diferencias?.valores.pieza).toEqual(
      expect.arrayContaining([
        "TERMOSTATOS",
        "TERMOSTATO ARMADO Y TAPAS (conjunto completo)",
        "TERMOSTATO ARMADO Y TAPAS (base)",
        "TERMOSTATO ARMADO Y TAPAS (tapa)",
      ]),
    );
    expect(salida.diferencias?.instruccion).toMatch(/no trae precios/i);
    expect(salida.diferencias?.instruccion).toMatch(/preguntale solo eso, en una línea/i);
    expect(salida.diferencias?.instruccion).toMatch(/ya eligi/i);
    expect(salida.matches.every((m) => m.precio === undefined)).toBe(true);
    expect(salida.matches.every((m) => m.marca === undefined)).toBe(true);
    expect(salida.diferencias?.procedencias).toBeUndefined();
    expect(salida.relacionadas).toBeUndefined();
  });

  test("al pedir 'termostato' la pieza exacta es TERMOSTATOS: se cotiza sola y las demás se nombran sin precio", async () => {
    const hits = await buscar(TERMOSTATOS_REALES, { ...CONSULTA_ACCENT_2006 });
    const salida = armarSalida(hits, dadoReal, consultaTermostato, MARCAS);

    expect(salida.diferencias?.atributos).toEqual([]);
    expect(salida.matches.length).toBeGreaterThan(0);
    expect(salida.matches.every((m) => m.pieza === "TERMOSTATOS")).toBe(true);
    expect(salida.matches.map((m) => m.codigo_interno)).toEqual(
      expect.arrayContaining(["9028", "9015"]),
    );
    expect(salida.relacionadas).toEqual(
      expect.arrayContaining([
        "TERMOSTATO ARMADO Y TAPAS (base)",
        "TERMOSTATO ARMADO Y TAPAS (conjunto completo)",
      ]),
    );
    expect(salida.relacionadas).not.toContain("TERMOSTATOS");
    expect(salida.diferencias?.instruccion).toMatch(/También tengo/);
    expect(salida.diferencias?.instruccion).toMatch(/sin precios/i);
  });

  test("al pedir 'base de termostato' la exacta es la base, y el termostato suelto queda relacionado", async () => {
    const hits = await buscar(TERMOSTATOS_REALES, { ...CONSULTA_ACCENT_2006 });
    const salida = armarSalida(
      hits,
      dadoReal,
      { query: "base de termostato", marca: "Hyundai", modelo: "Accent" },
      MARCAS,
    );
    expect(salida.matches.length).toBeGreaterThan(0);
    expect(salida.matches.every((m) => m.pieza === "TERMOSTATO ARMADO Y TAPAS (base)")).toBe(true);
    expect(salida.relacionadas).toEqual(expect.arrayContaining(["TERMOSTATOS"]));
  });

  test("cada candidato trae su pieza y su procedencia; la basura no es una procedencia", async () => {
    const hits = await buscar(TERMOSTATOS_REALES, { ...CONSULTA_ACCENT_2006 });
    // Piezas completas con todos los precios: se pidió el conjunto armado.
    const salida = armarSalida(hits, dadoReal, {
      query: "termostato completo",
      marca: "Hyundai",
      modelo: "Accent",
    });
    // Con 'completo' piden tanto TERMOSTATOS como el conjunto: hay que elegir.
    expect(salida.diferencias?.atributos).toContain("pieza");

    const exacto = armarSalida(hits, dadoReal, consultaTermostato);
    const por = (c: string) => exacto.matches.find((m) => m.codigo_interno === c);
    // Sin tabla de marcas, MOBIS es solo la marca (su origen no se sabe); KOREA es un país.
    expect(por("9028")).toMatchObject({ marca: "MOBIS", pieza: "TERMOSTATOS", precio: 12.96 });
    expect(por("9028")?.procedencia).toBeUndefined();
    expect(por("9015")).toMatchObject({ procedencia: "Korea", pieza: "TERMOSTATOS", precio: 6.93 });
    expect(por("9015")?.marca).toBeUndefined();
    // `52*88C` es una medida, no una marca ni una procedencia.
    expect(por("14566")?.marca).toBeUndefined();
    expect(por("14566")?.procedencia).toBeUndefined();
  });

  test("con la tabla de marcas, MOBIS es Original y GM también", async () => {
    const hits = await buscar(TERMOSTATOS_REALES, { ...CONSULTA_ACCENT_2006 });
    const salida = armarSalida(hits, dadoReal, consultaTermostato, MARCAS);
    const por = (c: string) => salida.matches.find((m) => m.codigo_interno === c);
    expect(por("9028")).toMatchObject({ marca: "MOBIS", procedencia: "Original" });
    expect(por("9015")).toMatchObject({ procedencia: "Korea" });
    expect(por("9015")?.marca).toBeUndefined();
  });

  test("las opciones de una misma pieza se informan para presentarlas con su precio, no para preguntarlas", async () => {
    const hits = await buscar(TERMOSTATOS_REALES, { ...CONSULTA_ACCENT_2006 });
    const salida = armarSalida(hits, dadoReal, consultaTermostato, MARCAS);
    expect(salida.diferencias?.procedencias).toEqual(
      expect.arrayContaining(["MOBIS (Original)", "Korea"]),
    );
    expect(salida.diferencias?.atributos).not.toContain("procedencia" as never);
  });

  test("ya elegida la pieza suelta, solo queda la procedencia: se presenta, no se pregunta", async () => {
    const sueltos = TERMOSTATOS_REALES.filter((p) => p.codigo === "9028" || p.codigo === "9015");
    const hits = await buscar(sueltos, { ...CONSULTA_ACCENT_2006 });
    const salida = armarSalida(hits, dadoReal, undefined, MARCAS);

    expect(salida.diferencias?.atributos).toEqual([]);
    expect(salida.diferencias?.procedencias).toEqual(["MOBIS (Original)", "Korea"]);
    expect(salida.diferencias?.instruccion).toMatch(/no las preguntes/i);
    expect(salida.diferencias?.instruccion).toMatch(/MOBIS \(Original\), Korea/);
    expect(salida.diferencias?.instruccion).toMatch(/MARCA \(Procedencia\) \$precio/);
    expect(salida.diferencias?.instruccion).toMatch(/sin rangos/i);
    expect(salida.matches.every((m) => m.pieza === "TERMOSTATOS")).toBe(true);
    expect(salida.matches.map((m) => m.marca)).toEqual(["MOBIS", undefined]);
    expect(salida.matches.map((m) => m.procedencia)).toEqual(["Original", "Korea"]);
    expect(salida.relacionadas).toBeUndefined();
  });

  test("un único candidato no tiene diferencias", async () => {
    const uno = TERMOSTATOS_REALES.filter((p) => p.codigo === "19309");
    const hits = await buscar(uno, { ...CONSULTA_ACCENT_2006 });
    const salida = armarSalida(hits, dadoReal);
    expect(salida.diferencias).toBeUndefined();
    expect(salida.matches[0]?.marca).toBe("MOBIS");
  });

  test("las filas sin compatibilidad y las que contradicen la cilindrada no cuentan para decidir la pieza", async () => {
    // Solo el termostato suelto (escalón alto) y un conjunto que declara 1.4.
    const algunos = TERMOSTATOS_REALES.filter((p) => ["9028", "9015", "13671"].includes(p.codigo));
    const hits = await buscar(algunos, { ...CONSULTA_ACCENT_2006 });
    const salida = armarSalida(hits, dadoReal);
    expect(salida.diferencias?.atributos).toEqual([]);
    expect(salida.diferencias?.valores.pieza).toBeUndefined();
  });
});

describe("armarSalida: el empaque de la bomba de agua no es la bomba", () => {
  const consulta = { query: "bomba de agua", marca: "Hyundai", modelo: "Accent" };
  const hit = (
    codigo: string,
    nombre: string,
    categoria: string,
    precio: number,
    descripcion = "MOBIS",
  ) => ({
    id: `00000000-0000-4000-8000-${codigo.padStart(12, "0")}`,
    codigo_interno: codigo,
    codigo_fabrica: null,
    nombre,
    categoria,
    descripcion,
    precio,
    stock: 3,
    puntaje: 50,
    nivel_vehiculo: 5,
    compatibilidad: [],
  });

  test("cotiza solo las bombas y nombra el empaque sin precio", () => {
    const salida = armarSalida(
      [
        hit("1", "HY ACC 06- VER", "BOMBA DE AGUA", 40, "MOBIS"),
        hit("2", "HY ACC 06- VER", "BOMBA DE AGUA", 20, "JUNGWOO"),
        hit("14894", "HY ACC 06- VER XCITE EMPAQ", "BOMBA DE AGUA", 3.19, "MOBIS"),
        hit("27333", "HY ACC 06- VER XCITE EMPAQ", "BOMBA DE AGUA", 0.64, "KOREA"),
      ],
      { anio: 2006 },
      consulta,
      MARCAS,
    );
    expect(salida.matches.map((m) => m.codigo_interno)).toEqual(["1", "2"]);
    expect(salida.matches.map((m) => m.precio)).toEqual([40, 20]);
    expect(salida.relacionadas).toEqual(["BOMBA DE AGUA (empaque)"]);
    expect(JSON.stringify(salida)).not.toMatch(/3\.19|0\.64/);
  });

  test("una bomba de agua de otro auto (sin compatibilidad) comparte la categoría pero no se cotiza", () => {
    const salida = armarSalida(
      [
        hit("1", "HY ACC 06- VER", "BOMBA DE AGUA", 40, "MOBIS"),
        { ...hit("9", "SZ CARRY", "BOMBA DE AGUA", 17, "GMB"), nivel_vehiculo: -1 },
        hit("14894", "HY ACC 06- VER XCITE EMPAQ", "BOMBA DE AGUA", 3.19, "MOBIS"),
      ],
      { anio: 2006 },
      consulta,
      MARCAS,
    );
    expect(salida.matches.map((m) => m.codigo_interno)).toEqual(["1"]);
  });

  test("si el cliente pide el empaque, el empaque es la pieza exacta y la bomba queda relacionada", () => {
    const salida = armarSalida(
      [
        hit("1", "HY ACC 06- VER", "BOMBA DE AGUA", 40, "MOBIS"),
        hit("14894", "HY ACC 06- VER XCITE EMPAQ", "BOMBA DE AGUA", 3.19, "MOBIS"),
      ],
      { anio: 2006 },
      { ...consulta, query: "empaque de la bomba de agua" },
      MARCAS,
    );
    expect(salida.matches.map((m) => m.codigo_interno)).toEqual(["14894"]);
    expect(salida.relacionadas).toEqual(["BOMBA DE AGUA"]);
  });
});

describe("diferenciasEntre con pieza y procedencia", () => {
  const hit = (
    categoria: string,
    nombre: string,
    descripcion: string | null,
    puntaje = 10,
    nivel_vehiculo = 0,
  ) => ({ puntaje, nivel_vehiculo, categoria, nombre, descripcion, compatibilidad: [] });

  test("misma pieza y misma procedencia: nada que decir", () => {
    expect(
      diferenciasEntre([hit("TERMOSTATOS", "A", "MOBIS"), hit("TERMOSTATOS", "B", "MOBIS")], {}),
    ).toBeNull();
  });

  test("dos categorías distintas: hay que preguntar la pieza", () => {
    const d = diferenciasEntre(
      [hit("TERMOSTATOS", "A", "MOBIS"), hit("TERMOSTATO ARMADO Y TAPAS", "B COMPL", "MOBIS")],
      {},
    );
    expect(d?.atributos).toEqual(["pieza"]);
    expect(d?.valores.pieza).toEqual([
      "TERMOSTATOS",
      "TERMOSTATO ARMADO Y TAPAS (conjunto completo)",
    ]);
  });

  test("la misma pieza con dos procedencias: informa las procedencias y no pregunta nada", () => {
    const d = diferenciasEntre(
      [hit("TERMOSTATOS", "A", "MOBIS"), hit("TERMOSTATOS", "B", "KOREA")],
      {},
    );
    expect(d?.atributos).toEqual([]);
    expect(d?.procedencias).toEqual(["MOBIS", "Korea"]);
  });

  test("marca y procedencia de la tabla: dos marcas distintas con el mismo país son dos opciones", () => {
    const d = diferenciasEntre(
      [hit("BOMBA DE AGUA", "A", "MOBIS"), hit("BOMBA DE AGUA", "B", "JUNGWOO")],
      {},
      indexarMarcas(MARCAS),
    );
    expect(d?.atributos).toEqual([]);
    expect(d?.procedencias).toEqual(["MOBIS (Original)", "JUNGWOO (Korea)"]);
  });

  test("el sufijo del código da la procedencia cuando la descripción no la dice", () => {
    const d = diferenciasEntre(
      [
        { ...hit("BOMBA DE AGUA", "A", "52*88C"), codigo_fabrica: "25100-2X000/K" },
        { ...hit("BOMBA DE AGUA", "B", "52*88C"), codigo_fabrica: "25100-2X000/JP" },
      ],
      {},
    );
    expect(d?.procedencias).toEqual(["Korea", "Japón"]);
  });

  test("una procedencia basura no cuenta como procedencia distinta", () => {
    expect(
      diferenciasEntre([hit("TERMOSTATOS", "A", "MOBIS"), hit("TERMOSTATOS", "B", "52*88C")], {}),
    ).toBeNull();
  });

  test("pieza y procedencia juntas: pregunta la pieza primero, la procedencia viene después", () => {
    const d = diferenciasEntre(
      [
        hit("TERMOSTATOS", "A", "MOBIS"),
        hit("TERMOSTATOS", "A2", "KOREA"),
        hit("TERMOSTATO ARMADO Y TAPAS", "B COMPL", "MOBIS"),
      ],
      {},
    );
    expect(d?.atributos).toEqual(["pieza"]);
    // Con algo por preguntar la salida no trae precios, así que tampoco procedencias para cotizar.
    expect(d?.procedencias).toBeUndefined();
    expect(d?.instruccion).toMatch(/no trae precios/i);
  });

  test("un candidato de un escalón de vehículo muy inferior no decide la pieza", () => {
    const d = diferenciasEntre(
      [
        hit("TERMOSTATOS", "A", "MOBIS", 10, 7),
        hit("TERMOSTATOS", "B", "MOBIS", 10, 7),
        hit("TERMOSTATO ARMADO Y TAPAS", "C COMPL", "MOBIS", 10, -1),
      ],
      {},
    );
    expect(d).toBeNull();
  });
});
