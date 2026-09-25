// @vitest-environment node
import { describe, expect, test } from "vitest";
import { InfraError, PermissionDeniedError, RateLimitError, ValidationError } from "@/lib/errors";
import { GraphApiMetaLecturaClient } from "@/server/services/meta/graph-api-lectura";

/**
 * Todos los ids, números y nombres de este archivo son fixtures sintéticos:
 * no corresponden a ningún activo de Meta.
 */
const TOKEN = "EAAtoken-sintetico-de-prueba-0123456789";

interface Llamada {
  url: string;
  init: RequestInit;
}

function fakeFetch(respuestas: Array<Response | Error>) {
  const llamadas: Llamada[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    llamadas.push({ url: String(input), init: init ?? {} });
    const r = respuestas.shift();
    if (r === undefined) throw new Error("fakeFetch: no hay respuesta preparada");
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  return { impl, llamadas };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cliente(fetchImpl: typeof fetch) {
  return new GraphApiMetaLecturaClient({
    graphApiVersion: "v21.0",
    accessToken: TOKEN,
    fetchImpl,
  });
}

async function capturar(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error("se esperaba que la promesa fallara");
    },
    (e: unknown) => e,
  );
}

describe("GraphApiMetaLecturaClient", () => {
  test("leerNumero pide los campos del número con el token en el header, nunca en la URL", async () => {
    const { impl, llamadas } = fakeFetch([
      json({
        id: "101",
        display_phone_number: "+1 555 0100",
        verified_name: "Repuestos Uno",
        quality_rating: "GREEN",
      }),
    ]);

    const numero = await cliente(impl).leerNumero("101");

    expect(numero).toEqual({
      id: "101",
      display_phone_number: "+1 555 0100",
      verified_name: "Repuestos Uno",
      quality_rating: "GREEN",
    });
    const llamada = llamadas[0];
    expect(llamada).toBeDefined();
    const url = new URL(llamada!.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://graph.facebook.com/v21.0/101");
    expect(url.searchParams.get("fields")).toBe(
      "id,display_phone_number,verified_name,quality_rating",
    );
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(llamada!.url).not.toContain(TOKEN);
    expect(new Headers(llamada!.init.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  test("las cinco lecturas salen con GET, sin cuerpo y con una señal de corte", async () => {
    const { impl, llamadas } = fakeFetch([
      json({ id: "101" }),
      json({ id: "101", whatsapp_business_manager_messaging_limit: "TIER_2000" }),
      json({ id: "101", health_status: { can_send_message: "AVAILABLE", entities: [] } }),
      json({ data: [] }),
      json({ data: [] }),
    ]);
    const c = cliente(impl);

    await c.leerNumero("101");
    await c.leerLimiteDeMensajeria("101");
    await c.leerSalud("101");
    await c.listarNumeros("202");
    await c.listarPlantillas("202", 50);

    expect(llamadas).toHaveLength(5);
    for (const { init } of llamadas) {
      expect(init.method).toBe("GET");
      expect(init.body).toBeUndefined();
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  test("leerLimiteDeMensajeria devuelve el escalón tal cual lo manda Meta", async () => {
    const { impl, llamadas } = fakeFetch([
      json({ id: "101", whatsapp_business_manager_messaging_limit: "TIER_2000" }),
    ]);

    expect(await cliente(impl).leerLimiteDeMensajeria("101")).toBe("TIER_2000");
    expect(new URL(llamadas[0]!.url).searchParams.get("fields")).toBe(
      "whatsapp_business_manager_messaging_limit",
    );
  });

  test("leerLimiteDeMensajeria devuelve null si Meta no incluye el campo", async () => {
    const { impl } = fakeFetch([json({ id: "101" })]);

    expect(await cliente(impl).leerLimiteDeMensajeria("101")).toBeNull();
  });

  test("leerSalud trae el estado agregado y cada entidad con sus errores", async () => {
    const { impl, llamadas } = fakeFetch([
      json({
        id: "101",
        health_status: {
          can_send_message: "BLOCKED",
          entities: [
            { entity_type: "PHONE_NUMBER", id: "101", can_send_message: "AVAILABLE" },
            {
              entity_type: "WABA",
              id: "202",
              can_send_message: "BLOCKED",
              errors: [
                {
                  error_code: 1,
                  error_description: "descripción de prueba",
                  possible_solution: "solución de prueba",
                },
              ],
            },
            {
              entity_type: "BUSINESS",
              id: "303",
              can_send_message: "LIMITED",
              additional_info: ["info de prueba"],
            },
          ],
        },
      }),
    ]);

    const salud = await cliente(impl).leerSalud("101");

    expect(new URL(llamadas[0]!.url).searchParams.get("fields")).toBe("health_status");
    expect(salud).toEqual({
      can_send_message: "BLOCKED",
      entities: [
        {
          entity_type: "PHONE_NUMBER",
          id: "101",
          can_send_message: "AVAILABLE",
          additional_info: [],
          errors: [],
        },
        {
          entity_type: "WABA",
          id: "202",
          can_send_message: "BLOCKED",
          additional_info: [],
          errors: [
            {
              error_code: 1,
              error_description: "descripción de prueba",
              possible_solution: "solución de prueba",
            },
          ],
        },
        {
          entity_type: "BUSINESS",
          id: "303",
          can_send_message: "LIMITED",
          additional_info: ["info de prueba"],
          errors: [],
        },
      ],
    });
  });

  test("leerSalud falla con ValidationError si Meta no devuelve health_status", async () => {
    const { impl } = fakeFetch([json({ id: "101" })]);

    expect(await capturar(cliente(impl).leerSalud("101"))).toBeInstanceOf(ValidationError);
  });

  test("listarNumeros lee los números de la WABA", async () => {
    const { impl, llamadas } = fakeFetch([
      json({
        data: [
          {
            id: "101",
            display_phone_number: "+1 555 0100",
            verified_name: "Repuestos Uno",
            quality_rating: "YELLOW",
          },
        ],
        paging: { cursors: { before: "a", after: "b" } },
      }),
    ]);

    const r = await cliente(impl).listarNumeros("202");

    expect(r).toEqual({
      numeros: [
        {
          id: "101",
          display_phone_number: "+1 555 0100",
          verified_name: "Repuestos Uno",
          quality_rating: "YELLOW",
        },
      ],
      hayMas: false,
    });
    const url = new URL(llamadas[0]!.url);
    expect(url.pathname).toBe("/v21.0/202/phone_numbers");
    expect(url.searchParams.get("fields")).toBe(
      "id,display_phone_number,verified_name,quality_rating",
    );
  });

  test("listarPlantillas pide el tope indicado y avisa cuando Meta tiene más", async () => {
    const { impl, llamadas } = fakeFetch([
      json({
        data: [
          {
            id: "9",
            name: "plantilla_de_prueba",
            language: "es",
            category: "UTILITY",
            status: "APPROVED",
            quality_score: { score: "GREEN", date: 1 },
          },
        ],
        paging: { next: "https://graph.facebook.com/siguiente" },
      }),
    ]);

    const r = await cliente(impl).listarPlantillas("202", 50);

    expect(r).toEqual({
      plantillas: [
        {
          id: "9",
          name: "plantilla_de_prueba",
          language: "es",
          category: "UTILITY",
          status: "APPROVED",
          rejected_reason: null,
          quality_score: "GREEN",
          header_text: null,
          body_text: null,
          footer_text: null,
          quick_replies: [],
        },
      ],
      hayMas: true,
    });
    const url = new URL(llamadas[0]!.url);
    expect(url.pathname).toBe("/v21.0/202/message_templates");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("fields")).toBe(
      "id,name,language,category,status,rejected_reason,quality_score,components",
    );
  });

  // Forma de `components` según la referencia de la Template API de Meta
  // (type, text, format, buttons[type, text]), leída el 2026-09-25.
  test("lee el texto de la plantilla: encabezado de texto, cuerpo, pie y respuestas rápidas", async () => {
    const { impl } = fakeFetch([
      json({
        data: [
          {
            id: "9",
            name: "promo_frenos_v3",
            language: "es_AR",
            category: "MARKETING",
            status: "APPROVED",
            components: [
              { type: "HEADER", format: "TEXT", text: "Frenos" },
              { type: "BODY", text: "Hola {{1}}, tenemos pastillas para tu {{2}}." },
              { type: "FOOTER", text: "Respondé BAJA para no recibir más" },
              {
                type: "BUTTONS",
                buttons: [
                  { type: "QUICK_REPLY", text: "Me interesa" },
                  { type: "URL", text: "Ver web", url: "https://example.com" },
                ],
              },
            ],
          },
          {
            id: "10",
            name: "con_imagen",
            components: [
              { type: "HEADER", format: "IMAGE" },
              { type: "BODY", text: "Hola" },
            ],
          },
        ],
      }),
    ]);

    const r = await cliente(impl).listarPlantillas("202", 50);

    expect(r.plantillas[0]).toMatchObject({
      header_text: "Frenos",
      body_text: "Hola {{1}}, tenemos pastillas para tu {{2}}.",
      footer_text: "Respondé BAJA para no recibir más",
      quick_replies: ["Me interesa"],
    });
    // Un encabezado de imagen no es texto: no se inventa uno.
    expect(r.plantillas[1]).toMatchObject({ header_text: null, body_text: "Hola" });
  });

  test("un estado de plantilla que Meta agregue mañana pasa crudo y no rompe la lectura", async () => {
    const { impl } = fakeFetch([
      json({ data: [{ id: 9, name: "plantilla_de_prueba", status: "ESTADO_NUEVO" }] }),
    ]);

    const r = await cliente(impl).listarPlantillas("202", 50);

    expect(r.plantillas[0]).toMatchObject({ id: "9", status: "ESTADO_NUEVO", category: null });
  });

  test("rechaza un id que no es numérico sin salir a la red", async () => {
    const { impl, llamadas } = fakeFetch([]);

    expect(await capturar(cliente(impl).leerNumero("101/../me"))).toBeInstanceOf(ValidationError);
    expect(llamadas).toHaveLength(0);
  });

  test("401 da PermissionDeniedError con el mensaje de Meta y sin el token aunque Meta lo repita", async () => {
    const { impl } = fakeFetch([
      json(
        {
          error: {
            message: `Error validating access token: ${TOKEN} has expired`,
            code: 190,
            fbtrace_id: "trace-de-prueba",
          },
        },
        401,
      ),
    ]);

    const error = await capturar(cliente(impl).leerNumero("101"));

    expect(error).toBeInstanceOf(PermissionDeniedError);
    expect((error as Error).message).toContain("Error validating access token");
    expect((error as Error).message).not.toContain(TOKEN);
  });

  test("400 da ValidationError con el texto de Meta", async () => {
    const { impl } = fakeFetch([
      json({ error: { message: "(#100) campo de prueba inexistente", code: 100 } }, 400),
    ]);

    const error = await capturar(cliente(impl).leerLimiteDeMensajeria("101"));

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toContain("(#100) campo de prueba inexistente");
  });

  test("429 da RateLimitError", async () => {
    const { impl } = fakeFetch([json({ error: { message: "demasiados pedidos" } }, 429)]);

    expect(await capturar(cliente(impl).leerSalud("101"))).toBeInstanceOf(RateLimitError);
  });

  test("500 da InfraError", async () => {
    const { impl } = fakeFetch([json({ error: { message: "falla de prueba" } }, 500)]);

    expect(await capturar(cliente(impl).listarNumeros("202"))).toBeInstanceOf(InfraError);
  });

  test("un fallo de red da InfraError", async () => {
    const { impl } = fakeFetch([new TypeError("fetch failed")]);

    expect(await capturar(cliente(impl).leerNumero("101"))).toBeInstanceOf(InfraError);
  });

  test("un corte por tiempo da InfraError que dice que Meta tardó", async () => {
    const corte = new Error("The operation was aborted due to timeout");
    corte.name = "TimeoutError";
    const { impl } = fakeFetch([corte]);

    const error = await capturar(cliente(impl).leerNumero("101"));

    expect(error).toBeInstanceOf(InfraError);
    expect((error as Error).message).toMatch(/tardó/);
  });

  test("una respuesta que no es JSON da InfraError", async () => {
    const { impl } = fakeFetch([new Response("<html>no</html>", { status: 200 })]);

    expect(await capturar(cliente(impl).leerNumero("101"))).toBeInstanceOf(InfraError);
  });
});
