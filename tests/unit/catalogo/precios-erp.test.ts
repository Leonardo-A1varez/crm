import { describe, expect, it } from "vitest";
import {
  EMPRESAS_ERP,
  UMBRAL_ATRASO_MINUTOS,
  campoDeEmpresa,
  esEmpresaErp,
  estadoSincronizacion,
  formatearPrecio,
  precioDeEmpresa,
} from "@/lib/catalogo/precios-erp";
import type { ErpSyncEstado } from "@/types/entities";

const AHORA = new Date("2026-10-05T12:00:00.000Z");
const haceMin = (m: number): Date => new Date(AHORA.getTime() - m * 60_000);

function estado(parcial: Partial<ErpSyncEstado>): ErpSyncEstado {
  return {
    ultimo_inicio: null,
    ultimo_fin: null,
    ultimo_exito: null,
    ultimo_error: null,
    filas_cargadas: null,
    actualizado_at: null,
    ...parcial,
  };
}

describe("empresas del ERP", () => {
  it("mapea cada código a su columna de precio", () => {
    expect(EMPRESAS_ERP.map((e) => [e.codigo, e.campo, e.etiqueta])).toEqual([
      [1, "precio_matriz", "Matriz"],
      [3, "precio_magdalena", "Magdalena"],
      [5, "precio_koreanos", "Koreanos"],
      [6, "precio_sas_repuestos", "SAS"],
    ]);
  });

  it("campoDeEmpresa devuelve la columna o null si no hay empresa", () => {
    expect(campoDeEmpresa(3)).toBe("precio_magdalena");
    expect(campoDeEmpresa(null)).toBeNull();
    expect(campoDeEmpresa(undefined)).toBeNull();
    expect(campoDeEmpresa(2)).toBeNull();
  });

  it("esEmpresaErp acepta solo 1, 3, 5 y 6", () => {
    expect([1, 2, 3, 4, 5, 6, 7, null, "1"].map(esEmpresaErp)).toEqual([
      true,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe("precioDeEmpresa", () => {
  it("un precio en 0 o nulo es que esa empresa no lo vende", () => {
    const p = { precio_matriz: 12.5, precio_magdalena: 0, precio_koreanos: null };
    expect(precioDeEmpresa(p, "precio_matriz")).toBe(12.5);
    expect(precioDeEmpresa(p, "precio_magdalena")).toBeNull();
    expect(precioDeEmpresa(p, "precio_koreanos")).toBeNull();
    expect(precioDeEmpresa(p, "precio_sas_repuestos")).toBeNull();
  });
});

describe("formatearPrecio", () => {
  it("usa coma decimal y dos decimales", () => {
    expect(formatearPrecio(12.5)).toBe("12,50");
  });

  it("sin precio dice A consultar", () => {
    expect(formatearPrecio(null)).toBe("A consultar");
    expect(formatearPrecio(undefined)).toBe("A consultar");
  });
});

describe("estadoSincronizacion", () => {
  it("sin fila o sin ninguna corrida no hay dato", () => {
    expect(estadoSincronizacion(null, AHORA).nivel).toBe("sin-datos");
    expect(estadoSincronizacion(estado({}), AHORA).nivel).toBe("sin-datos");
  });

  it("una corrida reciente dice hace cuántos minutos", () => {
    const r = estadoSincronizacion(estado({ ultimo_exito: haceMin(7) }), AHORA);
    expect(r.nivel).toBe("ok");
    expect(r.texto).toBe("Actualizado hace 7 min");
  });

  it("menos de un minuto", () => {
    const r = estadoSincronizacion(
      estado({ ultimo_exito: new Date(AHORA.getTime() - 20_000) }),
      AHORA,
    );
    expect(r.texto).toBe("Actualizado hace menos de 1 min");
  });

  it("justo en el umbral todavía está al día; pasado el umbral, atrasado", () => {
    expect(
      estadoSincronizacion(estado({ ultimo_exito: haceMin(UMBRAL_ATRASO_MINUTOS) }), AHORA).nivel,
    ).toBe("ok");
    const tarde = estadoSincronizacion(
      estado({ ultimo_exito: haceMin(UMBRAL_ATRASO_MINUTOS + 1) }),
      AHORA,
    );
    expect(tarde.nivel).toBe("atrasado");
    expect(tarde.texto).toBe("Actualizado hace 31 min");
  });

  it("pasa a horas y a días cuando es mucho", () => {
    expect(estadoSincronizacion(estado({ ultimo_exito: haceMin(150) }), AHORA).texto).toBe(
      "Actualizado hace 2 h",
    );
    expect(estadoSincronizacion(estado({ ultimo_exito: haceMin(60 * 50) }), AHORA).texto).toBe(
      "Actualizado hace 2 d",
    );
  });

  it("un error en la última corrida gana aunque haya una corrida reciente", () => {
    const r = estadoSincronizacion(
      estado({ ultimo_exito: haceMin(2), ultimo_error: "timeout" }),
      AHORA,
    );
    expect(r.nivel).toBe("error");
    expect(r.texto).toContain("Falló la última sincronización");
    expect(r.texto).toContain("hace 2 min");
    // El texto crudo del error no se muestra a todo el equipo.
    expect(r.texto).not.toContain("timeout");
  });

  it("un error sin ninguna corrida buena", () => {
    const r = estadoSincronizacion(estado({ ultimo_error: "x" }), AHORA);
    expect(r.nivel).toBe("error");
    expect(r.texto).toContain("todavía no hubo ninguna corrida buena");
  });

  it("un error en blanco no cuenta", () => {
    const r = estadoSincronizacion(estado({ ultimo_exito: haceMin(1), ultimo_error: "  " }), AHORA);
    expect(r.nivel).toBe("ok");
  });
});
