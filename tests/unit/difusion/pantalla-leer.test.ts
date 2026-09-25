import { describe, expect, it, vi } from "vitest";
import { leerParaPantalla } from "@/app/(panel)/difusion/_lib/leer";
import { NoopLogger } from "@/lib/observability/logger";

describe("leerParaPantalla", () => {
  it("devuelve los datos cuando la lectura sale", async () => {
    expect(await leerParaPantalla("listado", async () => 3, new NoopLogger())).toEqual({
      estado: "ok",
      datos: 3,
    });
  });

  it("una lectura que falla vuelve como error con el mensaje, y el log lo lleva en `detalle`", async () => {
    const warn = vi.fn();
    const logger = Object.assign(new NoopLogger(), { warn });

    const r = await leerParaPantalla(
      "cupo",
      async () => {
        throw new Error("la función difusion_uso_cupo_24h no existe");
      },
      logger,
    );

    expect(r).toEqual({ estado: "error", mensaje: "la función difusion_uso_cupo_24h no existe" });
    expect(warn).toHaveBeenCalledWith(
      "difusion.lectura_fallida",
      expect.objectContaining({
        seccion: "cupo",
        detalle: "la función difusion_uso_cupo_24h no existe",
      }),
    );
  });
});
