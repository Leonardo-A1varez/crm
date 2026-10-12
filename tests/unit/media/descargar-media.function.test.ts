// @vitest-environment node
import { NonRetriableError } from "inngest";
import { describe, expect, test, vi } from "vitest";
import { InfraError, ValidationError } from "@/lib/errors";
import { descargarMediaHandler } from "@/inngest/functions/descargar-media";
import type { DescargarMediaService } from "@/server/services/media/descargar-media.service";

const DATOS = { mensajeId: "m-1", phoneNumberId: "PHONE", fecha: "2026-10-12" };

function servicio(descargar: DescargarMediaService["descargar"]): DescargarMediaService {
  return { descargar, marcarFallida: vi.fn() };
}

describe("descargarMediaHandler", () => {
  test("pasa el mensaje y el numero al servicio y devuelve su resultado", async () => {
    const descargar = vi.fn().mockResolvedValue("descargado");
    expect(await descargarMediaHandler(DATOS, { servicio: servicio(descargar) })).toBe(
      "descargado",
    );
    expect(descargar).toHaveBeenCalledWith({ mensajeId: "m-1", phoneNumberId: "PHONE" });
  });

  test("un error de infraestructura se propaga tal cual: Inngest lo reintenta", async () => {
    const error = new InfraError("meta caida", "meta");
    await expect(
      descargarMediaHandler(DATOS, {
        servicio: servicio(async () => {
          throw error;
        }),
      }),
    ).rejects.toBe(error);
  });

  test("un error de dominio no reintentable se convierte en NonRetriableError", async () => {
    await expect(
      descargarMediaHandler(DATOS, {
        servicio: servicio(async () => {
          throw new ValidationError("ruta de media inválida");
        }),
      }),
    ).rejects.toBeInstanceOf(NonRetriableError);
  });
});
