import { describe, expect, test } from "vitest";
import {
  CAMPOS_COEXISTENCIA,
  deserializarLote,
  parseCoexistencia,
  partirLote,
} from "@/lib/meta/parse-coexistencia";
import { parseMetaOperationalEvents, parseMetaWebhook } from "@/lib/meta/parse-webhook";

// Formas tomadas de los ejemplos de Meta (onboarding-business-app-users, leída
// el 2026-10-11). Valores de ejemplo de esa misma página; nada real.
const METADATA = { display_phone_number: "15550783881", phone_number_id: "106540352242922" };

function envolver(field: string, value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "102290129340398", changes: [{ value, field }] }],
  };
}

const HISTORIAL = envolver("history", {
  messaging_product: "whatsapp",
  metadata: METADATA,
  history: [
    {
      metadata: { phase: 0, chunk_order: 1, progress: 55 },
      threads: [
        {
          id: "16505551234",
          messages: [
            {
              from: "15550783881",
              id: "wamid.SALIENTE",
              timestamp: "1739230955",
              type: "text",
              text: { body: "Here's the info you requested!" },
              history_context: { status: "READ" },
            },
            {
              from: "15550783881",
              id: "wamid.PLACEHOLDER",
              timestamp: "1739230970",
              type: "media_placeholder",
              history_context: { status: "PLAYED" },
            },
            {
              from: "16505551234",
              id: "wamid.ENTRANTE",
              timestamp: "1739230971",
              type: "text",
              text: { body: "Thanks!" },
              history_context: { status: "READ" },
            },
          ],
        },
      ],
    },
  ],
});

describe("parseCoexistencia — history", () => {
  test("un lote con su fase, su orden, su progreso y el número de negocio", () => {
    const r = parseCoexistencia(HISTORIAL);
    expect(r.historial).toHaveLength(1);
    const lote = r.historial[0]!;
    expect(lote).toMatchObject({
      phone_number_id: "106540352242922",
      fase: 0,
      chunk: 1,
      progreso: 55,
    });
    expect(lote.hilos).toHaveLength(1);
    expect(lote.hilos[0]!.telefono_cliente).toBe("16505551234");
  });

  test("la dirección sale de quién escribe: el cliente es el id del hilo", () => {
    const [hilo] = parseCoexistencia(HISTORIAL).historial[0]!.hilos;
    const porId = new Map(hilo!.mensajes.map((m) => [m.meta_message_id, m]));
    expect(porId.get("wamid.SALIENTE")).toMatchObject({
      direction: "out",
      tipo: "text",
      contenido: "Here's the info you requested!",
    });
    expect(porId.get("wamid.ENTRANTE")).toMatchObject({ direction: "in", contenido: "Thanks!" });
    expect(porId.get("wamid.ENTRANTE")!.at?.toISOString()).toBe(
      new Date(1739230971 * 1000).toISOString(),
    );
  });

  test("media_placeholder no se importa: llega después en otro webhook con el contenido", () => {
    const r = parseCoexistencia(HISTORIAL);
    const ids = r.historial[0]!.hilos[0]!.mensajes.map((m) => m.meta_message_id);
    expect(ids).not.toContain("wamid.PLACEHOLDER");
    expect(r.historial[0]!.omitidos).toBe(1);
  });

  test("historial rechazado por el negocio (2593109) sale como error, sin hilos", () => {
    const r = parseCoexistencia(
      envolver("history", {
        messaging_product: "whatsapp",
        metadata: METADATA,
        history: [
          {
            errors: [
              {
                code: 2593109,
                title: "History sync is turned off by the business from the WhatsApp Business App",
                message:
                  "History sync is turned off by the business from the WhatsApp Business App",
                error_data: { details: "History sharing is turned off by the business" },
              },
            ],
          },
        ],
      }),
    );
    expect(r.historial).toHaveLength(0);
    expect(r.historialErrores).toEqual([{ phone_number_id: "106540352242922", codigo: 2593109 }]);
  });
});

describe("parseCoexistencia — smb_app_state_sync", () => {
  test("cada contacto con su teléfono en dígitos, su nombre y la acción", () => {
    const r = parseCoexistencia(
      envolver("smb_app_state_sync", {
        messaging_product: "whatsapp",
        metadata: METADATA,
        state_sync: [
          {
            type: "contact",
            contact: {
              full_name: "Pablo Morales",
              first_name: "Pablo",
              phone_number: "+1 650-555-1234",
            },
            action: "add",
            metadata: { timestamp: "1738346866" },
          },
          {
            type: "contact",
            contact: { phone_number: "16505559999" },
            action: "remove",
            metadata: { timestamp: "1738346867" },
          },
          { type: "otra_cosa", action: "add" },
        ],
      }),
    );
    expect(r.contactos).toEqual([
      {
        phone_number_id: "106540352242922",
        telefono: "16505551234",
        nombre: "Pablo Morales",
        accion: "add",
      },
      {
        phone_number_id: "106540352242922",
        telefono: "16505559999",
        nombre: null,
        accion: "remove",
      },
    ]);
  });
});

describe("parseCoexistencia — smb_message_echoes", () => {
  test("lo que el negocio mandó desde la app sale como saliente al `to`", () => {
    const r = parseCoexistencia(
      envolver("smb_message_echoes", {
        messaging_product: "whatsapp",
        metadata: METADATA,
        message_echoes: [
          {
            from: "15550783881",
            to: "16505551234",
            id: "wamid.ECO",
            timestamp: "1739321024",
            type: "text",
            text: { body: "Te lo mando mañana" },
          },
        ],
      }),
    );
    expect(r.ecos).toHaveLength(1);
    expect(r.ecos[0]).toMatchObject({
      phone_number_id: "106540352242922",
      telefono_cliente: "16505551234",
      mensaje: {
        meta_message_id: "wamid.ECO",
        direction: "out",
        tipo: "text",
        contenido: "Te lo mando mañana",
      },
    });
  });
});

describe("partirLote", () => {
  function mensajes(n: number, prefijo: string) {
    return Array.from({ length: n }, (_, i) => ({
      meta_message_id: `${prefijo}${i}`,
      direction: "in" as const,
      tipo: "text" as const,
      contenido: "x",
      at: new Date(1739230955000 + i),
    }));
  }

  test("reparte en partes de a lo sumo 100 mensajes sin perder ni repetir ninguno", () => {
    const lote = {
      phone_number_id: "1",
      fase: 1,
      chunk: 3,
      progreso: 70,
      omitidos: 2,
      hilos: [
        { telefono_cliente: "11", mensajes: mensajes(150, "a") },
        { telefono_cliente: "22", mensajes: mensajes(80, "b") },
      ],
    };
    const partes = partirLote(lote);
    expect(partes.map((p) => p.hilos.reduce((s, h) => s + h.mensajes.length, 0))).toEqual([
      100, 100, 30,
    ]);
    const ids = partes.flatMap((p) =>
      p.hilos.flatMap((h) => h.mensajes.map((m) => m.meta_message_id)),
    );
    expect(new Set(ids).size).toBe(230);
    // El progreso sólo en la última: si no, la primera daría el historial por completo.
    expect(partes.map((p) => p.progreso)).toEqual([null, null, 70]);
    // Las fechas viajan en ISO y vuelven a Date.
    expect(deserializarLote(partes[0]!).hilos[0]!.mensajes[0]!.at).toEqual(new Date(1739230955000));
  });

  test("un lote sin hilos (sólo progreso) sale en una parte con su progreso", () => {
    const partes = partirLote({
      phone_number_id: "1",
      fase: 2,
      chunk: 9,
      progreso: 100,
      omitidos: 0,
      hilos: [],
    });
    expect(partes).toEqual([
      { phone_number_id: "1", fase: 2, chunk: 9, progreso: 100, omitidos: 0, hilos: [] },
    ]);
  });
});

describe("los tres campos no se cuelan por los otros parsers", () => {
  test("no son mensajes entrantes", () => {
    expect(parseMetaWebhook(HISTORIAL)).toEqual([]);
  });

  test("no se guardan como eventos operativos (traen PII y van por su propio camino)", () => {
    for (const campo of CAMPOS_COEXISTENCIA) {
      expect(parseMetaOperationalEvents(envolver(campo, { metadata: METADATA }))).toEqual([]);
    }
    expect(parseMetaOperationalEvents(envolver("account_update", { event: "X" }))).toHaveLength(1);
  });

  test("el mensaje entrante trae el phone_number_id del número de negocio", () => {
    const [m] = parseMetaWebhook(
      envolver("messages", {
        messaging_product: "whatsapp",
        metadata: METADATA,
        messages: [
          {
            from: "16505551234",
            id: "wamid.X",
            timestamp: "1",
            type: "text",
            text: { body: "hola" },
          },
        ],
      }),
    );
    expect(m?.numero_negocio_id).toBe("106540352242922");
  });

  test("otro objeto que no es WhatsApp devuelve todo vacío", () => {
    expect(parseCoexistencia({ object: "page", entry: [] })).toEqual({
      historial: [],
      historialErrores: [],
      contactos: [],
      ecos: [],
    });
  });
});
