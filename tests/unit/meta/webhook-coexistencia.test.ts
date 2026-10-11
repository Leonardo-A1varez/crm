import { createHmac } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { makeMetaWebhookHandlers } from "@/app/api/webhooks/meta/route";
import { NoopLogger } from "@/lib/observability/logger";
import { NoopRateLimiter } from "@/lib/rate-limit";

const SECRET = "secreto-de-prueba";
const METADATA = { display_phone_number: "15550783881", phone_number_id: "106540352242922" };

function handlers() {
  const send = vi.fn(async () => ({ ids: [] }));
  const h = makeMetaWebhookHandlers({
    appSecret: SECRET,
    verifyToken: "v",
    inngest: { send } as never,
    rateLimiter: new NoopRateLimiter(),
    logger: new NoopLogger(),
  });
  return { h, send };
}

function post(payload: unknown, firma?: string) {
  const cuerpo = JSON.stringify(payload);
  return new Request("http://localhost/api/webhooks/meta", {
    method: "POST",
    headers: {
      "X-Hub-Signature-256":
        firma ?? "sha256=" + createHmac("sha256", SECRET).update(cuerpo).digest("hex"),
    },
    body: cuerpo,
  });
}

function envolver(field: string, value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      { id: "102290129340398", changes: [{ field, value: { metadata: METADATA, ...value } }] },
    ],
  };
}

type Enviado = { name: string; data: Record<string, unknown>; id?: string };
const nombres = (send: ReturnType<typeof handlers>["send"]) =>
  (send.mock.calls as unknown as [Enviado][]).map(([e]) => e.name);

describe("webhook Meta — coexistencia", () => {
  test("sin firma válida: 401 y no se emite nada (el HMAC sigue primero)", async () => {
    const { h, send } = handlers();
    const r = await h.POST(post(envolver("smb_message_echoes", {}), "sha256=deadbeef"));
    expect(r.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  test("un eco emite meta/coexistencia.eco con id por wamid, y nunca meta/message.received", async () => {
    const { h, send } = handlers();
    const r = await h.POST(
      post(
        envolver("smb_message_echoes", {
          message_echoes: [
            {
              from: "15550783881",
              to: "16505551234",
              id: "wamid.ECO",
              timestamp: "1739321024",
              type: "text",
              text: { body: "hola" },
            },
          ],
        }),
      ),
    );
    expect(r.status).toBe(200);
    expect(nombres(send)).toEqual(["meta/coexistencia.eco"]);
    const [[evento]] = send.mock.calls as unknown as [Enviado][];
    expect(evento.id).toBe("coexistencia-eco:wamid.ECO");
    expect(evento.data).toMatchObject({
      eco: {
        telefono_cliente: "16505551234",
        mensaje: { at: new Date(1739321024000).toISOString() },
      },
    });
  });

  test("history emite el lote, y el rechazo 2593109 emite el error; nada va a eventos operativos", async () => {
    const { h, send } = handlers();
    await h.POST(
      post(
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
                      id: "wamid.H",
                      timestamp: "1",
                      type: "text",
                      text: { body: "x" },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    await h.POST(post(envolver("history", { history: [{ errors: [{ code: 2593109 }] }] })));
    expect(nombres(send)).toEqual([
      "meta/coexistencia.historial",
      "meta/coexistencia.historial-error",
    ]);
  });

  test("contactos emite meta/coexistencia.contactos", async () => {
    const { h, send } = handlers();
    await h.POST(
      post(
        envolver("smb_app_state_sync", {
          state_sync: [
            {
              type: "contact",
              contact: { full_name: "Pablo", phone_number: "16505551234" },
              action: "add",
              metadata: { timestamp: "1" },
            },
          ],
        }),
      ),
    );
    expect(nombres(send)).toEqual(["meta/coexistencia.contactos"]);
  });
});
