import { describe, expect, test } from "vitest";
import { indexarAbreviaturas } from "@/lib/catalogo/abreviaturas";
import type { BuscarRepuestoOutput } from "@/lib/validation/ai";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { armarSalida } from "@/server/services/catalog-matcher.service";
import { ABREVIATURAS, AMORTIGUADORES_NIRO } from "../../helpers/catalogo-abreviaturas-fixtures";
import { MARCAS } from "../../helpers/catalogo-marcas-fixtures";
import type { ProductoReal } from "../../helpers/catalogo-ranking-fixtures";

/*
 * La salida de la herramienta para el caso real de crm-dev (2026-10-07 19:12 UTC):
 * «Necesito los amortiguadores delanteros para el Kia niro 2020». Antes cotizó dos
 * filas de REPUESTO EMG sin existencia con el encabezado «Repuesto emg Niro 2020».
 */

const INDICE = indexarAbreviaturas(ABREVIATURAS);
const NIRO = { marca: "Kia", modelo: "Niro", anio: 2020 } as const;

async function salidaDe(
  productos: readonly ProductoReal[],
  query: string,
  opciones: { excluidos?: string[]; sinTabla?: boolean; conMarcas?: boolean } = {},
): Promise<BuscarRepuestoOutput> {
  const repo = new InMemoryProductsRepository({
    abreviaturas: opciones.sinTabla ? [] : ABREVIATURAS,
    gruposExcluidos: opciones.excluidos ?? [],
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
  const hits = await repo.search({ q: query, ...NIRO, tope: 20 });
  return armarSalida(
    hits,
    { anio: NIRO.anio },
    { query, marca: NIRO.marca, modelo: NIRO.modelo },
    opciones.conMarcas ? MARCAS : [],
    opciones.sinTabla ? undefined : INDICE,
  );
}

describe("amortiguadores delanteros para el Kia Niro 2020", () => {
  test("cotiza el izquierdo y el derecho, cada uno con su lado y su precio", async () => {
    const s = await salidaDe(AMORTIGUADORES_NIRO, "amortiguadores delanteros");
    expect(s.matches.map((m) => [m.codigo_interno, m.lado, m.precio])).toEqual([
      ["23868", "izquierdo", 89.55],
      ["23869", "derecho", 94.22],
    ]);
  });

  test("el encabezado sale de lo que pidió el cliente, nunca de REPUESTO EMG", async () => {
    const s = await salidaDe(AMORTIGUADORES_NIRO, "amortiguadores delanteros");
    expect(s.encabezado).toBe("Amortiguadores delanteros Niro 2020 (IVA incluido):");
    expect(s.encabezado?.toLowerCase()).not.toContain("emg");
  });

  test("lo dice igual aunque la basura no esté excluida del grupo: ni se cotiza ni da encabezado", async () => {
    const s = await salidaDe(AMORTIGUADORES_NIRO, "amortiguadores delanteros", { excluidos: [] });
    expect(s.matches.map((m) => m.codigo_interno)).toEqual(["23868", "23869"]);
    expect(JSON.stringify(s).toLowerCase()).not.toContain("repuesto emg");
  });

  test("la herramienta entrega la cotización ya escrita: marca, procedencia, lado y precio", async () => {
    const s = await salidaDe(AMORTIGUADORES_NIRO, "amortiguadores delanteros", {
      conMarcas: true,
    });
    expect(s.cotizacion_texto).toBe(
      [
        "Amortiguadores delanteros Niro 2020 (IVA incluido):",
        "MANDO (Korea) izquierdo $89,55",
        "MANDO (Korea) derecho $94,22",
      ].join("\n"),
    );
    // Los campos sueltos siguen por compatibilidad.
    expect(s.encabezado).toBe("Amortiguadores delanteros Niro 2020 (IVA incluido):");
  });

  test("la instrucción es corta: copiar `cotizacion_texto` tal cual", async () => {
    const s = await salidaDe(AMORTIGUADORES_NIRO, "amortiguadores delanteros", {
      conMarcas: true,
    });
    expect(s.diferencias?.atributos).toEqual([]);
    expect(s.diferencias?.instruccion).toBe(
      "Responde copiando `cotizacion_texto` tal cual, sin agregar nada.",
    );
  });

  test("sin tabla de abreviaturas no se rompe: sigue encontrándolos y el encabezado no usa AMORTIG DELT", async () => {
    const s = await salidaDe(AMORTIGUADORES_NIRO, "amortiguadores delanteros", { sinTabla: true });
    expect(s.matches.map((m) => m.codigo_interno)).toEqual(
      expect.arrayContaining(["23868", "23869"]),
    );
    expect(s.encabezado ?? "").not.toMatch(/amortig delt/i);
  });
});

describe("existencia 0: no se cotiza", () => {
  const sin = (p: ProductoReal): ProductoReal => ({ ...p, stock: 0 });

  test("una pieza sin existencia no trae precio, dice que no está disponible, y la otra sí se cotiza", async () => {
    const s = await salidaDe(
      [sin(AMORTIGUADORES_NIRO[0] as ProductoReal), AMORTIGUADORES_NIRO[1] as ProductoReal],
      "amortiguadores delanteros",
    );
    const izq = s.matches.find((m) => m.codigo_interno === "23868");
    const der = s.matches.find((m) => m.codigo_interno === "23869");
    expect(izq?.precio).toBeUndefined();
    expect(izq?.disponible).toBe(false);
    expect(der?.precio).toBe(94.22);
    expect(der?.disponible).toBeUndefined();
    expect(s.aviso).toMatch(/no está disponible/i);
    expect(s.aviso).toMatch(/sin precio/i);
  });

  test("si todos están sin existencia la respuesta es «no disponible»: sin precios ni encabezado", async () => {
    const s = await salidaDe(AMORTIGUADORES_NIRO.slice(0, 2).map(sin), "amortiguadores delanteros");
    expect(s.matches.every((m) => m.precio === undefined && m.disponible === false)).toBe(true);
    expect(s.encabezado).toBeUndefined();
    expect(s.cotizacion_texto).toBeUndefined();
    expect(s.relacionadas_texto).toBeUndefined();
    expect(s.sin_existencia).toBe(true);
    expect(s.aviso).toMatch(/ninguna.*disponible/i);
    expect(s.aviso).toMatch(/vendedor/i);
  });

  test("con existencia no hay ni aviso ni marca de disponibilidad", async () => {
    const s = await salidaDe(AMORTIGUADORES_NIRO.slice(0, 2), "amortiguadores delanteros");
    expect(s.aviso).toBeUndefined();
    expect(s.sin_existencia).toBeUndefined();
    expect(s.matches.every((m) => m.disponible === undefined)).toBe(true);
  });
});
