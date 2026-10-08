import { describe, expect, it, vi } from "vitest";
import { parsearPagina } from "@/lib/catalogo/bodega-contrato";
import {
  InfraError,
  IllegalStateError,
  PermissionDeniedError,
  RateLimitError,
  ValidationError,
  isNonRetriable,
} from "@/lib/errors";
import {
  BodegaTimeoutError,
  HttpBodegaCatalogoClient,
} from "@/server/services/catalog/bodega/bodega-client";

const URL_BODEGA = "https://bodega.example.test";
const ANON = "anon-key-de-prueba";
const CLAVE = "clave-de-lectura-de-prueba-0123456789abcdef";

const json = (cuerpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json" },
  });

function cliente(fetchImpl: typeof fetch) {
  return new HttpBodegaCatalogoClient({
    url: URL_BODEGA,
    anonKey: ANON,
    clave: CLAVE,
    fetchImpl,
  });
}

const respuestaMarcas = {
  tabla: "marcas",
  filas: [
    {
      id: "6b0c9a2e-0000-4000-8000-000000000001",
      nombre: "MOBIS",
      tipo: "producto",
      procedencia: "ORIGINAL",
      activa: true,
      alias: ["HYUNDAI MOBIS"],
      creada_en: "2026-01-01T00:00:00+00:00",
      actualizada_en: "2026-10-07T15:04:05.123456+00:00",
      campo_nuevo_que_no_conocemos: "x",
    },
  ],
  cursor: { desde: "2026-10-07T15:04:05.123456Z", despues: "6b0c9a2e" },
  siguiente: null,
  hasta: "2026-10-07T15:09:00.000000Z",
};

describe("HttpBodegaCatalogoClient: el pedido", () => {
  it("hace un POST a la RPC con apikey, Authorization y el cuerpo del contrato", async () => {
    const fetchImpl = vi.fn(async () => json(respuestaMarcas));
    await cliente(fetchImpl as unknown as typeof fetch).cambios("marcas", {
      cursor: { desde: "-infinity", despues: null },
      limite: 1000,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL_BODEGA}/rest/v1/rpc/crm_catalogo_cambios`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["apikey"]).toBe(ANON);
    expect(headers["Authorization"]).toBe(`Bearer ${ANON}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      p_clave: CLAVE,
      p_tabla: "marcas",
      p_desde: "-infinity",
      p_despues: null,
      p_limite: 1000,
    });
  });

  it("la clave de lectura va en el cuerpo, nunca en la URL", async () => {
    const fetchImpl = vi.fn(async () => json(respuestaMarcas));
    await cliente(fetchImpl as unknown as typeof fetch).cambios("marcas", {
      cursor: { desde: "-infinity", despues: null },
      limite: 10,
    });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).not.toContain(CLAVE);
    expect(url).not.toContain(ANON);
  });

  it("manda el cursor tal cual, con los microsegundos (sin pasar por Date)", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ ...respuestaMarcas, tabla: "variantes", filas: [] }),
    );
    await cliente(fetchImpl as unknown as typeof fetch).cambios("variantes", {
      cursor: { desde: "2026-10-07T15:04:05.123456Z", despues: "10234" },
      limite: 500,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const cuerpo = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(cuerpo["p_desde"]).toBe("2026-10-07T15:04:05.123456Z");
    expect(cuerpo["p_despues"]).toBe("10234");
  });

  it("rechaza un http remoto: la clave viajaría en claro", () => {
    expect(
      () =>
        new HttpBodegaCatalogoClient({
          url: "http://bodega.example.test",
          anonKey: ANON,
          clave: CLAVE,
        }),
    ).toThrow(ValidationError);
  });

  it("acepta http en loopback (stub local de las pruebas)", () => {
    expect(
      () =>
        new HttpBodegaCatalogoClient({ url: "http://127.0.0.1:9999", anonKey: ANON, clave: CLAVE }),
    ).not.toThrow();
  });
});

describe("HttpBodegaCatalogoClient: la respuesta", () => {
  it("devuelve las filas validadas, el cursor y descarta campos que no conoce", async () => {
    const fetchImpl = vi.fn(async () => json(respuestaMarcas));
    const pagina = await cliente(fetchImpl as unknown as typeof fetch).cambios("marcas", {
      cursor: { desde: "-infinity", despues: null },
      limite: 1000,
    });
    expect(pagina.filas).toEqual([
      {
        nombre: "MOBIS",
        tipo: "producto",
        procedencia: "ORIGINAL",
        activa: true,
        alias: ["HYUNDAI MOBIS"],
        actualizada_en: "2026-10-07T15:04:05.123456+00:00",
      },
    ]);
    expect(pagina.cursor).toEqual({ desde: "2026-10-07T15:04:05.123456Z", despues: "6b0c9a2e" });
    expect(pagina.siguiente).toBeNull();
  });

  it("conserva los microsegundos del cursor como texto", () => {
    const pagina = parsearPagina("existencias", {
      tabla: "existencias",
      filas: [],
      cursor: { desde: "2026-10-07T15:04:05.123456Z", despues: "10234" },
      siguiente: { desde: "2026-10-07T15:04:05.123456Z", despues: "10234" },
      hasta: "x",
    });
    expect(pagina.cursor.desde).toBe("2026-10-07T15:04:05.123456Z");
    expect(pagina.siguiente?.desde).toBe("2026-10-07T15:04:05.123456Z");
  });

  it("rechaza una respuesta de otra tabla que la pedida", async () => {
    const fetchImpl = vi.fn(async () => json(respuestaMarcas));
    await expect(
      cliente(fetchImpl as unknown as typeof fetch).cambios("existencias", {
        cursor: { desde: "-infinity", despues: null },
        limite: 10,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rechaza una fila que no cumple el contrato", async () => {
    const mala = { ...respuestaMarcas, filas: [{ nombre: "MOBIS" }] };
    const fetchImpl = vi.fn(async () => json(mala));
    await expect(
      cliente(fetchImpl as unknown as typeof fetch).cambios("marcas", {
        cursor: { desde: "-infinity", despues: null },
        limite: 10,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("una respuesta que no es JSON es un error no reintentable por forma", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>", { status: 200 }));
    await expect(
      cliente(fetchImpl as unknown as typeof fetch).cambios("marcas", {
        cursor: { desde: "-infinity", despues: null },
        limite: 10,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("HttpBodegaCatalogoClient: los errores, por `code` y no por status HTTP", () => {
  async function fallo(status: number, cuerpo: unknown): Promise<unknown> {
    const fetchImpl = vi.fn(async () => json(cuerpo, status));
    return cliente(fetchImpl as unknown as typeof fetch)
      .cambios("marcas", { cursor: { desde: "-infinity", despues: null }, limite: 10 })
      .then(
        () => {
          throw new Error("tenía que fallar");
        },
        (e: unknown) => e,
      );
  }

  it("42501 (clave incorrecta) es PermissionDenied y no se reintenta", async () => {
    const e = await fallo(403, { code: "42501", message: "clave invalida" });
    expect(e).toBeInstanceOf(PermissionDeniedError);
    expect(isNonRetriable(e)).toBe(true);
  });

  it("22023 y 54000 son errores del CRM: ValidationError no reintentable", async () => {
    for (const code of ["22023", "54000"]) {
      const e = await fallo(400, { code, message: "x" });
      expect(e).toBeInstanceOf(ValidationError);
      expect(isNonRetriable(e)).toBe(true);
    }
  });

  it("PGRST202 (la función no existe) no se reintenta", async () => {
    const e = await fallo(404, { code: "PGRST202", message: "no existe" });
    expect(e).toBeInstanceOf(IllegalStateError);
    expect(isNonRetriable(e)).toBe(true);
  });

  it("57014 (timeout de 3 s) es BodegaTimeoutError: reintentable con menos límite", async () => {
    const e = await fallo(500, { code: "57014", message: "canceling statement" });
    expect(e).toBeInstanceOf(BodegaTimeoutError);
    expect(e).toBeInstanceOf(InfraError);
    expect(isNonRetriable(e)).toBe(false);
  });

  it("un 5xx sin code conocido es InfraError reintentable", async () => {
    const e = await fallo(503, { message: "upstream" });
    expect(e).toBeInstanceOf(InfraError);
    expect(isNonRetriable(e)).toBe(false);
  });

  it("un 429 es RateLimitError", async () => {
    const e = await fallo(429, { message: "slow down" });
    expect(e).toBeInstanceOf(RateLimitError);
  });

  it("un 401/403 sin code (anon key mala) es PermissionDenied", async () => {
    expect(await fallo(401, { message: "Invalid API key" })).toBeInstanceOf(PermissionDeniedError);
  });

  it("un error de red es InfraError reintentable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const e = await cliente(fetchImpl as unknown as typeof fetch)
      .cambios("marcas", { cursor: { desde: "-infinity", despues: null }, limite: 10 })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(InfraError);
    expect(isNonRetriable(e)).toBe(false);
  });

  it("un corte por tiempo de espera es InfraError reintentable", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("timeout");
      err.name = "TimeoutError";
      throw err;
    });
    const e = await cliente(fetchImpl as unknown as typeof fetch)
      .cambios("marcas", { cursor: { desde: "-infinity", despues: null }, limite: 10 })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(InfraError);
  });

  it("el mensaje de un error nunca repite la clave ni la anon key", async () => {
    const e = (await fallo(400, {
      code: "22023",
      message: `p_clave ${CLAVE} con apikey ${ANON} mal`,
    })) as Error;
    expect(e.message).not.toContain(CLAVE);
    expect(e.message).not.toContain(ANON);
  });
});
