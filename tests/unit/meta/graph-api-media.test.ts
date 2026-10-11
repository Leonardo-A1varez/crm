// @vitest-environment node
import { describe, expect, test } from "vitest";
import { InfraError, NotFoundError, ValidationError } from "@/lib/errors";
import { GraphApiMediaClient, MediaDemasiadoGrande } from "@/server/services/meta/graph-api-media";

const BASE = "https://graph.example.test";
const CFG = {
  graphApiVersion: "v26.0",
  whatsappPhoneNumberId: "PHONE_ENV",
  whatsappAccessToken: "TOKEN_ENV",
  baseUrl: BASE,
};

interface Llamada {
  url: string;
  init: RequestInit;
}

function fakeFetch(respuestas: Array<Response | Error>) {
  const llamadas: Llamada[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init ?? {} });
    const r = respuestas.shift();
    if (!r) throw new Error("fetch sin respuesta preparada");
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  return { fn, llamadas };
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

const credenciales = {
  para: async (id: string) =>
    id === "PHONE_COEX" ? { phoneNumberId: id, accessToken: "TOKEN_COEX" } : null,
};

describe("GraphApiMediaClient.obtenerMedia", () => {
  test("GET /{media-id} con el token del numero y devuelve url, tipo y tamano", async () => {
    const { fn, llamadas } = fakeFetch([
      json({
        messaging_product: "whatsapp",
        url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1",
        mime_type: "image/jpeg",
        sha256: "abc",
        file_size: 12345,
        id: "MEDIA1",
      }),
    ]);
    const c = new GraphApiMediaClient({ ...CFG, fetchImpl: fn, credenciales });
    const r = await c.obtenerMedia("MEDIA1", { desde: "PHONE_COEX" });
    expect(r).toEqual({
      url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1",
      mime: "image/jpeg",
      bytes: 12345,
    });
    expect(llamadas[0]!.url).toBe(`${BASE}/v26.0/MEDIA1?phone_number_id=PHONE_COEX`);
    expect((llamadas[0]!.init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer TOKEN_COEX",
    );
  });

  test("sin numero conectado usa el token de env", async () => {
    const { fn, llamadas } = fakeFetch([json({ url: "https://x.fbsbx.com/a", id: "M" })]);
    const c = new GraphApiMediaClient({ ...CFG, fetchImpl: fn, credenciales });
    await c.obtenerMedia("M");
    expect((llamadas[0]!.init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer TOKEN_ENV",
    );
    expect(llamadas[0]!.url).toBe(`${BASE}/v26.0/M?phone_number_id=PHONE_ENV`);
  });

  test("un id raro no arma una ruta rara", async () => {
    const { fn } = fakeFetch([]);
    const c = new GraphApiMediaClient({ ...CFG, fetchImpl: fn });
    await expect(c.obtenerMedia("../../me?fields=x")).rejects.toBeInstanceOf(ValidationError);
  });

  test("la respuesta sin url es un error de validacion, no un reintento", async () => {
    const { fn } = fakeFetch([json({ id: "M" })]);
    const c = new GraphApiMediaClient({ ...CFG, fetchImpl: fn });
    await expect(c.obtenerMedia("M")).rejects.toBeInstanceOf(ValidationError);
  });

  test("id vencido o inexistente (400) no se reintenta; 500 si", async () => {
    const vencido = new GraphApiMediaClient({
      ...CFG,
      fetchImpl: fakeFetch([
        json({ error: { message: "Unsupported get request", code: 100 } }, 400),
      ]).fn,
    });
    await expect(vencido.obtenerMedia("M")).rejects.toBeInstanceOf(ValidationError);
    const caido = new GraphApiMediaClient({
      ...CFG,
      fetchImpl: fakeFetch([json({}, 503)]).fn,
    });
    await expect(caido.obtenerMedia("M")).rejects.toBeInstanceOf(InfraError);
  });

  test("sin red es InfraError", async () => {
    const c = new GraphApiMediaClient({
      ...CFG,
      fetchImpl: fakeFetch([new TypeError("fetch failed")]).fn,
    });
    await expect(c.obtenerMedia("M")).rejects.toBeInstanceOf(InfraError);
  });
});

describe("GraphApiMediaClient.descargar", () => {
  const URL_OK = "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1";

  test("baja con el Bearer del numero y devuelve los bytes", async () => {
    const { fn, llamadas } = fakeFetch([new Response(new Uint8Array([1, 2, 3]), { status: 200 })]);
    const c = new GraphApiMediaClient({ ...CFG, fetchImpl: fn, credenciales });
    const bytes = await c.descargar(URL_OK, { desde: "PHONE_COEX", maxBytes: 100 });
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(llamadas[0]!.url).toBe(URL_OK);
    expect((llamadas[0]!.init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer TOKEN_COEX",
    );
  });

  test("404: la URL vencio, se pide una nueva (NotFoundError)", async () => {
    const c = new GraphApiMediaClient({
      ...CFG,
      fetchImpl: fakeFetch([new Response("", { status: 404 })]).fn,
    });
    await expect(c.descargar(URL_OK, { maxBytes: 100 })).rejects.toBeInstanceOf(NotFoundError);
  });

  test("500 es reintentable", async () => {
    const c = new GraphApiMediaClient({
      ...CFG,
      fetchImpl: fakeFetch([new Response("", { status: 500 })]).fn,
    });
    await expect(c.descargar(URL_OK, { maxBytes: 100 })).rejects.toBeInstanceOf(InfraError);
  });

  test("corta al pasar el tope, por content-length o leyendo", async () => {
    const porHeader = new GraphApiMediaClient({
      ...CFG,
      fetchImpl: fakeFetch([
        new Response(new Uint8Array(10), { status: 200, headers: { "content-length": "999999" } }),
      ]).fn,
    });
    await expect(porHeader.descargar(URL_OK, { maxBytes: 100 })).rejects.toBeInstanceOf(
      MediaDemasiadoGrande,
    );
    const porLectura = new GraphApiMediaClient({
      ...CFG,
      fetchImpl: fakeFetch([new Response(new Uint8Array(500), { status: 200 })]).fn,
    });
    await expect(porLectura.descargar(URL_OK, { maxBytes: 100 })).rejects.toBeInstanceOf(
      MediaDemasiadoGrande,
    );
  });

  test("no manda el token a un host que no es de Meta ni a http", async () => {
    for (const url of [
      "https://evil.example.com/robo",
      "http://lookaside.fbsbx.com/x",
      "https://lookaside.fbsbx.com.evil.com/x",
      "ftp://lookaside.fbsbx.com/x",
      "no es una url",
    ]) {
      const { fn, llamadas } = fakeFetch([new Response("x")]);
      const c = new GraphApiMediaClient({ ...CFG, fetchImpl: fn });
      await expect(c.descargar(url, { maxBytes: 100 }), url).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect(llamadas, url).toHaveLength(0);
    }
  });

  test("una redireccion a un host de Meta se sigue; a cualquier otro no", async () => {
    const destino = "https://scontent.xx.fbcdn.net/v/archivo";
    const buena = fakeFetch([
      new Response("", { status: 302, headers: { location: destino } }),
      new Response(new Uint8Array([7]), { status: 200 }),
    ]);
    const c = new GraphApiMediaClient({ ...CFG, fetchImpl: buena.fn });
    expect([...(await c.descargar(URL_OK, { maxBytes: 100 }))]).toEqual([7]);
    expect(buena.llamadas.map((l) => l.url)).toEqual([URL_OK, destino]);
    // El redirect lo maneja el codigo, no fetch: asi se valida cada salto.
    expect(buena.llamadas[0]!.init.redirect).toBe("manual");

    const mala = fakeFetch([
      new Response("", { status: 302, headers: { location: "https://evil.example.com/x" } }),
    ]);
    const c2 = new GraphApiMediaClient({ ...CFG, fetchImpl: mala.fn });
    await expect(c2.descargar(URL_OK, { maxBytes: 100 })).rejects.toBeInstanceOf(ValidationError);
    expect(mala.llamadas).toHaveLength(1);
  });

  test("un bucle de redirecciones se corta", async () => {
    const salto = () => new Response("", { status: 302, headers: { location: URL_OK } });
    const c = new GraphApiMediaClient({
      ...CFG,
      fetchImpl: fakeFetch([salto(), salto(), salto(), salto(), salto()]).fn,
    });
    await expect(c.descargar(URL_OK, { maxBytes: 100 })).rejects.toBeInstanceOf(ValidationError);
  });

  test("acepta el origen de baseUrl (el mock local) aunque no sea de Meta", async () => {
    const { fn } = fakeFetch([new Response(new Uint8Array([9]), { status: 200 })]);
    const c = new GraphApiMediaClient({ ...CFG, baseUrl: "http://127.0.0.1:55390", fetchImpl: fn });
    const bytes = await c.descargar("http://127.0.0.1:55390/__mock/media/abc", { maxBytes: 100 });
    expect([...bytes]).toEqual([9]);
  });
});

describe("GraphApiMediaClient.subir", () => {
  test("POST multipart a /{phone}/media con messaging_product, type y file", async () => {
    const { fn, llamadas } = fakeFetch([json({ id: "MEDIA_SUBIDA" })]);
    const c = new GraphApiMediaClient({ ...CFG, fetchImpl: fn, credenciales });
    const r = await c.subir({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "application/pdf",
      nombre: "lista.pdf",
      desde: "PHONE_COEX",
    });
    expect(r).toEqual({ id: "MEDIA_SUBIDA" });
    expect(llamadas[0]!.url).toBe(`${BASE}/v26.0/PHONE_COEX/media`);
    const init = llamadas[0]!.init;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer TOKEN_COEX");
    // El Content-Type con el boundary lo pone fetch; si lo ponemos a mano, se rompe.
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    const form = init.body as FormData;
    expect(form.get("messaging_product")).toBe("whatsapp");
    expect(form.get("type")).toBe("application/pdf");
    const archivo = form.get("file") as File;
    expect(archivo.type).toBe("application/pdf");
    expect(archivo.name).toBe("lista.pdf");
    expect(archivo.size).toBe(3);
  });

  test("Meta rechaza el archivo (400): ValidationError con el motivo", async () => {
    const c = new GraphApiMediaClient({
      ...CFG,
      fetchImpl: fakeFetch([
        json(
          {
            error: {
              message: "Param file must be a file with one of the following types",
              code: 100,
            },
          },
          400,
        ),
      ]).fn,
    });
    await expect(
      c.subir({ bytes: new Uint8Array([1]), mime: "image/png", nombre: "a.png" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("respuesta sin id es un error, no un exito", async () => {
    const c = new GraphApiMediaClient({ ...CFG, fetchImpl: fakeFetch([json({})]).fn });
    await expect(
      c.subir({ bytes: new Uint8Array([1]), mime: "image/png", nombre: "a.png" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
