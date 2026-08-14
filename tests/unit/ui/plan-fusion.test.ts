import { describe, expect, test } from "vitest";
import { contarDescartes, filasQueCambian, planDeFusion } from "@/lib/ui/plan-fusion";
import type { Lead } from "@/types/entities";

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: crypto.randomUUID(),
    nombre: "Carlos Gómez",
    nombre_perfil: null,
    telefono: "+5491100000000",
    email: null,
    direccion: null,
    vehiculo_marca: null,
    vehiculo_modelo: null,
    vehiculo_anio: null,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: "wa",
    meta_user_ids: {},
    datos_extra: {},
    created_at: new Date("2026-08-01T10:00:00Z"),
    updated_at: new Date("2026-08-01T10:00:00Z"),
    ...overrides,
  } as Lead;
}

function destinoDe(filas: ReturnType<typeof planDeFusion>, campo: string) {
  return filas.find((f) => f.campo === campo)?.destino;
}

describe("planDeFusion", () => {
  test("un hueco del ganador se llena con el valor del perdedor", () => {
    const filas = planDeFusion(lead({ email: null }), lead({ email: "carlos@mail.com" }));
    expect(destinoDe(filas, "Email")).toBe("se_copia");
  });

  test("dos emails distintos se suman: los dos quedan como identificadores", () => {
    const filas = planDeFusion(
      lead({ email: "bueno@mail.com" }),
      lead({ email: "viejo@mail.com" }),
    );
    expect(destinoDe(filas, "Email")).toBe("se_suma");
    expect(contarDescartes(filas)).toBe(0);
  });

  test("dos valores distintos de un campo que NO se acumula: se pierde uno", () => {
    const filas = planDeFusion(
      lead({ vehiculo_modelo: "Hilux" }),
      lead({ vehiculo_modelo: "Corolla" }),
    );
    expect(destinoDe(filas, "Modelo")).toBe("se_descarta");
    expect(contarDescartes(filas)).toBe(1);
  });

  test("el mismo valor en los dos no cambia nada", () => {
    const filas = planDeFusion(lead({ email: "x@mail.com" }), lead({ email: "x@mail.com" }));
    expect(destinoDe(filas, "Email")).toBe("iguales");
    expect(contarDescartes(filas)).toBe(0);
  });

  test("dos telefonos distintos se suman: el lead fusionado se queda con los dos", () => {
    // La columna `telefono` la conserva el ganador, pero el del perdedor pasa a
    // `lead_identificadores` en vez de descartarse (migración 20260814190000).
    const filas = planDeFusion(
      lead({ telefono: "+5491111111111" }),
      lead({ telefono: "+5492222222222" }),
    );
    expect(destinoDe(filas, "Teléfono")).toBe("se_suma");
    expect(contarDescartes(filas)).toBe(0);
  });

  test("un nombre distinto se descarta: el merge conserva el del ganador", () => {
    const filas = planDeFusion(lead({ nombre: "Carlos Gómez" }), lead({ nombre: "Carlos G." }));
    expect(destinoDe(filas, "Nombre")).toBe("se_descarta");
  });

  test("el año 0 cuenta como vacío, igual que en la SQL", () => {
    // La función trata `vehiculo_anio = 0` como ausente (`g.vehiculo_anio = 0`).
    const filas = planDeFusion(lead({ vehiculo_anio: 0 }), lead({ vehiculo_anio: 2018 }));
    expect(destinoDe(filas, "Año")).toBe("se_copia");
  });

  test("las identidades Meta se suman, nunca se descartan", () => {
    const filas = planDeFusion(
      lead({ meta_user_ids: { wa: "w-1" } }),
      lead({ meta_user_ids: { ig: "i-1" } }),
    );
    expect(destinoDe(filas, "Identidades Meta")).toBe("se_copia");
    expect(contarDescartes(filas)).toBe(0);
  });

  test("los campos libres se unen igual que las identidades", () => {
    const filas = planDeFusion(
      lead({ datos_extra: { color: "rojo" } }),
      lead({ datos_extra: { patente: "AB123" } }),
    );
    expect(destinoDe(filas, "Campos libres")).toBe("se_copia");
  });

  test("dos leads sin datos no proponen ningun cambio", () => {
    const filas = planDeFusion(lead(), lead({ telefono: "+5491100000000" }));
    expect(filasQueCambian(filas)).toEqual([]);
    expect(contarDescartes(filas)).toBe(0);
  });

  test("filasQueCambian deja solo lo que hay que mirar", () => {
    const filas = planDeFusion(
      lead({ email: null, direccion: "Calle 1" }),
      lead({ email: "nuevo@mail.com", direccion: "Calle 2" }),
    );
    const cambian = filasQueCambian(filas);
    expect(cambian.map((f) => f.campo).sort()).toEqual(["Dirección", "Email"]);
  });
});
