import { describe, expect, test } from "vitest";
import { parseMetaOperationalEvents } from "@/lib/meta/parse-webhook";

/**
 * Los payloads de acá son **verbatim de la referencia oficial de Meta**
 * (`developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/...`,
 * actualizada el 2025-11-14), no inventados. Se obtuvieron con
 * `devtools_discovery` del MCP oficial de Meta el 2026-08-25.
 *
 * Importa que sean literales: un parser escrito contra una forma imaginada
 * pasa sus propios tests y falla contra el tráfico real. Es exactamente el
 * modo de falla que este proyecto ya pagó con los schemas de Structured
 * Outputs, invisibles porque los tests usaban un mock que aceptaba cualquier
 * cosa.
 */

function envolver(field: string, value: Record<string, unknown>, time?: number) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        ...(time === undefined ? {} : { time }),
        changes: [{ value, field }],
      },
    ],
  };
}

describe("parseMetaOperationalEvents", () => {
  test("plantilla aprobada", () => {
    const eventos = parseMetaOperationalEvents(
      envolver(
        "message_template_status_update",
        {
          event: "APPROVED",
          message_template_id: 1689556908129832,
          message_template_name: "order_confirmation",
          message_template_language: "en-US",
          reason: "NONE",
          message_template_category: "UTILITY",
        },
        1751247548,
      ),
    );

    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      campo: "message_template_status_update",
      evento: "APPROVED",
      objeto_id: "1689556908129832",
      objeto_nombre: "order_confirmation",
    });
    expect(eventos[0]?.ocurrido_at?.toISOString()).toBe("2025-06-30T01:39:08.000Z");
  });

  test("plantilla rechazada conserva el motivo y la recomendacion", () => {
    const eventos = parseMetaOperationalEvents(
      envolver("message_template_status_update", {
        event: "REJECTED",
        message_template_id: 1689556908129835,
        message_template_name: "abandoned_cart",
        message_template_language: "en",
        reason: "INVALID_FORMAT",
        message_template_category: "MARKETING",
        rejection_info: {
          reason: "Your template has parameters placed next to each other.",
          recommendation: "Separate parameters with descriptive text.",
        },
      }),
    );

    expect(eventos[0]?.evento).toBe("REJECTED");
    // El payload crudo es la fuente de verdad: sin el, el motivo del rechazo
    // —lo unico accionable del evento— se perderia.
    expect(eventos[0]?.payload["rejection_info"]).toMatchObject({
      reason: expect.stringContaining("parameters"),
    });
  });

  test("cambio de limite de mensajeria del numero", () => {
    const eventos = parseMetaOperationalEvents(
      envolver("phone_number_quality_update", {
        display_phone_number: "15550783881",
        event: "THROUGHPUT_UPGRADE",
        current_limit: "TIER_UNLIMITED",
      }),
    );

    expect(eventos[0]).toMatchObject({
      campo: "phone_number_quality_update",
      evento: "THROUGHPUT_UPGRADE",
      objeto_id: "15550783881",
    });
  });

  /**
   * Meta anuncia en su propia doc que `current_limit` y `old_limit` se retiran
   * en febrero de 2026, reemplazados por `max_daily_conversations_per_business`.
   * Esa fecha YA PASO y el ejemplo de la doc todavia los muestra: la doc quedo
   * atrasada respecto de su propio aviso. Un parser que dependa de
   * `current_limit` puede recibir `undefined` hoy mismo.
   */
  test("sobrevive al payload sin los campos que Meta retiro en febrero 2026", () => {
    const eventos = parseMetaOperationalEvents(
      envolver("phone_number_quality_update", {
        display_phone_number: "15550783881",
        event: "THROUGHPUT_UPGRADE",
        max_daily_conversations_per_business: "TIER_2K",
      }),
    );

    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.evento).toBe("THROUGHPUT_UPGRADE");
  });

  test("un campo operativo desconocido igual se captura", () => {
    // Meta agrega campos sin avisar. Capturarlos crudos es lo que permite
    // enterarse de que existen, en vez de descartarlos como hacia el codigo
    // viejo con `if (change.field !== "messages") continue`.
    const eventos = parseMetaOperationalEvents(
      envolver("campo_que_meta_invento_manana", { event: "ALGO", cosa: 1 }),
    );

    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.campo).toBe("campo_que_meta_invento_manana");
    expect(eventos[0]?.evento).toBe("ALGO");
  });

  test("NO captura mensajes ni estados: esos tienen su propio camino", () => {
    const mensajes = envolver("messages", {
      metadata: { phone_number_id: "PNID" },
      messages: [{ id: "wamid.X", from: "123", type: "text", text: { body: "hola" } }],
    });
    expect(parseMetaOperationalEvents(mensajes)).toHaveLength(0);
  });

  test("payload de otro canal o basura devuelve vacio", () => {
    expect(parseMetaOperationalEvents({ object: "instagram", entry: [] })).toHaveLength(0);
    expect(parseMetaOperationalEvents(null)).toHaveLength(0);
    expect(parseMetaOperationalEvents({ entry: "no-es-array" })).toHaveLength(0);
  });

  test("varios cambios en un mismo POST se capturan todos", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            { field: "message_template_status_update", value: { event: "APPROVED" } },
            { field: "account_alerts", value: { event: "ALERTA" } },
            { field: "messages", value: { messages: [] } },
          ],
        },
      ],
    };
    const eventos = parseMetaOperationalEvents(payload);
    expect(eventos.map((e) => e.campo)).toEqual([
      "message_template_status_update",
      "account_alerts",
    ]);
  });
});
