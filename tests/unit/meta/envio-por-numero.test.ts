import { randomBytes } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { IllegalStateError } from "@/lib/errors";
import { cifrarToken, llaveroDesdeEnv } from "@/lib/meta/token-cifrado";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryWhatsAppNumerosRepository } from "@/server/repositories/whatsapp-numeros.repo";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { DefaultResolverCredencialesWhatsApp } from "@/server/services/meta/credenciales-whatsapp.service";
import { GraphApiMetaClient } from "@/server/services/meta/graph-api-client";
import { FakeMetaApiClient } from "../../mocks/meta";

const ENV_PHONE = "100000000000001";
const COEX_PHONE = "106540352242922";

function okWa(): Response {
  return new Response(JSON.stringify({ messages: [{ id: "wamid.OK" }] }), { status: 200 });
}

async function resolverCon(numeros: InMemoryWhatsAppNumerosRepository) {
  const llavero = llaveroDesdeEnv({ META_TOKENS_CLAVE: randomBytes(32).toString("base64") });
  await numeros.conectar({
    waba_id: "102290129340398",
    phone_number_id: COEX_PHONE,
    display_phone_number: "+1 555-078-3881",
    verified_name: "Lucky Shrub",
    modo: "coexistencia",
    token_cifrado: cifrarToken("TOKEN-COEX", COEX_PHONE, llavero),
  });
  return new DefaultResolverCredencialesWhatsApp({ repo: numeros, llavero: () => llavero });
}

function clienteCon(fetchImpl: typeof fetch, credenciales?: DefaultResolverCredencialesWhatsApp) {
  return new GraphApiMetaClient({
    graphApiVersion: "v26.0",
    whatsappPhoneNumberId: ENV_PHONE,
    whatsappAccessToken: "TOKEN-ENV",
    baseUrl: "http://127.0.0.1:55390",
    fetchImpl,
    ...(credenciales ? { credenciales } : {}),
  });
}

describe("GraphApiMetaClient — por qué número sale", () => {
  test("con `desde` de un número conectado: su phone_number_id y su token", async () => {
    const f = vi.fn(async () => okWa());
    const c = clienteCon(
      f as unknown as typeof fetch,
      await resolverCon(new InMemoryWhatsAppNumerosRepository()),
    );
    await c.sendText({ canal: "wa", to: "16505551234", text: "hola", desde: COEX_PHONE });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:55390/v26.0/${COEX_PHONE}/messages`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN-COEX");
  });

  test("sin `desde`, o con un número sin fila: el de env, como siempre", async () => {
    const f = vi.fn(async () => okWa());
    const c = clienteCon(
      f as unknown as typeof fetch,
      await resolverCon(new InMemoryWhatsAppNumerosRepository()),
    );
    await c.sendText({ canal: "wa", to: "1", text: "a" });
    await c.sendText({ canal: "wa", to: "1", text: "b", desde: "999" });
    for (const [url, init] of f.mock.calls as unknown as [string, RequestInit][]) {
      expect(url).toContain(`/${ENV_PHONE}/messages`);
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN-ENV");
    }
  });

  test("plantillas, ricos y «escribiendo…» también salen por el número conectado", async () => {
    const f = vi.fn(async () => okWa());
    const c = clienteCon(
      f as unknown as typeof fetch,
      await resolverCon(new InMemoryWhatsAppNumerosRepository()),
    );
    await c.sendTemplate({
      to: "1",
      plantilla: { nombre: "hello_world", idioma: "en_US", parametrosCuerpo: [] },
      desde: COEX_PHONE,
    });
    await c.sendRico({
      to: "1",
      contenido: { tipo: "botones", cuerpo: "x", botones: [{ id: "a", titulo: "A" }] },
      desde: COEX_PHONE,
    });
    await c.sendTypingIndicator({ messageId: "wamid.IN", desde: COEX_PHONE });
    for (const [url] of f.mock.calls as unknown as [string][]) {
      expect(url).toContain(`/${COEX_PHONE}/messages`);
    }
  });

  test("un número conectado cuyo token no se puede descifrar falla: no cae al de env", async () => {
    const numeros = new InMemoryWhatsAppNumerosRepository();
    await resolverCon(numeros);
    const otraClave = llaveroDesdeEnv({ META_TOKENS_CLAVE: randomBytes(32).toString("base64") });
    const roto = new DefaultResolverCredencialesWhatsApp({
      repo: numeros,
      llavero: () => otraClave,
    });
    const f = vi.fn(async () => okWa());
    await expect(
      clienteCon(f as unknown as typeof fetch, roto).sendText({
        canal: "wa",
        to: "1",
        text: "x",
        desde: COEX_PHONE,
      }),
    ).rejects.toBeInstanceOf(IllegalStateError);
    expect(f).not.toHaveBeenCalled();
  });

  test("el resolver cachea: dos envíos seguidos leen el token una sola vez", async () => {
    const numeros = new InMemoryWhatsAppNumerosRepository();
    const resolver = await resolverCon(numeros);
    const espia = vi.spyOn(numeros, "tokenCifrado");
    await resolver.para(COEX_PHONE);
    await resolver.para(COEX_PHONE);
    expect(espia).toHaveBeenCalledTimes(1);
  });
});

describe("DefaultMetaApiService — pasa el número de la conversación", () => {
  test("la conversación con whatsapp_phone_number_id manda `desde`; sin él, no", async () => {
    const conversations = new InMemoryConversationsRepository();
    const client = new FakeMetaApiClient();
    const svc = new DefaultMetaApiService(conversations, new InMemoryMessagesRepository(), client);
    const conCoex = await conversations.create({
      lead_id: crypto.randomUUID(),
      canal: "wa",
      canal_thread_id: "16505551234",
      whatsapp_phone_number_id: COEX_PHONE,
    });
    const sinNumero = await conversations.create({
      lead_id: crypto.randomUUID(),
      canal: "wa",
      canal_thread_id: "16505559999",
    });
    const base = {
      leadSessionId: crypto.randomUUID(),
      canal: "wa" as const,
      sender: "humano" as const,
    };

    await svc.sendOutbound({
      ...base,
      conversacionId: conCoex.id,
      to: "16505551234",
      contenido: "a",
    });
    await svc.sendOutbound({
      ...base,
      conversacionId: sinNumero.id,
      to: "16505559999",
      contenido: "b",
    });
    expect(client.calls).toEqual([
      { canal: "wa", to: "16505551234", text: "a", desde: COEX_PHONE },
      { canal: "wa", to: "16505559999", text: "b" },
    ]);
  });
});
