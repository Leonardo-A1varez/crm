import { describe, expect, it } from "vitest";
import {
  parsearTexto,
  sanearTexto,
  serializarSegmentos,
  type Segmento,
} from "@/lib/workflows/texto-con-variables";
import { interpolarVariables } from "@/lib/workflows/variables";

/**
 * El texto de un mensaje como segmentos: texto suelto y variables. Es el modelo
 * del editor con chips (nota 01 del diseño: ningún campo acepta `{{ }}`
 * escrito a mano). Lo que se guarda sigue siendo el formato que interpreta el
 * motor, `{{namespace.campo}}`, así que el backend no cambia.
 */

describe("parsearTexto", () => {
  it("un mensaje guardado con {{lead.nombre}} se abre con la variable como chip", () => {
    expect(parsearTexto("Hola {{lead.nombre}}, gracias.")).toEqual<Segmento[]>([
      { tipo: "texto", texto: "Hola " },
      { tipo: "variable", clave: "lead.nombre", conocida: true },
      { tipo: "texto", texto: ", gracias." },
    ]);
  });

  it("una variable que el motor no carga se conserva, marcada como desconocida", () => {
    expect(parsearTexto("{{lead.vehiculo}}")).toEqual<Segmento[]>([
      { tipo: "variable", clave: "lead.vehiculo", conocida: false },
    ]);
  });

  it("texto sin variables es un solo segmento; vacío es ninguno", () => {
    expect(parsearTexto("Hola")).toEqual([{ tipo: "texto", texto: "Hola" }]);
    expect(parsearTexto("")).toEqual([]);
  });

  it("llaves que no forman una variable quedan como texto, saneado", () => {
    expect(parsearTexto("precio {{ 10 }}")).toEqual([{ tipo: "texto", texto: "precio { 10 }" }]);
  });
});

describe("serializarSegmentos", () => {
  it("vuelve al formato del motor, y el viaje de ida y vuelta no cambia nada", () => {
    const original = "Hola {{lead.nombre}}, te escribe {{vendedor.nombre}}.\nSaludos";
    expect(serializarSegmentos(parsearTexto(original))).toBe(original);
  });

  it("el texto que alguien escribió con llaves dobles no se convierte en variable", () => {
    const guardado = serializarSegmentos([{ tipo: "texto", texto: "Hola {{lead.nombre}}" }]);
    expect(guardado).toBe("Hola {lead.nombre}");
    expect(interpolarVariables(guardado, { lead: { nombre: "Ana" } }).texto).toBe(
      "Hola {lead.nombre}",
    );
  });

  it("lo guardado lo resuelve el mismo interpolador que usa el motor", () => {
    const guardado = serializarSegmentos([
      { tipo: "texto", texto: "Hola " },
      { tipo: "variable", clave: "lead.nombre", conocida: true },
    ]);
    expect(interpolarVariables(guardado, { lead: { nombre: "Juan" } }).texto).toBe("Hola Juan");
  });
});

describe("sanearTexto", () => {
  it("parte toda secuencia de llaves dobles, también las de tres o más", () => {
    expect(sanearTexto("a {{ b }} c")).toBe("a { b } c");
    expect(sanearTexto("{{{x}}}")).toBe("{x}");
    expect(sanearTexto("sin llaves")).toBe("sin llaves");
    expect(sanearTexto("{ una }")).toBe("{ una }");
  });
});
