import { describe, expect, test } from "vitest";
import { parseMetaWebhook } from "@/lib/meta/parse-webhook";

function waPayload(
  messages: Array<Record<string, unknown>>,
  contacts?: Array<Record<string, unknown>>,
) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "PNID", display_phone_number: "+1" },
              ...(contacts ? { contacts } : {}),
              messages,
            },
          },
        ],
      },
    ],
  };
}

function waTexto(from: string, id: string) {
  return { from, id, timestamp: "1700000000", type: "text", text: { body: "hola" } };
}

function igPayload(messaging: Array<Record<string, unknown>>) {
  return {
    object: "instagram",
    entry: [{ id: "PAGE", messaging }],
  };
}

function fbPayload(messaging: Array<Record<string, unknown>>) {
  return {
    object: "page",
    entry: [{ id: "PAGE", messaging }],
  };
}

describe("parseMetaWebhook", () => {
  test("WA text message produce 1 ParsedMessage", () => {
    const result = parseMetaWebhook(
      waPayload([
        {
          from: "5491100000000",
          id: "wamid.HBgL...",
          timestamp: "1700000000",
          type: "text",
          text: { body: "hola, hay pastillas?" },
        },
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      canal: "wa",
      canal_thread_id: "5491100000000",
      meta_user_id: "5491100000000",
      meta_message_id: "wamid.HBgL...",
      tipo: "text",
      contenido: "hola, hay pastillas?",
      media_url: null,
    });
  });

  test("IG text message produce 1 ParsedMessage", () => {
    const result = parseMetaWebhook(
      igPayload([
        {
          sender: { id: "IGSID_LEAD" },
          recipient: { id: "PAGE" },
          timestamp: 1700000000,
          message: { mid: "mid.123", text: "hola" },
        },
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      canal: "ig",
      canal_thread_id: "IGSID_LEAD",
      meta_user_id: "IGSID_LEAD",
      meta_message_id: "mid.123",
      tipo: "text",
      contenido: "hola",
    });
  });

  test("FB Messenger text produce 1 ParsedMessage", () => {
    const result = parseMetaWebhook(
      fbPayload([
        {
          sender: { id: "FB_PSID" },
          recipient: { id: "PAGE" },
          timestamp: 1700000000,
          message: { mid: "mid.fb.1", text: "hola fb" },
        },
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0].canal).toBe("fb");
    expect(result[0].canal_thread_id).toBe("FB_PSID");
    expect(result[0].contenido).toBe("hola fb");
  });

  test("WA image sin caption produce ParsedMessage tipo=image contenido null", () => {
    const result = parseMetaWebhook(
      waPayload([
        {
          from: "549110",
          id: "wamid.img",
          timestamp: "1",
          type: "image",
          image: { id: "media-id-1", mime_type: "image/jpeg" },
        },
      ]),
    );

    expect(result[0].tipo).toBe("image");
    expect(result[0].contenido).toBeNull();
    expect(result[0].media_url).toBeNull();
  });

  test("WA image con caption produce contenido=caption", () => {
    const result = parseMetaWebhook(
      waPayload([
        {
          from: "549110",
          id: "wamid.img2",
          timestamp: "1",
          type: "image",
          image: { id: "media-id-2", caption: "es esta pieza" },
        },
      ]),
    );

    expect(result[0].tipo).toBe("image");
    expect(result[0].contenido).toBe("es esta pieza");
  });

  test("multiples mensajes en una entry retornan multiples ParsedMessage", () => {
    const result = parseMetaWebhook(
      waPayload([
        { from: "1", id: "m1", timestamp: "1", type: "text", text: { body: "uno" } },
        { from: "2", id: "m2", timestamp: "1", type: "text", text: { body: "dos" } },
      ]),
    );

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.contenido)).toEqual(["uno", "dos"]);
  });

  test("payload sin object reconocido retorna []", () => {
    expect(parseMetaWebhook({ object: "desconocido", entry: [] })).toEqual([]);
  });

  test("payload null retorna []", () => {
    expect(parseMetaWebhook(null)).toEqual([]);
    expect(parseMetaWebhook(undefined)).toEqual([]);
    expect(parseMetaWebhook("string")).toEqual([]);
  });

  test("changes.field != messages se ignora", () => {
    const result = parseMetaWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "x",
          changes: [{ field: "statuses", value: { statuses: [] } }],
        },
      ],
    });
    expect(result).toEqual([]);
  });

  test("ParsedMessage incluye raw del mensaje original", () => {
    const msg = {
      from: "1",
      id: "m1",
      timestamp: "1",
      type: "text",
      text: { body: "hola" },
    };
    const result = parseMetaWebhook(waPayload([msg]));
    expect(result[0].raw).toEqual(msg);
  });
});

describe("parseMetaWebhook — nombre de perfil", () => {
  test("WA toma el nombre de contacts[].profile.name", () => {
    const result = parseMetaWebhook(
      waPayload(
        [waTexto("593979932363", "wamid.1")],
        [{ wa_id: "593979932363", profile: { name: "Marcela Pérez" } }],
      ),
    );
    expect(result[0].nombre_perfil).toBe("Marcela Pérez");
  });

  test("cruza cada mensaje con su contacto por wa_id", () => {
    const result = parseMetaWebhook(
      waPayload(
        [waTexto("595981111111", "wamid.1"), waTexto("593979932363", "wamid.2")],
        [
          { wa_id: "593979932363", profile: { name: "Marcela" } },
          { wa_id: "595981111111", profile: { name: "Aldo" } },
        ],
      ),
    );
    expect(result.map((m) => m.nombre_perfil)).toEqual(["Aldo", "Marcela"]);
  });

  test("con un solo contacto lo usa aunque el wa_id no matchee el from", () => {
    // México y Argentina devuelven a veces un `wa_id` normalizado (sin el 1 ni
    // el 9) que no coincide con el `from`. Con un contacto no hay ambigüedad.
    const result = parseMetaWebhook(
      waPayload(
        [waTexto("5491112345678", "wamid.1")],
        [{ wa_id: "541112345678", profile: { name: "Nadia" } }],
      ),
    );
    expect(result[0].nombre_perfil).toBe("Nadia");
  });

  test("con varios contactos y ninguno que matchee no adivina", () => {
    const result = parseMetaWebhook(
      waPayload(
        [waTexto("593979932363", "wamid.1")],
        [
          { wa_id: "111", profile: { name: "Uno" } },
          { wa_id: "222", profile: { name: "Dos" } },
        ],
      ),
    );
    expect(result[0].nombre_perfil).toBeNull();
  });

  test("sin contacts, con contacts vacío o sin profile.name queda null", () => {
    expect(parseMetaWebhook(waPayload([waTexto("1", "m1")]))[0].nombre_perfil).toBeNull();
    expect(parseMetaWebhook(waPayload([waTexto("1", "m1")], []))[0].nombre_perfil).toBeNull();
    expect(
      parseMetaWebhook(waPayload([waTexto("1", "m1")], [{ wa_id: "1", profile: {} }]))[0]
        .nombre_perfil,
    ).toBeNull();
    expect(
      parseMetaWebhook(waPayload([waTexto("1", "m1")], [{ wa_id: "1" }]))[0].nombre_perfil,
    ).toBeNull();
  });

  test("Instagram y Messenger no traen el nombre en el evento de mensaje", () => {
    const ig = parseMetaWebhook(
      igPayload([{ sender: { id: "ig_1" }, message: { mid: "m1", text: "hola" } }]),
    );
    const fb = parseMetaWebhook(
      fbPayload([{ sender: { id: "fb_1" }, message: { mid: "m2", text: "hola" } }]),
    );
    expect(ig[0].nombre_perfil).toBeNull();
    expect(fb[0].nombre_perfil).toBeNull();
  });
});
