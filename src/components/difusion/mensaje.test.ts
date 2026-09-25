import { describe, expect, it } from "vitest";
import {
  camposFaltantes,
  componerTexto,
  configInicial,
  contarSinDato,
  describirPendiente,
  disponibilidad,
  lineasCostoMensaje,
  pendientesMensaje,
  resolverVariable,
  segmentar,
  totalCosto,
  variablesDe,
} from "./mensaje";
import type { ConfigMensaje, Plantilla } from "./tipos";

const PROMO: Plantilla = {
  id: "tpl-promo",
  nombre: "promo_frenos_v3",
  idioma: "es",
  categoria: "marketing",
  estado: "aprobada",
  nota: null,
  requiereDespausadoManual: false,
  escalonPausado: null,
  encabezado: null,
  cuerpo: "Hola {{1}}, tenemos discos para tu {{2}} con descuento.",
  pie: null,
  botones: [
    { id: "b-precios", texto: "Ver precios" },
    { id: "b-baja", texto: "No me interesa" },
  ],
};

/** Como llega hoy de Meta: la lectura de plantillas no trae el texto. */
const SIN_TEXTO: Plantilla = { ...PROMO, id: "tpl-sin-texto", cuerpo: null, botones: [] };

function completa(p: Plantilla = PROMO): ConfigMensaje {
  return {
    plantillaId: p.id,
    variables: {
      1: { campo: "nombre", respaldo: "" },
      2: { campo: "vehiculo_modelo", respaldo: "" },
    },
    botones: { "b-precios": { tipo: "agente" }, "b-baja": { tipo: "baja" } },
  };
}

describe("variablesDe", () => {
  it("devuelve los números sin repetir y en orden, aunque el texto los use desordenados", () => {
    expect(variablesDe("{{2}} y {{1}}, otra vez {{2}}")).toEqual([1, 2]);
  });

  it("sin variables devuelve una lista vacía", () => {
    expect(variablesDe("Hola, ¿cómo estás?")).toEqual([]);
  });

  it("sin texto no hay variables que contar: no se inventan", () => {
    expect(variablesDe(null)).toEqual([]);
  });
});

describe("segmentar", () => {
  it("parte el texto en tramos literales y variables sin perder un carácter", () => {
    expect(segmentar("Hola {{1}}, tu {{2}}.")).toEqual([
      { tipo: "texto", texto: "Hola " },
      { tipo: "variable", indice: 1 },
      { tipo: "texto", texto: ", tu " },
      { tipo: "variable", indice: 2 },
      { tipo: "texto", texto: "." },
    ]);
  });

  it("no deja tramos de texto vacíos en los bordes", () => {
    expect(segmentar("{{1}}")).toEqual([{ tipo: "variable", indice: 1 }]);
  });

  it("llaves que no son una variable de Meta quedan como texto", () => {
    expect(segmentar("precio {{precio}} y {1}")).toEqual([
      { tipo: "texto", texto: "precio {{precio}} y {1}" },
    ]);
  });
});

describe("resolverVariable", () => {
  it("usa el dato del lead cuando lo tiene", () => {
    expect(
      resolverVariable({ campo: "nombre", respaldo: "cliente" }, { nombre: "Rosa Maldonado" }),
    ).toEqual({ tipo: "valor", campo: "nombre", texto: "Rosa Maldonado" });
  });

  it("cae al respaldo cuando al lead le falta el dato", () => {
    expect(
      resolverVariable({ campo: "vehiculo_modelo", respaldo: "tu auto" }, { nombre: "Silvia" }),
    ).toEqual({ tipo: "respaldo", campo: "vehiculo_modelo", texto: "tu auto" });
  });

  it("un dato o un respaldo hecho solo de espacios cuenta como vacío", () => {
    expect(
      resolverVariable({ campo: "vehiculo_modelo", respaldo: "   " }, { vehiculo_modelo: "  " }),
    ).toEqual({ tipo: "falta", campo: "vehiculo_modelo" });
  });

  it("sin campo elegido no inventa nada, aunque haya respaldo", () => {
    expect(resolverVariable({ campo: null, respaldo: "x" }, { nombre: "Rosa" })).toEqual({
      tipo: "sin_asignar",
    });
    expect(resolverVariable(undefined, { nombre: "Rosa" })).toEqual({ tipo: "sin_asignar" });
  });

  it("el respaldo se usa literal: no interpola llaves", () => {
    expect(resolverVariable({ campo: "consulta", respaldo: "{{1}}" }, {})).toEqual({
      tipo: "respaldo",
      campo: "consulta",
      texto: "{{1}}",
    });
  });
});

describe("componerTexto", () => {
  it("resuelve cada variable contra el lead y deja intacto el texto aprobado", () => {
    expect(
      componerTexto(PROMO.cuerpo ?? "", completa().variables, { nombre: "Carlos Vinueza" }),
    ).toEqual([
      { tipo: "texto", texto: "Hola " },
      {
        tipo: "variable",
        indice: 1,
        resolucion: { tipo: "valor", campo: "nombre", texto: "Carlos Vinueza" },
      },
      { tipo: "texto", texto: ", tenemos discos para tu " },
      { tipo: "variable", indice: 2, resolucion: { tipo: "falta", campo: "vehiculo_modelo" } },
      { tipo: "texto", texto: " con descuento." },
    ]);
  });
});

describe("configInicial", () => {
  it("arranca con todas las variables sin dato y todos los botones con el agente", () => {
    expect(configInicial(PROMO)).toEqual({
      plantillaId: "tpl-promo",
      variables: { 1: { campo: null, respaldo: "" }, 2: { campo: null, respaldo: "" } },
      botones: { "b-precios": { tipo: "agente" }, "b-baja": { tipo: "agente" } },
    });
  });

  it("una plantilla sin texto leído arranca sin variables ni botones", () => {
    expect(configInicial(SIN_TEXTO)).toEqual({
      plantillaId: "tpl-sin-texto",
      variables: {},
      botones: {},
    });
  });
});

describe("disponibilidad", () => {
  it("una aprobada se puede elegir", () => {
    expect(disponibilidad(PROMO)).toEqual({ elegible: true });
  });

  it("una aprobada se puede elegir aunque no se conozca su texto", () => {
    expect(disponibilidad(SIN_TEXTO)).toEqual({ elegible: true });
  });

  it("una pausada que no vuelve sola no se elige y trae el código con que Meta rechaza el envío", () => {
    const d = disponibilidad({ ...PROMO, estado: "pausada", requiereDespausadoManual: true });
    expect(d).toMatchObject({ elegible: false, codigo: "132015" });
    expect(d.elegible ? "" : d.motivo).toMatch(/a mano/);
  });

  it("una pausada con reloj dice cuánto dura en vez de pedir que la despausen", () => {
    const d = disponibilidad({ ...PROMO, estado: "pausada", escalonPausado: 2 });
    expect(d).toMatchObject({ elegible: false, codigo: "132015" });
    const motivo = d.elegible ? "" : d.motivo;
    expect(motivo).toMatch(/6 h/);
    expect(motivo).not.toMatch(/a mano/);
  });

  it("una deshabilitada no se elige y trae su código", () => {
    expect(disponibilidad({ ...PROMO, estado: "deshabilitada" })).toMatchObject({
      elegible: false,
      codigo: "132016",
    });
  });

  it("una en revisión o rechazada no se elige, y sin código: Meta nunca la aceptó", () => {
    expect(disponibilidad({ ...PROMO, estado: "en-revision" })).toMatchObject({
      elegible: false,
      codigo: null,
    });
    expect(disponibilidad({ ...PROMO, estado: "rechazada" })).toMatchObject({
      elegible: false,
      codigo: null,
    });
  });

  it("un estado de Meta sin traducción no se elige: no se sabe si acepta envíos", () => {
    expect(disponibilidad({ ...PROMO, estado: "otro" })).toMatchObject({
      elegible: false,
      codigo: null,
    });
  });
});

describe("pendientesMensaje", () => {
  it("sin plantilla lo único pendiente es elegirla", () => {
    expect(pendientesMensaje(null, null)).toEqual([{ tipo: "plantilla" }]);
  });

  it("una plantilla que dejó de estar aprobada cuenta como no elegida", () => {
    const pausada: Plantilla = { ...PROMO, estado: "pausada" };
    expect(pendientesMensaje(pausada, completa(pausada))).toEqual([{ tipo: "plantilla" }]);
  });

  it("marca cada variable sin dato elegido", () => {
    const config: ConfigMensaje = {
      ...completa(),
      variables: { 1: { campo: "nombre", respaldo: "" }, 2: { campo: null, respaldo: "" } },
    };
    expect(pendientesMensaje(PROMO, config)).toEqual([{ tipo: "variable", indice: 2 }]);
  });

  it("un botón que pone una etiqueta sin etiqueta elegida queda pendiente", () => {
    const config: ConfigMensaje = {
      ...completa(),
      botones: { "b-precios": { tipo: "etiquetar", etiqueta: null }, "b-baja": { tipo: "baja" } },
    };
    expect(pendientesMensaje(PROMO, config)).toEqual([{ tipo: "etiqueta", boton: "Ver precios" }]);
  });

  it("completa, no queda nada pendiente", () => {
    expect(pendientesMensaje(PROMO, completa())).toEqual([]);
  });

  it("una aprobada sin texto leído no deja nada que configurar", () => {
    expect(pendientesMensaje(SIN_TEXTO, configInicial(SIN_TEXTO))).toEqual([]);
  });
});

describe("describirPendiente", () => {
  it("nombra lo que falta, con la variable escrita como la escribe Meta", () => {
    expect(describirPendiente({ tipo: "plantilla" })).toBe("Falta elegir la plantilla");
    expect(describirPendiente({ tipo: "variable", indice: 2 })).toBe("Falta el dato de {{2}}");
    expect(describirPendiente({ tipo: "etiqueta", boton: "Ver precios" })).toBe(
      "Falta la etiqueta de «Ver precios»",
    );
  });
});

describe("camposFaltantes", () => {
  it("lista los datos que le faltan al lead y no tienen respaldo, sin repetir", () => {
    const plantilla: Plantilla = { ...PROMO, cuerpo: "{{1}} {{2}} {{3}}" };
    const config: ConfigMensaje = {
      plantillaId: plantilla.id,
      variables: {
        1: { campo: "vehiculo_modelo", respaldo: "" },
        2: { campo: "vehiculo_modelo", respaldo: "" },
        3: { campo: "consulta", respaldo: "lo que pediste" },
      },
      botones: {},
    };
    expect(camposFaltantes(plantilla, config, { nombre: "Silvia" })).toEqual(["vehiculo_modelo"]);
  });

  it("una variable sin dato elegido no es un hueco del lead", () => {
    expect(camposFaltantes(PROMO, configInicial(PROMO), {})).toEqual([]);
  });
});

describe("contarSinDato", () => {
  it("cuenta a quien no tiene el dato, incluido quien no aparece en el mapa", () => {
    const valores = { a: { vehiculo_modelo: "Aveo" }, b: { vehiculo_modelo: " " }, c: {} };
    expect(contarSinDato(["a", "b", "c", "d"], valores, "vehiculo_modelo")).toBe(3);
  });
});

describe("lineasCostoMensaje", () => {
  it("separa lo gratis de la ventana abierta de lo que se cobra por plantilla", () => {
    const [ventana, plantilla] = lineasCostoMensaje("marketing", 486, 1393, {
      usdPorMensaje: 0.0447,
      fuente: "tarifa de prueba",
    });
    expect(ventana).toEqual({
      cantidad: 486,
      concepto: "Ventana de servicio abierta · texto libre",
      usd: 0,
    });
    expect(plantilla).toEqual({
      cantidad: 1393,
      concepto: "Plantilla de marketing · tarifa de prueba",
      usd: 62.27,
    });
  });

  it("redondea lo cobrado a centavos", () => {
    const [, plantilla] = lineasCostoMensaje("utility", 0, 3, {
      usdPorMensaje: 0.0333,
      fuente: "x",
    });
    expect(plantilla?.usd).toBe(0.1);
  });

  it("sin tarifa no pone precio a lo que se cobra: queda en null y lo dice", () => {
    const [ventana, plantilla] = lineasCostoMensaje("marketing", 10, 20, null);
    expect(ventana?.usd).toBe(0);
    expect(plantilla).toEqual({
      cantidad: 20,
      concepto: "Plantilla de marketing · sin tarifa",
      usd: null,
    });
  });
});

describe("totalCosto", () => {
  it("suma las líneas y trata lo gratis como cero", () => {
    expect(
      totalCosto([
        { cantidad: 2847, concepto: "con plantilla de marketing", usd: 71.18 },
        { cantidad: 726, concepto: "dentro de ventana abierta", usd: 0 },
      ]),
    ).toBeCloseTo(71.18, 2);
  });

  it("si algo que se cobra no tiene tarifa, no hay total: null y no una suma parcial", () => {
    expect(
      totalCosto([
        { cantidad: 10, concepto: "ventana", usd: 0 },
        { cantidad: 20, concepto: "plantilla", usd: null },
      ]),
    ).toBeNull();
  });

  it("una línea sin tarifa y sin nadie adentro no deja el total en null", () => {
    expect(
      totalCosto([
        { cantidad: 10, concepto: "ventana", usd: 0 },
        { cantidad: 0, concepto: "plantilla", usd: null },
      ]),
    ).toBe(0);
  });
});
