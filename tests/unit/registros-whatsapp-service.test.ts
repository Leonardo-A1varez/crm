import { describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import { InMemoryMetaOperationalEventsRepository } from "@/server/repositories/meta-operational-events.repo";
import { InMemoryWhatsAppNumerosRolRepository } from "@/server/repositories/whatsapp-numeros-rol.repo";
import { DefaultRegistrosWhatsAppService } from "@/server/services/meta/registros-whatsapp.service";
import type { UsoCupoRepository } from "@/server/repositories/uso-cupo.repo";

/** Fixture sintético: ningún id es un activo real. */
function usoFijo(): UsoCupoRepository & { pedidos: { dias: number; zona: string }[] } {
  const pedidos: { dias: number; zona: string }[] = [];
  return {
    pedidos,
    async destinatariosPorDia(dias, zona) {
      pedidos.push({ dias, zona });
      return { dias: [{ dia: "2026-09-25", destinatarios: 3 }], totalVentana: 3 };
    },
  };
}

function servicio(
  over: Partial<ConstructorParameters<typeof DefaultRegistrosWhatsAppService>[0]> = {},
) {
  return new DefaultRegistrosWhatsAppService({
    eventos: new InMemoryMetaOperationalEventsRepository(),
    uso: usoFijo(),
    roles: new InMemoryWhatsAppNumerosRolRepository(),
    ...over,
  });
}

describe("DefaultRegistrosWhatsAppService.sanciones", () => {
  test("lee sólo account_update y usa la hora de Meta cuando la hay", async () => {
    const eventos = new InMemoryMetaOperationalEventsRepository();
    await eventos.registrar({
      campo: "message_template_status_update",
      evento: "REJECTED",
      objeto_id: "1",
      objeto_nombre: "x",
      payload: { event: "REJECTED" },
      ocurrido_at: null,
    });
    await eventos.registrar({
      campo: "account_update",
      evento: "ACCOUNT_VIOLATION",
      objeto_id: null,
      objeto_nombre: null,
      payload: { event: "ACCOUNT_VIOLATION", violation_info: { violation_type: "ADULT" } },
      ocurrido_at: new Date("2026-08-12T10:00:00Z"),
    });

    const leidas = await servicio({ eventos }).sanciones();

    expect(leidas.registros).toEqual([
      { evento: { tipo: "infraccion", violacion: "ADULT" }, at: new Date("2026-08-12T10:00:00Z") },
    ]);
    expect(leidas.truncado).toBe(false);
  });
});

describe("DefaultRegistrosWhatsAppService.usoDelCupo", () => {
  test("pide 7 días en la zona del negocio", async () => {
    const uso = usoFijo();
    const r = await servicio({ uso }).usoDelCupo("America/Guayaquil");
    expect(uso.pedidos).toEqual([{ dias: 7, zona: "America/Guayaquil" }]);
    expect(r.totalVentana).toBe(3);
  });

  test("una zona que no existe no llega a la base", async () => {
    const uso = usoFijo();
    await expect(servicio({ uso }).usoDelCupo("Marte/Olympus")).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(uso.pedidos).toEqual([]);
  });
});

describe("DefaultRegistrosWhatsAppService roles", () => {
  test("guarda el rol recortado y lo devuelve por phone_number_id", async () => {
    const s = servicio();
    await s.guardarRol({ phoneNumberId: "1278451868", rol: "  Posventa ", actorId: null });
    expect(await s.roles()).toEqual(new Map([["1278451868", "Posventa"]]));
  });

  test("un rol vacío borra la etiqueta", async () => {
    const s = servicio();
    await s.guardarRol({ phoneNumberId: "1278451868", rol: "Posventa", actorId: null });
    await s.guardarRol({ phoneNumberId: "1278451868", rol: "   ", actorId: null });
    expect(await s.roles()).toEqual(new Map());
  });
});
