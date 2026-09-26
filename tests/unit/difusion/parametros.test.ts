import { describe, expect, it } from "vitest";
import {
  ParametrosPlantillaSchema,
  TextoLibreSchema,
  camposEnTexto,
  campoDeToken,
  resolverParametros,
  tokenDeCampo,
} from "@/lib/difusion/parametros";

describe("tokenDeCampo / campoDeToken", () => {
  it("cada dato del lead es una variable con la sintaxis de workflows, y vuelve", () => {
    expect(tokenDeCampo("nombre")).toBe("{{lead.nombre}}");
    expect(tokenDeCampo("vehiculo_modelo")).toBe("{{lead.vehiculo_modelo}}");
    expect(tokenDeCampo("consulta")).toBe("{{sesion.consulta}}");
    expect(campoDeToken("{{lead.vehiculo_modelo}}")).toBe("vehiculo_modelo");
    expect(campoDeToken("texto libre")).toBeNull();
  });
});

describe("ParametrosPlantillaSchema", () => {
  it("acepta sólo variables de la lista cerrada", () => {
    expect(
      ParametrosPlantillaSchema.safeParse([{ valor: "{{lead.nombre}}", respaldo: "cliente" }])
        .success,
    ).toBe(true);
    expect(
      ParametrosPlantillaSchema.safeParse([{ valor: "{{lead.telefono}}", respaldo: "" }]).success,
    ).toBe(false);
    expect(ParametrosPlantillaSchema.safeParse([{ valor: "hola", respaldo: "" }]).success).toBe(
      false,
    );
  });

  it("el respaldo es literal: no puede traer llaves", () => {
    expect(
      ParametrosPlantillaSchema.safeParse([{ valor: "{{lead.nombre}}", respaldo: "{{lead.x}}" }])
        .success,
    ).toBe(false);
  });
});

describe("resolverParametros", () => {
  const params = [
    { valor: "{{lead.nombre}}", respaldo: "" },
    { valor: "{{lead.vehiculo_modelo}}", respaldo: "tu vehículo" },
  ];

  it("usa el dato del lead cuando está", () => {
    const r = resolverParametros(params, {
      lead: { nombre: "Ana", vehiculo_modelo: "Aveo" },
    });
    expect(r).toEqual({ ok: true, valores: ["Ana", "Aveo"] });
  });

  it("sin el dato usa el respaldo", () => {
    const r = resolverParametros(params, { lead: { nombre: "Ana", vehiculo_modelo: null } });
    expect(r).toEqual({ ok: true, valores: ["Ana", "tu vehículo"] });
  });

  it("sin dato y sin respaldo no manda: dice qué variable faltó", () => {
    const r = resolverParametros(params, { lead: { nombre: "  " } });
    expect(r).toEqual({ ok: false, numero: 1 });
  });

  it("sin parámetros no hay nada que resolver", () => {
    expect(resolverParametros([], {})).toEqual({ ok: true, valores: [] });
  });
});

describe("camposEnTexto — qué datos cargar para el texto libre", () => {
  it("los datos del lead que aparecen en el texto, sin repetir", () => {
    expect(
      camposEnTexto("Hola {{lead.nombre}}, tu {{lead.vehiculo_modelo}} ({{lead.nombre}})"),
    ).toEqual(new Set(["nombre", "vehiculo_modelo"]));
  });

  it("sin variables, ninguno", () => {
    expect(camposEnTexto("Llegaron frenos")).toEqual(new Set());
  });
});

describe("TextoLibreSchema", () => {
  it("acepta un texto con las variables de la lista cerrada y lo recorta", () => {
    expect(TextoLibreSchema.parse("  Hola {{lead.nombre}}  ")).toBe("Hola {{lead.nombre}}");
  });

  it("rechaza una variable que el motor no carga: saldría vacía", () => {
    expect(TextoLibreSchema.safeParse("Hola {{vendedor.nombre}}").success).toBe(false);
  });

  it("rechaza el texto vacío y el de más de 4096 caracteres", () => {
    expect(TextoLibreSchema.safeParse("   ").success).toBe(false);
    expect(TextoLibreSchema.safeParse("x".repeat(4097)).success).toBe(false);
  });
});
