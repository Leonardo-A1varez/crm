import { describe, expect, test } from "vitest";
import { leerSeccion } from "@/app/(panel)/ajustes/_lib/leer-seccion";
import type { LogContext, Logger } from "@/lib/observability/logger";

class LoggerQueAnota implements Logger {
  readonly avisos: Array<{ msg: string; ctx?: LogContext }> = [];
  debug(): void {}
  info(): void {}
  warn(msg: string, ctx?: LogContext): void {
    this.avisos.push({ msg, ctx });
  }
  error(): void {}
  child(): Logger {
    return this;
  }
}

describe("leerSeccion", () => {
  test("si la lectura sale, devuelve los datos", async () => {
    const r = await leerSeccion("empresa", async () => ({ nombre: "x" }), new LoggerQueAnota());

    expect(r).toEqual({ estado: "ok", datos: { nombre: "x" } });
  });

  test("si la lectura falla, devuelve el error legible y no lanza", async () => {
    const r = await leerSeccion(
      "usuarios",
      async () => {
        throw new Error("falla de prueba");
      },
      new LoggerQueAnota(),
    );

    expect(r).toEqual({ estado: "error", mensaje: "falla de prueba" });
  });

  test("anota la falla con la sección, sin usar la clave que redactPii tacha", async () => {
    const logger = new LoggerQueAnota();

    await leerSeccion(
      "horario",
      async () => {
        throw new TypeError("falla de prueba");
      },
      logger,
    );

    expect(logger.avisos[0]?.ctx).toEqual({
      seccion: "horario",
      tipo: "TypeError",
      detalle: "falla de prueba",
    });
  });
});
