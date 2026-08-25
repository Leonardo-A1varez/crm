import { describe, expect, test, vi } from "vitest";
import { operationalReceivedHandler } from "@/inngest/functions/on-operational-received";
import { InMemoryMetaOperationalEventsRepository } from "@/server/repositories/meta-operational-events.repo";

function entrada(over: Partial<Parameters<typeof operationalReceivedHandler>[0]> = {}) {
  return {
    campo: "message_template_status_update",
    evento: "APPROVED",
    objeto_id: "1689556908129832",
    objeto_nombre: "order_confirmation",
    payload: { event: "APPROVED", message_template_name: "order_confirmation" },
    ocurrido_at: "2025-06-30T01:39:08.000Z",
    ...over,
  };
}

describe("operationalReceivedHandler", () => {
  test("persiste el evento con el payload crudo intacto", async () => {
    const eventos = new InMemoryMetaOperationalEventsRepository();
    await operationalReceivedHandler(entrada(), { eventos });

    const [fila] = await eventos.listarRecientes();
    expect(fila).toMatchObject({
      campo: "message_template_status_update",
      evento: "APPROVED",
      objeto_nombre: "order_confirmation",
    });
    expect(fila?.ocurrido_at?.toISOString()).toBe("2025-06-30T01:39:08.000Z");
    // El crudo es la fuente de verdad, no un extra.
    expect(fila?.payload).toMatchObject({ event: "APPROVED" });
  });

  test("un rechazo se loguea en warn, no en info", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
    await operationalReceivedHandler(entrada({ evento: "REJECTED" }), {
      eventos: new InMemoryMetaOperationalEventsRepository(),
      logger: logger as never,
    });

    // Que una plantilla quede rechazada frena una campaña: tiene que saltar
    // por encima del ruido de info.
    expect(logger.warn).toHaveBeenCalledWith("meta.operational.atencion", expect.anything());
    expect(logger.info).not.toHaveBeenCalled();
  });

  test("una buena noticia se loguea en info", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
    await operationalReceivedHandler(
      entrada({ campo: "phone_number_quality_update", evento: "THROUGHPUT_UPGRADE" }),
      { eventos: new InMemoryMetaOperationalEventsRepository(), logger: logger as never },
    );

    expect(logger.info).toHaveBeenCalledWith("meta.operational.registrado", expect.anything());
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("el log NO lleva el payload crudo", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
    await operationalReceivedHandler(
      entrada({ payload: { event: "APPROVED", algo_sensible: "no-deberia-loguearse" } }),
      { eventos: new InMemoryMetaOperationalEventsRepository(), logger: logger as never },
    );

    const contexto = JSON.stringify(logger.info.mock.calls[0]?.[1] ?? {});
    expect(contexto).not.toContain("no-deberia-loguearse");
  });

  test("un evento sin fecha ni objeto igual se persiste", async () => {
    const eventos = new InMemoryMetaOperationalEventsRepository();
    await operationalReceivedHandler(
      entrada({
        campo: "account_alerts",
        evento: null,
        objeto_id: null,
        objeto_nombre: null,
        ocurrido_at: null,
      }),
      { eventos },
    );

    const [fila] = await eventos.listarRecientes();
    expect(fila?.campo).toBe("account_alerts");
    expect(fila?.ocurrido_at).toBeNull();
  });

  test("listarRecientes filtra por campo y acota el limite", async () => {
    const eventos = new InMemoryMetaOperationalEventsRepository();
    await operationalReceivedHandler(entrada(), { eventos });
    await operationalReceivedHandler(entrada({ campo: "account_alerts" }), { eventos });

    expect(await eventos.listarRecientes({ campo: "account_alerts" })).toHaveLength(1);
    // El tope duro existe porque PostgREST corta en 1.000 filas sin avisar.
    expect(await eventos.listarRecientes({ limite: 99999 })).toHaveLength(2);
  });
});
