import { describe, expect, test } from "vitest";
import {
  CreateProductoSchema,
  SetProductoActivoSchema,
  UpdateProductoSchema,
} from "@/lib/validation/productos.schema";

const base = {
  codigo_interno: "PF-001",
  nombre: "Pastilla freno",
  descripcion: "",
  categoria: "frenos",
  sku_proveedor: "  ",
  precio: 100.5,
  stock: 3,
};

describe("CreateProductoSchema", () => {
  test("acepta input válido y normaliza '' / whitespace a null", () => {
    const r = CreateProductoSchema.parse(base);
    expect(r.descripcion).toBeNull();
    expect(r.sku_proveedor).toBeNull();
    expect(r.categoria).toBe("frenos");
  });

  test("rechaza precio negativo", () => {
    expect(CreateProductoSchema.safeParse({ ...base, precio: -1 }).success).toBe(false);
  });

  test("rechaza stock no entero", () => {
    expect(CreateProductoSchema.safeParse({ ...base, stock: 1.5 }).success).toBe(false);
  });

  test("rechaza codigo_interno vacío", () => {
    expect(CreateProductoSchema.safeParse({ ...base, codigo_interno: " " }).success).toBe(false);
  });

  test("rechaza NaN en precio", () => {
    expect(CreateProductoSchema.safeParse({ ...base, precio: Number.NaN }).success).toBe(false);
  });
});

describe("UpdateProductoSchema", () => {
  test("requiere id uuid y no acepta codigo_interno", () => {
    const { codigo_interno: _omit, ...rest } = base;
    const r = UpdateProductoSchema.parse({
      ...rest,
      id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
    });
    expect(r).not.toHaveProperty("codigo_interno");
    expect(UpdateProductoSchema.safeParse({ ...rest, id: "not-uuid" }).success).toBe(false);
  });
});

describe("SetProductoActivoSchema", () => {
  test("requiere id uuid + activo boolean", () => {
    const ok = SetProductoActivoSchema.safeParse({
      id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      activo: false,
    });
    expect(ok.success).toBe(true);
    expect(SetProductoActivoSchema.safeParse({ id: "x", activo: "si" }).success).toBe(false);
  });
});
