import { describe, expect, it } from "vitest";
import {
  configDesdeGuardada,
  parametrosDesdeConfig,
} from "@/app/(panel)/difusion/_lib/mensaje-guardado";
import type { ConfigMensaje, Plantilla } from "@/components/difusion";

const PLANTILLA: Plantilla = {
  id: "t9",
  nombre: "promo_frenos_v3",
  idioma: "es_AR",
  categoria: "marketing",
  estado: "aprobada",
  nota: null,
  requiereDespausadoManual: false,
  escalonPausado: null,
  encabezado: null,
  cuerpo: "Hola {{1}}, tenemos pastillas para tu {{2}}.",
  pie: null,
  botones: [],
};

describe("parametrosDesdeConfig", () => {
  it("una variable por {{n}}, en orden, con la sintaxis de workflows y su respaldo", () => {
    const config: ConfigMensaje = {
      plantillaId: "t9",
      variables: {
        2: { campo: "vehiculo_modelo", respaldo: " tu vehículo " },
        1: { campo: "nombre", respaldo: "" },
      },
      botones: {},
    };
    expect(parametrosDesdeConfig(PLANTILLA, config)).toEqual([
      { valor: "{{lead.nombre}}", respaldo: "" },
      { valor: "{{lead.vehiculo_modelo}}", respaldo: "tu vehículo" },
    ]);
  });

  it("con una variable sin dato elegido no hay qué guardar", () => {
    const config: ConfigMensaje = {
      plantillaId: "t9",
      variables: { 1: { campo: "nombre", respaldo: "" }, 2: { campo: null, respaldo: "" } },
      botones: {},
    };
    expect(parametrosDesdeConfig(PLANTILLA, config)).toBeNull();
  });

  it("una plantilla sin variables guarda una lista vacía", () => {
    const sin = { ...PLANTILLA, cuerpo: "Hola, tenemos promo." };
    expect(parametrosDesdeConfig(sin, { plantillaId: "t9", variables: {}, botones: {} })).toEqual(
      [],
    );
  });
});

describe("configDesdeGuardada", () => {
  it("vuelve a armar lo que se eligió para cada variable", () => {
    const c = configDesdeGuardada(PLANTILLA, [
      { valor: "{{lead.nombre}}", respaldo: "cliente" },
      { valor: "{{lead.vehiculo_modelo}}", respaldo: "" },
    ]);
    expect(c.variables).toEqual({
      1: { campo: "nombre", respaldo: "cliente" },
      2: { campo: "vehiculo_modelo", respaldo: "" },
    });
  });

  it("si lo guardado no alcanza para todas las variables, las que faltan quedan sin elegir", () => {
    const c = configDesdeGuardada(PLANTILLA, [{ valor: "{{lead.nombre}}", respaldo: "" }]);
    expect(c.variables[2]).toEqual({ campo: null, respaldo: "" });
  });
});
