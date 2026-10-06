import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { leerCompatibilidad } from "@/lib/catalogo/compatibilidad";
import {
  cargarDiccionario,
  soloConfianzaAlta,
  traducirDescripcion,
} from "@/lib/catalogo/traducir-descripcion";
import { CreateProductoInputSchema } from "@/lib/validation/api";
import { CompatibilidadEntrySchema, ProductoSchema } from "@/lib/validation/schemas";
import type { CompatibilidadEntry } from "@/types/entities";

/**
 * La salida del traductor es lo que el relleno escribe en `productos.compatibilidad`;
 * todo lo que lee esa columna (schema de producto, alta por API, repos) tiene que
 * aceptarla tal cual, con los años y la cilindrada en null.
 */
const DICCIONARIO = soloConfianzaAlta(
  cargarDiccionario(
    readFileSync(
      path.resolve(process.cwd(), "docs/catalogo/diccionario-modelos-sugerido.csv"),
      "utf8",
    ),
  ),
);

// Descripciones reales citadas en tests/unit/catalogo/traducir-descripcion.test.ts.
const DESCRIPCIONES = [
  "HY ACC 06- 1.4 /0 XCITE GETZ 1.4",
  "HY ACC 06-09 1.6 GAS",
  "KIA SORENT06-09",
];

function salidaDelTraductor(): CompatibilidadEntry[] {
  return DESCRIPCIONES.flatMap((d) => traducirDescripcion(d, DICCIONARIO));
}

describe("forma de productos.compatibilidad", () => {
  it("el traductor produce elementos (con años y cilindrada en null)", () => {
    const salida = salidaDelTraductor();
    expect(salida.length).toBeGreaterThan(0);
    expect(salida.some((e) => e.anio_desde === null)).toBe(true);
  });

  it("CompatibilidadEntrySchema acepta cada elemento del traductor", () => {
    for (const e of salidaDelTraductor()) {
      expect(CompatibilidadEntrySchema.safeParse(e).success, JSON.stringify(e)).toBe(true);
    }
  });

  it("CompatibilidadEntrySchema sigue aceptando el formato viejo (solo marca, modelo y años)", () => {
    const viejo = { marca: "Toyota", modelo: "Corolla", anio_desde: 2010, anio_hasta: 2015 };
    expect(CompatibilidadEntrySchema.safeParse(viejo).success).toBe(true);
  });

  it("CompatibilidadEntrySchema rechaza un combustible fuera de GAS/DSL", () => {
    const malo = { marca: "A", modelo: "B", combustible: "ELECTRICO" };
    expect(CompatibilidadEntrySchema.safeParse(malo).success).toBe(false);
  });

  it("ProductoSchema y el alta por API aceptan un producto con esa compatibilidad", () => {
    const compatibilidad = salidaDelTraductor();
    const ahora = new Date();
    const producto = {
      id: "00000000-0000-4000-8000-000000000001",
      codigo_interno: "P-1",
      sku_proveedor: null,
      nombre: "HY ACC 06- 1.4 /0 XCITE GETZ 1.4",
      descripcion: null,
      categoria: null,
      compatibilidad,
      precio: 10,
      precio_matriz: null,
      precio_magdalena: null,
      precio_koreanos: null,
      precio_sas_repuestos: null,
      codigo_difiere: false,
      erp_actualizado_at: null,
      compatibilidad_pendiente: true,
      stock: 1,
      imagen_url: null,
      activo: true,
      created_at: ahora,
      updated_at: ahora,
    };
    expect(ProductoSchema.safeParse(producto).success).toBe(true);
    // Lo que deja la carga del ERP: precio a consultar y los cuatro por empresa.
    const delErp = {
      ...producto,
      precio: null,
      precio_matriz: 0,
      precio_koreanos: 12.29,
      codigo_difiere: true,
      erp_actualizado_at: ahora,
    };
    expect(ProductoSchema.safeParse(delErp).success).toBe(true);
    expect(ProductoSchema.safeParse({ ...producto, precio_matriz: -1 }).success).toBe(false);
    const { codigo_difiere: _sinFlag, ...sinFlag } = producto;
    expect(ProductoSchema.safeParse(sinFlag).success).toBe(false);
    const alta = { codigo_interno: "P-1", nombre: "x", precio: 10, compatibilidad };
    expect(CreateProductoInputSchema.safeParse(alta).success).toBe(true);
  });

  it("leerCompatibilidad conserva todos los campos que escribe el traductor", () => {
    const salida = salidaDelTraductor();
    const leida = leerCompatibilidad(JSON.parse(JSON.stringify(salida)));
    expect(leida).toEqual(salida);
  });
});
