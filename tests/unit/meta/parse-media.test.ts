import { describe, expect, test } from "vitest";
import { parseCoexistencia } from "@/lib/meta/parse-coexistencia";
import { parseMetaWebhook } from "@/lib/meta/parse-webhook";

// Formas tomadas de la referencia de webhooks de Meta (messages/image, audio,
// video, document, sticker) y del follow-up de `history` con media, leídos el
// 2026-10-11 (docs/meta/media.md §1). Valores de ejemplo; nada real.
const METADATA = { display_phone_number: "15550783881", phone_number_id: "106540352242922" };

function waPayload(message: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [{ field: "messages", value: { metadata: METADATA, messages: [message] } }],
      },
    ],
  };
}

function envolver(field: string, value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ value: { metadata: METADATA, ...value }, field }] }],
  };
}

const base = { from: "5491100000000", timestamp: "1744344496" };

describe("parseMetaWebhook: media entrante", () => {
  test("imagen: id, tipo y caption; sin URL (Meta la da recien al pedir el id)", () => {
    const [m] = parseMetaWebhook(
      waPayload({
        ...base,
        id: "wamid.IMG",
        type: "image",
        image: {
          id: "1234567890123456",
          mime_type: "image/jpeg",
          sha256: "EXAMPLE_SHA256_HASH=",
          caption: "Product photo",
          url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=EXAMPLE",
        },
      }),
    );
    expect(m).toMatchObject({
      tipo: "image",
      contenido: "Product photo",
      media_url: null,
      media: { id: "1234567890123456", mime: "image/jpeg", nombre: null },
    });
    // La URL del webhook no se guarda ni se usa: expira a los 5 minutos y el
    // flujo confirmado es GET /{media-id}.
    expect(JSON.stringify(m!.media)).not.toContain("lookaside");
  });

  test("nota de voz: audio con voz y tipo con parametros", () => {
    const [m] = parseMetaWebhook(
      waPayload({
        ...base,
        id: "wamid.VOZ",
        type: "audio",
        audio: { id: "1908647269898587", mime_type: "audio/ogg; codecs=opus", voice: true },
      }),
    );
    expect(m).toMatchObject({
      tipo: "audio",
      contenido: null,
      media: { id: "1908647269898587", mime: "audio/ogg; codecs=opus", voz: true },
    });
  });

  test("video con caption", () => {
    const [m] = parseMetaWebhook(
      waPayload({
        ...base,
        id: "wamid.VID",
        type: "video",
        video: { id: "731675419373506", mime_type: "video/mp4", caption: "Timelapse" },
      }),
    );
    expect(m).toMatchObject({
      tipo: "video",
      contenido: "Timelapse",
      media: { id: "731675419373506" },
    });
  });

  test("documento: el nombre original viaja aparte del caption", () => {
    const [m] = parseMetaWebhook(
      waPayload({
        ...base,
        id: "wamid.DOC",
        type: "document",
        document: {
          id: "1234567890123456",
          mime_type: "application/pdf",
          filename: "invoice.pdf",
          caption: "Q3 invoice",
        },
      }),
    );
    expect(m).toMatchObject({
      tipo: "doc",
      contenido: "Q3 invoice",
      media: { id: "1234567890123456", mime: "application/pdf", nombre: "invoice.pdf" },
    });
  });

  test("sticker: antes se descartaba; ahora entra como imagen marcada", () => {
    const [m] = parseMetaWebhook(
      waPayload({
        ...base,
        id: "wamid.STK",
        type: "sticker",
        sticker: { id: "1908647269898587", mime_type: "image/webp", animated: true },
      }),
    );
    expect(m).toMatchObject({
      tipo: "image",
      contenido: null,
      media: { id: "1908647269898587", mime: "image/webp", sticker: true, animado: true },
    });
  });

  test("un mensaje de media sin id no se puede bajar: entra sin media, no se inventa", () => {
    const [m] = parseMetaWebhook(
      waPayload({ ...base, id: "wamid.SINID", type: "image", image: { mime_type: "image/jpeg" } }),
    );
    expect(m?.tipo).toBe("image");
    expect(m?.media).toBeUndefined();
  });

  test("un texto no trae media", () => {
    const [m] = parseMetaWebhook(
      waPayload({ ...base, id: "wamid.T", type: "text", text: { body: "hola" } }),
    );
    expect(m?.media).toBeUndefined();
  });
});

describe("parseCoexistencia: media en ecos e historial", () => {
  test("eco con imagen: trae el id de media", () => {
    const r = parseCoexistencia(
      envolver("smb_message_echoes", {
        message_echoes: [
          {
            from: "15550783881",
            to: "16505551234",
            id: "wamid.ECOIMG",
            timestamp: "1700255121",
            type: "image",
            image: {
              caption: "Black Prince echeveria",
              mime_type: "image/jpeg",
              id: "24230790383178626",
            },
          },
        ],
      }),
    );
    expect(r.ecos[0]?.mensaje).toMatchObject({
      tipo: "image",
      direction: "out",
      contenido: "Black Prince echeveria",
      media: { id: "24230790383178626", mime: "image/jpeg" },
    });
  });

  test("historial: el follow-up con el id de media entra como un lote de un mensaje", () => {
    // Forma del ejemplo de Meta: `field: history` con `messages[]` directo en
    // el value (no dentro de `history[]`), `from` = el cliente.
    const r = parseCoexistencia(
      envolver("history", {
        messaging_product: "whatsapp",
        messages: [
          {
            from: "16505551234",
            id: "wamid.PLACEHOLDER",
            timestamp: "1738796547",
            type: "image",
            image: {
              caption: "Black Prince echeveria",
              mime_type: "image/jpeg",
              sha256: "3f9d94d3",
              id: "24230790383178626",
            },
          },
        ],
      }),
    );
    expect(r.historial).toHaveLength(1);
    const lote = r.historial[0]!;
    expect(lote).toMatchObject({
      phone_number_id: "106540352242922",
      fase: null,
      chunk: null,
      progreso: null,
    });
    expect(lote.hilos).toEqual([
      {
        telefono_cliente: "16505551234",
        mensajes: [
          expect.objectContaining({
            meta_message_id: "wamid.PLACEHOLDER",
            direction: "in",
            tipo: "image",
            contenido: "Black Prince echeveria",
            media: expect.objectContaining({ id: "24230790383178626" }),
          }),
        ],
      },
    ]);
  });

  test("historial: si lo mando el negocio, el cliente sale del `to`; sin `to` no se adivina", () => {
    const conTo = parseCoexistencia(
      envolver("history", {
        messages: [
          {
            from: "15550783881",
            to: "16505551234",
            id: "wamid.OUT",
            timestamp: "1738796547",
            type: "document",
            document: { id: "99", mime_type: "application/pdf", filename: "lista.pdf" },
          },
        ],
      }),
    );
    expect(conTo.historial[0]?.hilos[0]).toMatchObject({
      telefono_cliente: "16505551234",
      mensajes: [{ direction: "out", tipo: "doc", media: { id: "99", nombre: "lista.pdf" } }],
    });

    const sinTo = parseCoexistencia(
      envolver("history", {
        messages: [
          {
            from: "15550783881",
            id: "wamid.OUT2",
            timestamp: "1738796547",
            type: "image",
            image: { id: "98", mime_type: "image/jpeg" },
          },
        ],
      }),
    );
    expect(sinTo.historial.flatMap((l) => l.hilos)).toEqual([]);
  });

  test("el historial normal con history[] sigue como antes", () => {
    const r = parseCoexistencia(
      envolver("history", {
        history: [
          {
            metadata: { phase: 0, chunk_order: 1, progress: 100 },
            threads: [
              {
                id: "16505551234",
                messages: [
                  {
                    from: "16505551234",
                    id: "wamid.A",
                    timestamp: "1739230971",
                    type: "text",
                    text: { body: "Thanks!" },
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(r.historial).toHaveLength(1);
    expect(r.historial[0]).toMatchObject({ fase: 0, chunk: 1, progreso: 100 });
  });
});
