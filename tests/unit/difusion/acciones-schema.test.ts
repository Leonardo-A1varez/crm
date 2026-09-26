import { describe, expect, test } from "vitest";
import type { Grupo } from "@/lib/ui/condiciones";
import {
  CalcularAlcanceSchema,
  CrearBorradorSchema,
  DetenerSchema,
  GuardarBorradorSchema,
  ProgramarSchema,
} from "@/lib/validation/difusion-acciones.schema";

// Árbol e id armados a mano para este archivo.
const ARBOL: Grupo = {
  id: "raiz",
  clase: "grupo",
  operador: "y",
  hijos: [
    {
      id: "r1",
      clase: "regla",
      campoId: "canal",
      comparador: "tiene",
      valor: { tipo: "opciones", valores: ["wa"] },
    },
  ],
};
const ID = "3f2b8c1a-9d4e-4f6a-8b7c-1e2d3c4b5a69";

const AUDIENCIA = {
  audiencia: ARBOL,
  todaLaBase: false,
  modo: "congelada",
  incluirEnNegociacion: false,
  exentaTopeFrecuencia: false,
};

describe("schemas de las acciones de Difusión", () => {
  test("crear borrador pide un nombre y recorta espacios", () => {
    const r = CrearBorradorSchema.safeParse({ ...AUDIENCIA, nombre: "  Promo frenos  " });
    expect(r.success && r.data.nombre).toBe("Promo frenos");
    expect(CrearBorradorSchema.safeParse({ ...AUDIENCIA, nombre: "   " }).success).toBe(false);
  });

  test("las claves que no conoce se rechazan en vez de descartarse", () => {
    expect(
      CrearBorradorSchema.safeParse({ ...AUDIENCIA, nombre: "x", estado: "programada" }).success,
    ).toBe(false);
  });

  test("una audiencia que no es el árbol de condiciones no pasa", () => {
    expect(
      CrearBorradorSchema.safeParse({ ...AUDIENCIA, nombre: "x", audiencia: { clase: "regla" } })
        .success,
    ).toBe(false);
  });

  test("guardar borrador acepta sólo lo que cambia, y la plantilla va con su categoría", () => {
    expect(GuardarBorradorSchema.safeParse({ id: ID, nombre: "Otra" }).success).toBe(true);
    expect(
      GuardarBorradorSchema.safeParse({
        id: ID,
        plantilla: {
          nombre: "promo_frenos_v3",
          categoria: "marketing",
          idioma: "es_AR",
          parametros: [{ valor: "{{lead.nombre}}", respaldo: "cliente" }],
        },
      }).success,
    ).toBe(true);
    // Sin idioma Meta no sabe cuál de las plantillas con ese nombre mandar.
    expect(
      GuardarBorradorSchema.safeParse({
        id: ID,
        plantilla: { nombre: "promo_frenos_v3", categoria: "marketing", parametros: [] },
      }).success,
    ).toBe(false);
    expect(
      GuardarBorradorSchema.safeParse({ id: ID, plantilla: { nombre: "promo_frenos_v3" } }).success,
    ).toBe(false);
    expect(
      GuardarBorradorSchema.safeParse({
        id: ID,
        plantilla: { nombre: "x", categoria: "authentication" },
      }).success,
    ).toBe(false);
    expect(GuardarBorradorSchema.safeParse({ id: "no-es-uuid" }).success).toBe(false);
  });

  test("guardar borrador acepta el texto libre con variables de la lista, y null lo saca", () => {
    expect(
      GuardarBorradorSchema.safeParse({ id: ID, textoLibre: "Hola {{lead.nombre}}" }).success,
    ).toBe(true);
    expect(GuardarBorradorSchema.safeParse({ id: ID, textoLibre: null }).success).toBe(true);
    expect(
      GuardarBorradorSchema.safeParse({ id: ID, textoLibre: "Hola {{vendedor.nombre}}" }).success,
    ).toBe(false);
    expect(GuardarBorradorSchema.safeParse({ id: ID, textoLibre: "  " }).success).toBe(false);
  });

  test("el alcance acepta si hay texto libre", () => {
    const base = { ...AUDIENCIA, plantillaCategoria: null, muestra: { desde: 0, limite: 12 } };
    expect(CalcularAlcanceSchema.safeParse({ ...base, textoLibre: true }).success).toBe(true);
  });

  test("el alcance acota la página de la muestra", () => {
    const base = { ...AUDIENCIA, plantillaCategoria: null, muestra: { desde: 0, limite: 12 } };
    expect(CalcularAlcanceSchema.safeParse(base).success).toBe(true);
    expect(
      CalcularAlcanceSchema.safeParse({ ...base, muestra: { desde: 0, limite: 5000 } }).success,
    ).toBe(false);
    expect(
      CalcularAlcanceSchema.safeParse({ ...base, muestra: { desde: -1, limite: 12 } }).success,
    ).toBe(false);
  });

  test("programar lleva el id y la muestra, que puede no haber", () => {
    expect(ProgramarSchema.safeParse({ id: ID, canaryTamano: null }).success).toBe(true);
    expect(ProgramarSchema.safeParse({ id: ID, canaryTamano: 50 }).success).toBe(true);
    expect(ProgramarSchema.safeParse({ id: ID, canaryTamano: 0 }).success).toBe(false);
    expect(ProgramarSchema.safeParse({ id: ID, canaryTamano: 2.5 }).success).toBe(false);
  });

  test("detener acepta un motivo opcional de hasta 500 caracteres", () => {
    expect(DetenerSchema.safeParse({ id: ID }).success).toBe(true);
    expect(DetenerSchema.safeParse({ id: ID, motivo: "x".repeat(501) }).success).toBe(false);
  });
});
