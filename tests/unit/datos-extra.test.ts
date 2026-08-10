import { describe, expect, test } from "vitest";
import {
  claveComparable,
  conDatoExtra,
  esClaveReservada,
  excedeTope,
  MAX_DATOS_EXTRA,
  sinDatoExtra,
} from "@/lib/datos-extra";

describe("claveComparable", () => {
  test("iguala mayúsculas, acentos y separadores", () => {
    expect(claveComparable("Vehículo Marca")).toBe("vehiculomarca");
    expect(claveComparable("vehiculo_marca")).toBe("vehiculomarca");
    expect(claveComparable("VEHICULO-MARCA")).toBe("vehiculomarca");
  });

  test("no colapsa claves distintas", () => {
    expect(claveComparable("Cumpleaños")).not.toBe(claveComparable("Cumple"));
  });
});

describe("esClaveReservada", () => {
  test("rechaza las columnas reales de leads escritas de cualquier forma", () => {
    for (const clave of [
      "telefono",
      "Teléfono",
      "TELEFONO",
      "email",
      "E-mail",
      "Correo",
      "dirección",
      "Direccion",
      "Nombre",
      "nombre perfil",
      "Contacto",
      "Canal",
      "Vehículo Modelo",
    ]) {
      expect(esClaveReservada(clave)).toBe(true);
    }
  });

  test("deja pasar un campo libre de verdad", () => {
    for (const clave of ["Cumpleaños", "Taller de confianza", "Patente", "Obra social"]) {
      expect(esClaveReservada(clave)).toBe(false);
    }
  });
});

describe("conDatoExtra", () => {
  test("agrega el campo conservando los que ya estaban", () => {
    expect(conDatoExtra({ Patente: "ABC123" }, "Cumpleaños", "12/03")).toEqual({
      Patente: "ABC123",
      Cumpleaños: "12/03",
    });
  });

  test("no muta el objeto original", () => {
    const original = { Patente: "ABC123" };
    conDatoExtra(original, "Cumpleaños", "12/03");
    expect(original).toEqual({ Patente: "ABC123" });
  });

  test("pisar una clave equivalente conserva cómo estaba escrita", () => {
    // Dos filas rotuladas "Cumpleaños" y "cumpleanos" con valores distintos
    // serían dos verdades sobre el mismo dato.
    const resultado = conDatoExtra({ Cumpleaños: "12/03" }, "cumpleanos", "13/03");
    expect(resultado).toEqual({ Cumpleaños: "13/03" });
    expect(Object.keys(resultado)).toHaveLength(1);
  });
});

describe("sinDatoExtra", () => {
  test("saca el campo y deja los demás intactos", () => {
    expect(sinDatoExtra({ Patente: "ABC123", Cumpleaños: "12/03" }, "Cumpleaños")).toEqual({
      Patente: "ABC123",
    });
  });

  test("encuentra la clave aunque llegue sin acento ni mayúsculas", () => {
    expect(sinDatoExtra({ Cumpleaños: "12/03" }, "cumpleanos")).toEqual({});
    expect(sinDatoExtra({ "Taller de confianza": "El Rápido" }, "TALLER_DE_CONFIANZA")).toEqual({});
  });

  test("borrar una clave que no está devuelve lo mismo", () => {
    expect(sinDatoExtra({ Patente: "ABC123" }, "Cumpleaños")).toEqual({ Patente: "ABC123" });
    expect(sinDatoExtra({}, "Cumpleaños")).toEqual({});
  });

  test("no muta el objeto original", () => {
    const original = { Patente: "ABC123", Cumpleaños: "12/03" };
    sinDatoExtra(original, "Cumpleaños");
    expect(original).toEqual({ Patente: "ABC123", Cumpleaños: "12/03" });
  });
});

describe("excedeTope", () => {
  function lleno(): Record<string, string> {
    return Object.fromEntries(
      Array.from({ length: MAX_DATOS_EXTRA }, (_, i) => [`Campo ${i}`, String(i)]),
    );
  }

  test("una clave nueva sobre el tope excede", () => {
    expect(excedeTope(lleno(), "Cumpleaños")).toBe(true);
  });

  test("pisar una que ya está nunca excede", () => {
    expect(excedeTope(lleno(), "Campo 0")).toBe(false);
    expect(excedeTope(lleno(), "campo0")).toBe(false);
  });

  test("por debajo del tope no excede", () => {
    expect(excedeTope({ Patente: "ABC" }, "Cumpleaños")).toBe(false);
    expect(excedeTope({}, "Cumpleaños")).toBe(false);
  });
});
