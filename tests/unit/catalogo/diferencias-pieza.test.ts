import { describe, expect, test } from "vitest";
import { diferenciasEntre, etiquetaDePieza } from "@/lib/catalogo/compatibilidad";
import { armarSalida } from "@/server/services/catalog-matcher.service";
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
    expect(etiquetaDePieza("TERMOSTATO ARMADO Y TAPAS", "CH TAX ORING CARCASA TERMOSTATO")).toBe(
      "TERMOSTATO ARMADO Y TAPAS",
    );
  });

  test("fuera de un grupo armado, COMPL o BASE en el nombre no parte la categoría", () => {
    expect(etiquetaDePieza("BASE MOTOR", "BASE MOTOR HY ACC COMPL")).toBe("BASE MOTOR");
    expect(etiquetaDePieza("AMORTIG DELT", "KIT AMORTIG DELT TAPA")).toBe("AMORTIG DELT");
  });

  test("sin categoría no hay pieza", () => {
    expect(etiquetaDePieza(null, "ALGO COMPL")).toBeNull();
    expect(etiquetaDePieza("  ", "ALGO COMPL")).toBeNull();
  });
});

describe("armarSalida: conversación real del termostato para el Accent 1.6 (2006)", () => {
  test("avisa que los candidatos son piezas distintas y la instrucción manda a preguntar cuál antes de cotizar", async () => {
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
    expect(salida.diferencias?.instruccion).toMatch(/antes de dar precios/i);
    expect(salida.diferencias?.instruccion).toMatch(
      /solo el termostato, la base\/tapa o el conjunto completo/i,
    );
    expect(salida.diferencias?.instruccion).toMatch(/ya la eligi/i);
  });

  test("el conjunto armado solo no es la única opción: el termostato suelto está entre los candidatos de pieza", async () => {
    const hits = await buscar(TERMOSTATOS_REALES, { ...CONSULTA_ACCENT_2006 });
    const salida = armarSalida(hits, dadoReal);
    const sueltos = salida.matches
      .filter((m) => m.pieza === "TERMOSTATOS")
      .map((m) => m.codigo_interno);
    expect(sueltos).toEqual(expect.arrayContaining(["9028", "9015"]));
  });

  test("cada candidato trae su pieza y su procedencia; la basura no es una procedencia", async () => {
    const hits = await buscar(TERMOSTATOS_REALES, { ...CONSULTA_ACCENT_2006 });
    const salida = armarSalida(hits, dadoReal);
    const por = (c: string) => salida.matches.find((m) => m.codigo_interno === c);

    expect(por("9028")).toMatchObject({
      procedencia: "MOBIS",
      pieza: "TERMOSTATOS",
      precio: 12.96,
    });
    expect(por("9015")).toMatchObject({ procedencia: "KOREA", pieza: "TERMOSTATOS", precio: 6.93 });
    expect(por("19309")).toMatchObject({
      procedencia: "MOBIS",
      pieza: "TERMOSTATO ARMADO Y TAPAS (conjunto completo)",
    });
    // `52*88C` es una medida, no una procedencia.
    expect(por("14566")?.procedencia).toBeUndefined();
    // Sin descripción tampoco hay procedencia.
    expect(por("11068")?.procedencia).toBeUndefined();
  });

  test("la procedencia que difiere dentro de una misma pieza se informa para presentarla, no para preguntarla", async () => {
    const hits = await buscar(TERMOSTATOS_REALES, { ...CONSULTA_ACCENT_2006 });
    const salida = armarSalida(hits, dadoReal);
    expect(salida.diferencias?.procedencias).toEqual(
      expect.arrayContaining(["MOBIS", "KOREA", "CHINA"]),
    );
    expect(salida.diferencias?.atributos).not.toContain("procedencia" as never);
  });

  test("ya elegida la pieza suelta, solo queda la procedencia: se presenta, no se pregunta", async () => {
    const sueltos = TERMOSTATOS_REALES.filter((p) => p.codigo === "9028" || p.codigo === "9015");
    const hits = await buscar(sueltos, { ...CONSULTA_ACCENT_2006 });
    const salida = armarSalida(hits, dadoReal);

    expect(salida.diferencias?.atributos).toEqual([]);
    expect(salida.diferencias?.procedencias).toEqual(["MOBIS", "KOREA"]);
    expect(salida.diferencias?.instruccion).toMatch(/no la preguntes/i);
    expect(salida.diferencias?.instruccion).toMatch(/MOBIS, KOREA/);
    expect(salida.diferencias?.instruccion).toMatch(/sin rangos/i);
    // Una sola pieza: no hace falta etiquetarla en cada candidato.
    expect(salida.matches.every((m) => m.pieza === undefined)).toBe(true);
    expect(salida.matches.map((m) => m.procedencia)).toEqual(["MOBIS", "KOREA"]);
  });

  test("un único candidato no tiene diferencias", async () => {
    const uno = TERMOSTATOS_REALES.filter((p) => p.codigo === "19309");
    const hits = await buscar(uno, { ...CONSULTA_ACCENT_2006 });
    const salida = armarSalida(hits, dadoReal);
    expect(salida.diferencias).toBeUndefined();
    expect(salida.matches[0]?.procedencia).toBe("MOBIS");
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
    expect(d?.procedencias).toEqual(["MOBIS", "KOREA"]);
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
    expect(d?.procedencias).toEqual(["MOBIS", "KOREA"]);
    expect(d?.instruccion).toMatch(/despu[eé]s/i);
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
