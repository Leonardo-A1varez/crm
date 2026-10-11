import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { IllegalStateError, PermissionDeniedError, ValidationError } from "@/lib/errors";
import { descifrarToken, llaveroDesdeEnv, type LlaveroTokens } from "@/lib/meta/token-cifrado";
import { InMemoryWhatsAppNumerosRepository } from "@/server/repositories/whatsapp-numeros.repo";
import { DefaultConectarWhatsAppService } from "@/server/services/meta/conectar-whatsapp.service";
import type { GraphApiOnboarding } from "@/server/services/meta/graph-api-onboarding";

const WABA = "102290129340398";
const PHONE = "106540352242922";

function graphFalso() {
  return {
    canjearCodigo: vi.fn(async () => "EAAG-NEGOCIO"),
    numerosDeWaba: vi.fn<GraphApiOnboarding["numerosDeWaba"]>(async () => [
      { id: PHONE, display_phone_number: "+1 555-078-3881", verified_name: "Lucky Shrub" },
    ]),
    leerNumero: vi.fn(),
    suscribirApp: vi.fn(async () => undefined),
    pedirSincronizacion: vi.fn(),
  } satisfies GraphApiOnboarding;
}

let graph: ReturnType<typeof graphFalso>;
let numeros: InMemoryWhatsAppNumerosRepository;
let llavero: LlaveroTokens;
let emitidos: Array<{ phoneNumberId: string; conectadoAt: string }>;
let svc: DefaultConectarWhatsAppService;

beforeEach(() => {
  graph = graphFalso();
  numeros = new InMemoryWhatsAppNumerosRepository();
  llavero = llaveroDesdeEnv({ META_TOKENS_CLAVE: randomBytes(32).toString("base64") });
  emitidos = [];
  svc = new DefaultConectarWhatsAppService({
    graph,
    numeros,
    llavero: () => llavero,
    emitirConectado: async (e) => {
      emitidos.push(e);
    },
  });
});

const ENTRADA = {
  code: "codigo-del-popup",
  wabaId: WABA,
  phoneNumberId: null,
  evento: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" as const,
};

describe("ConectarWhatsAppService.conectar", () => {
  test("canjea el código, valida el número contra la WABA, suscribe la app, guarda cifrado y avisa", async () => {
    const r = await svc.conectar(ENTRADA);

    expect(r).toEqual({
      phoneNumberId: PHONE,
      displayPhoneNumber: "+1 555-078-3881",
      verifiedName: "Lucky Shrub",
      modo: "coexistencia",
    });
    expect(graph.canjearCodigo).toHaveBeenCalledWith("codigo-del-popup");
    expect(graph.numerosDeWaba).toHaveBeenCalledWith(WABA, "EAAG-NEGOCIO");
    expect(graph.suscribirApp).toHaveBeenCalledWith(WABA, "EAAG-NEGOCIO");

    const cifrado = numeros.tokens.get(PHONE)!;
    expect(cifrado).not.toContain("EAAG");
    expect(descifrarToken(cifrado, PHONE, llavero)).toBe("EAAG-NEGOCIO");
    expect((await numeros.buscar(PHONE))?.modo).toBe("coexistencia");
    expect(emitidos).toHaveLength(1);
    expect(emitidos[0]!.phoneNumberId).toBe(PHONE);
  });

  test("el evento FINISH (número nuevo de Cloud API) queda en modo cloud", async () => {
    const r = await svc.conectar({ ...ENTRADA, evento: "FINISH", phoneNumberId: PHONE });
    expect(r.modo).toBe("cloud");
  });

  test("un phone_number_id que no es de esa WABA se rechaza y no se guarda nada", async () => {
    await expect(svc.conectar({ ...ENTRADA, phoneNumberId: "999" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await numeros.listar()).toHaveLength(0);
    expect(graph.suscribirApp).not.toHaveBeenCalled();
    expect(emitidos).toHaveLength(0);
  });

  test("WABA con varios números y sin phone_number_id: pide elegir, no adivina", async () => {
    graph.numerosDeWaba.mockResolvedValueOnce([
      { id: "1", display_phone_number: null, verified_name: null },
      { id: "2", display_phone_number: null, verified_name: null },
    ]);
    await expect(svc.conectar(ENTRADA)).rejects.toBeInstanceOf(ValidationError);
    expect(await numeros.listar()).toHaveLength(0);
  });

  test("sin META_TOKENS_CLAVE falla ANTES de gastar el código (vive 30 s)", async () => {
    const sinClave = new DefaultConectarWhatsAppService({
      graph,
      numeros,
      llavero: () => llaveroDesdeEnv({}),
      emitirConectado: async () => undefined,
    });
    await expect(sinClave.conectar(ENTRADA)).rejects.toBeInstanceOf(IllegalStateError);
    expect(graph.canjearCodigo).not.toHaveBeenCalled();
  });

  test("si falla la suscripción de la app no queda un número a medias", async () => {
    graph.suscribirApp.mockRejectedValueOnce(new ValidationError("Meta auth error"));
    await expect(svc.conectar(ENTRADA)).rejects.toBeInstanceOf(ValidationError);
    expect(await numeros.listar()).toHaveLength(0);
  });

  test("un no-admin no conecta: lo frena el RPC", async () => {
    numeros.esAdmin = false;
    await expect(svc.conectar(ENTRADA)).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(emitidos).toHaveLength(0);
  });

  test("el token nunca aparece en el resultado ni en los errores", async () => {
    graph.numerosDeWaba.mockRejectedValueOnce(
      new ValidationError("Meta invalid request (x): boom"),
    );
    const err: unknown = await svc.conectar(ENTRADA).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).not.toContain("EAAG-NEGOCIO");
    const ok = await svc.conectar(ENTRADA);
    expect(JSON.stringify(ok)).not.toContain("EAAG-NEGOCIO");
  });
});
