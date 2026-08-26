import { describe, it, expect } from "vitest";
import { interpolarVariables } from "@/lib/workflows/variables";

describe("interpolarVariables", () => {
  it("reemplaza variables existentes", () => {
    const resultado = interpolarVariables("Hola {{lead.nombre}}", {
      lead: { nombre: "Juan" },
    });
    expect(resultado.texto).toBe("Hola Juan");
    expect(resultado.warnings).toHaveLength(0);
  });

  it("deja vacío si el campo no existe", () => {
    const resultado = interpolarVariables("Hola {{lead.nombre}}", {
      lead: {},
    });
    expect(resultado.texto).toBe("Hola ");
    expect(resultado.warnings).toContain("lead.nombre no encontrado");
  });

  it("deja literal si el namespace no existe y anota warning", () => {
    const resultado = interpolarVariables("Hola {{foo.bar}}", {
      lead: { nombre: "Juan" },
    });
    expect(resultado.texto).toBe("Hola {{foo.bar}}");
    expect(resultado.warnings).toContain("namespace foo desconocido");
  });

  it("maneja múltiples variables", () => {
    const resultado = interpolarVariables(
      "Hola {{lead.nombre}}, tu auto {{sesion.auto_marca}} está listo",
      {
        lead: { nombre: "María" },
        sesion: { auto_marca: "Toyota" },
      },
    );
    expect(resultado.texto).toBe("Hola María, tu auto Toyota está listo");
  });

  it("convierte números a string", () => {
    const resultado = interpolarVariables("Precio: {{contexto.precio}}", {
      contexto: { precio: 1500 },
    });
    expect(resultado.texto).toBe("Precio: 1500");
  });
});
