import { describe, expect, test } from "vitest";
import { BorrarTagSchema, CrearTagSchema, EditarTagSchema } from "@/lib/validation/tags.schema";

const BASE = { nombre: "prioridad alta", color: "#FFAF3A", descripcion: "Contactar hoy" };
const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("CrearTagSchema", () => {
  test("acepta una etiqueta con los tres campos", () => {
    expect(CrearTagSchema.parse(BASE)).toEqual(BASE);
  });

  test("recorta el nombre", () => {
    expect(CrearTagSchema.parse({ ...BASE, nombre: "  urgente  " }).nombre).toBe("urgente");
  });

  test("la descripción vacía o en blanco queda en null", () => {
    expect(CrearTagSchema.parse({ ...BASE, descripcion: "" }).descripcion).toBeNull();
    expect(CrearTagSchema.parse({ ...BASE, descripcion: "   " }).descripcion).toBeNull();
    expect(CrearTagSchema.parse({ ...BASE, descripcion: undefined }).descripcion).toBeNull();
  });

  test("rechaza un color fuera de la paleta aunque sea hex válido", () => {
    // El CHECK de la tabla lo aceptaría; la paleta existe para que la etiqueta
    // se lea sobre el fondo oscuro, y eso tiene que valer también para quien
    // llame la action sin pasar por el formulario.
    expect(CrearTagSchema.safeParse({ ...BASE, color: "#123456" }).success).toBe(false);
    expect(CrearTagSchema.safeParse({ ...BASE, color: "#888888" }).success).toBe(false);
  });

  test("rechaza nombres que rompen el badge de una línea", () => {
    expect(CrearTagSchema.safeParse({ ...BASE, nombre: "dos\nlineas" }).success).toBe(false);
    expect(CrearTagSchema.safeParse({ ...BASE, nombre: "con\ttab" }).success).toBe(false);
  });

  test("rechaza nombres demasiado cortos o largos", () => {
    expect(CrearTagSchema.safeParse({ ...BASE, nombre: "a" }).success).toBe(false);
    expect(CrearTagSchema.safeParse({ ...BASE, nombre: "x".repeat(41) }).success).toBe(false);
    expect(CrearTagSchema.safeParse({ ...BASE, nombre: "x".repeat(40) }).success).toBe(true);
  });

  test("un nombre que solo tiene espacios no pasa el mínimo", () => {
    expect(CrearTagSchema.safeParse({ ...BASE, nombre: "     " }).success).toBe(false);
  });
});

describe("EditarTagSchema", () => {
  test("exige un uuid", () => {
    expect(EditarTagSchema.safeParse({ ...BASE, id: UUID }).success).toBe(true);
    expect(EditarTagSchema.safeParse({ ...BASE, id: "no-uuid" }).success).toBe(false);
    expect(EditarTagSchema.safeParse(BASE).success).toBe(false);
  });
});

describe("BorrarTagSchema", () => {
  test("solo acepta un uuid", () => {
    expect(BorrarTagSchema.safeParse({ id: UUID }).success).toBe(true);
    expect(BorrarTagSchema.safeParse({ id: "" }).success).toBe(false);
  });
});
