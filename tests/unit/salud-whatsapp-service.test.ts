// @vitest-environment node
import { describe, expect, test } from "vitest";
import { InfraError, PermissionDeniedError } from "@/lib/errors";
import { NoopLogger, type LogContext, type Logger } from "@/lib/observability/logger";
import { DefaultSaludWhatsAppService } from "@/server/services/meta/salud-whatsapp.service";
import type {
  MetaLecturaClient,
  NumeroCrudo,
  PlantillaCruda,
  SaludCruda,
} from "@/server/services/meta/graph-api-lectura";

/** Fixtures sintéticos: ningún id ni número corresponde a un activo real de Meta. */
const CONFIGURADO = "101";
const WABA = "202";

const NUMERO_CONFIGURADO: NumeroCrudo = {
  id: CONFIGURADO,
  display_phone_number: "+1 555 0100",
  verified_name: "Repuestos Uno",
  quality_rating: "GREEN",
};

const OTRO_NUMERO: NumeroCrudo = {
  id: "102",
  display_phone_number: "+1 555 0101",
  verified_name: "Repuestos Dos",
  quality_rating: "YELLOW",
};

const PLANTILLA: PlantillaCruda = {
  id: "9",
  name: "plantilla_de_prueba",
  language: "es",
  category: "UTILITY",
  status: "APPROVED",
  rejected_reason: null,
  quality_score: "GREEN",
  header_text: null,
  body_text: "Hola {{1}}",
  footer_text: null,
  quick_replies: [],
};

function saludConWaba(): SaludCruda {
  return {
    can_send_message: "AVAILABLE",
    entities: [
      {
        entity_type: "PHONE_NUMBER",
        id: CONFIGURADO,
        can_send_message: "AVAILABLE",
        additional_info: [],
        errors: [],
      },
      {
        entity_type: "WABA",
        id: WABA,
        can_send_message: "AVAILABLE",
        additional_info: [],
        errors: [],
      },
    ],
  };
}

type Respuesta<T> = T | Error;

function resolver<T>(r: Respuesta<T>): T {
  if (r instanceof Error) throw r;
  return r;
}

class FakeLectura implements MetaLecturaClient {
  numero: Respuesta<NumeroCrudo> = NUMERO_CONFIGURADO;
  limite: Respuesta<string | null> = "TIER_2000";
  salud: Respuesta<SaludCruda> = saludConWaba();
  numeros: Respuesta<{ numeros: NumeroCrudo[]; hayMas: boolean }> = {
    numeros: [NUMERO_CONFIGURADO, OTRO_NUMERO],
    hayMas: false,
  };
  plantillas: Respuesta<{ plantillas: PlantillaCruda[]; hayMas: boolean }> = {
    plantillas: [PLANTILLA],
    hayMas: false,
  };
  readonly pedidos: string[] = [];

  async leerNumero(id: string): Promise<NumeroCrudo> {
    this.pedidos.push(`numero:${id}`);
    return resolver(this.numero);
  }

  async leerLimiteDeMensajeria(id: string): Promise<string | null> {
    this.pedidos.push(`limite:${id}`);
    return resolver(this.limite);
  }

  async leerSalud(id: string): Promise<SaludCruda> {
    this.pedidos.push(`salud:${id}`);
    return resolver(this.salud);
  }

  async listarNumeros(waba: string): Promise<{ numeros: NumeroCrudo[]; hayMas: boolean }> {
    this.pedidos.push(`numeros:${waba}`);
    return resolver(this.numeros);
  }

  async listarPlantillas(
    waba: string,
    limite: number,
  ): Promise<{ plantillas: PlantillaCruda[]; hayMas: boolean }> {
    this.pedidos.push(`plantillas:${waba}:${limite}`);
    return resolver(this.plantillas);
  }
}

class LoggerQueAnota implements Logger {
  readonly avisos: Array<{ msg: string; ctx?: LogContext }> = [];
  debug(): void {}
  info(): void {}
  warn(msg: string, ctx?: LogContext): void {
    this.avisos.push({ msg, ctx });
  }
  error(msg: string, ctx?: LogContext): void {
    this.avisos.push({ msg, ctx });
  }
  child(): Logger {
    return this;
  }
}

const AHORA = new Date("2026-09-13T12:00:00Z");

function servicio(cliente: MetaLecturaClient, logger: Logger = new NoopLogger()) {
  return new DefaultSaludWhatsAppService({
    cliente,
    phoneNumberId: CONFIGURADO,
    versionApi: "v21.0",
    logger,
    ahora: () => AHORA,
  });
}

describe("DefaultSaludWhatsAppService", () => {
  test("con todo respondiendo, lista los números de la WABA y marca el que usa el CRM", async () => {
    const salud = await servicio(new FakeLectura()).leer();

    expect(salud.numeros).toEqual({
      estado: "ok",
      valor: {
        numeros: [
          {
            id: "101",
            numero: "+1 555 0100",
            nombreVerificado: "Repuestos Uno",
            calidad: "GREEN",
            esElConfigurado: true,
          },
          {
            id: "102",
            numero: "+1 555 0101",
            nombreVerificado: "Repuestos Dos",
            calidad: "YELLOW",
            esElConfigurado: false,
          },
        ],
        hayMas: false,
        motivoParcial: null,
      },
    });
  });

  test("busca números y plantillas en la WABA que nombra health_status", async () => {
    const cliente = new FakeLectura();

    await servicio(cliente).leer();

    expect(cliente.pedidos).toContain(`numeros:${WABA}`);
    expect(cliente.pedidos).toContain(`plantillas:${WABA}:100`);
  });

  test("pasa las plantillas y avisa si Meta tiene más de las que se pidieron", async () => {
    const cliente = new FakeLectura();
    cliente.plantillas = { plantillas: [PLANTILLA], hayMas: true };

    const salud = await servicio(cliente).leer();

    expect(salud.plantillas).toEqual({
      estado: "ok",
      valor: {
        plantillas: [
          {
            id: "9",
            nombre: "plantilla_de_prueba",
            idioma: "es",
            categoria: "UTILITY",
            estado: "APPROVED",
            motivoRechazo: null,
            calidad: "GREEN",
            encabezado: null,
            cuerpo: "Hola {{1}}",
            pie: null,
            respuestasRapidas: [],
          },
        ],
        hayMas: true,
        limite: 100,
      },
    });
  });

  test.each([
    ["TIER_250", 250],
    ["TIER_2000", 2000],
    ["TIER_2K", 2000],
    ["TIER_10K", 10000],
    ["TIER_100000", 100000],
    ["TIER_UNLIMITED", "ilimitado"],
    ["TIER_NOT_SET", null],
  ] as const)("interpreta el escalón %s", async (crudo, destinatarios) => {
    const cliente = new FakeLectura();
    cliente.limite = crudo;

    const salud = await servicio(cliente).leer();

    expect(salud.limite).toEqual({ estado: "ok", valor: { crudo, destinatarios } });
  });

  test("si Meta no manda el escalón, lo dice en vez de suponer uno", async () => {
    const cliente = new FakeLectura();
    cliente.limite = null;

    const salud = await servicio(cliente).leer();

    expect(salud.limite.estado).toBe("no-expuesto");
  });

  test("el uso del límite y el escalón de sanciones salen como no expuestos, con motivo", async () => {
    const salud = await servicio(new FakeLectura()).leer();

    expect(salud.usoDelLimite.estado).toBe("no-expuesto");
    expect(salud.sancion.estado).toBe("no-expuesto");
    if (salud.sancion.estado === "no-expuesto") {
      expect(salud.sancion.motivo).toContain("account_update");
    }
  });

  test("devuelve el estado de envío con cada entidad", async () => {
    const salud = await servicio(new FakeLectura()).leer();

    expect(salud.estadoDeEnvio).toEqual({
      estado: "ok",
      valor: {
        puedeEnviar: "AVAILABLE",
        entidades: [
          {
            tipo: "PHONE_NUMBER",
            id: "101",
            puedeEnviar: "AVAILABLE",
            errores: [],
            infoAdicional: [],
          },
          { tipo: "WABA", id: "202", puedeEnviar: "AVAILABLE", errores: [], infoAdicional: [] },
        ],
      },
    });
  });

  test("traduce los errores de una entidad bloqueada", async () => {
    const cliente = new FakeLectura();
    cliente.salud = {
      can_send_message: "BLOCKED",
      entities: [
        {
          entity_type: "WABA",
          id: WABA,
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
      ],
    };

    const salud = await servicio(cliente).leer();

    expect(salud.estadoDeEnvio).toEqual({
      estado: "ok",
      valor: {
        puedeEnviar: "BLOCKED",
        entidades: [
          {
            tipo: "WABA",
            id: "202",
            puedeEnviar: "BLOCKED",
            errores: [
              { codigo: 1, descripcion: "descripción de prueba", solucion: "solución de prueba" },
            ],
            infoAdicional: [],
          },
        ],
      },
    });
  });

  test("si falla health_status, las plantillas quedan en error y los números caen al configurado", async () => {
    const cliente = new FakeLectura();
    cliente.salud = new InfraError("Meta salud sin respuesta: fetch failed", "meta");

    const salud = await servicio(cliente).leer();

    expect(salud.estadoDeEnvio).toEqual({
      estado: "error",
      mensaje: "Meta salud sin respuesta: fetch failed",
    });
    expect(salud.plantillas.estado).toBe("error");
    expect(salud.numeros).toMatchObject({
      estado: "ok",
      valor: { numeros: [{ id: "101", esElConfigurado: true }], hayMas: false },
    });
    if (salud.numeros.estado === "ok") {
      expect(salud.numeros.valor.motivoParcial).not.toBeNull();
    }
    expect(cliente.pedidos.some((p) => p.startsWith("plantillas:"))).toBe(false);
  });

  test("si health_status no nombra la WABA, las plantillas quedan como no expuestas", async () => {
    const cliente = new FakeLectura();
    cliente.salud = {
      can_send_message: "AVAILABLE",
      entities: [
        {
          entity_type: "PHONE_NUMBER",
          id: CONFIGURADO,
          can_send_message: "AVAILABLE",
          additional_info: [],
          errors: [],
        },
      ],
    };

    const salud = await servicio(cliente).leer();

    expect(salud.plantillas.estado).toBe("no-expuesto");
    expect(cliente.pedidos.some((p) => p.startsWith("plantillas:"))).toBe(false);
  });

  test("si falla la lista de la WABA, muestra el número configurado y dice por qué", async () => {
    const cliente = new FakeLectura();
    cliente.numeros = new PermissionDeniedError("Meta rechazó el token (numeros): sin permiso");

    const salud = await servicio(cliente).leer();

    expect(salud.numeros).toMatchObject({ estado: "ok", valor: { numeros: [{ id: "101" }] } });
    if (salud.numeros.estado === "ok") {
      expect(salud.numeros.valor.motivoParcial).toContain("sin permiso");
    }
  });

  test("una lectura que falla no arrastra a las demás", async () => {
    const cliente = new FakeLectura();
    cliente.limite = new InfraError("Meta limite HTTP 500: falla de prueba", "meta");

    const salud = await servicio(cliente).leer();

    expect(salud.limite).toEqual({
      estado: "error",
      mensaje: "Meta limite HTTP 500: falla de prueba",
    });
    expect(salud.numeros.estado).toBe("ok");
    expect(salud.plantillas.estado).toBe("ok");
    expect(salud.estadoDeEnvio.estado).toBe("ok");
  });

  test("si falla todo, devuelve errores legibles en vez de lanzar", async () => {
    const cliente = new FakeLectura();
    const caida = new InfraError("Meta sin respuesta: fetch failed", "meta");
    cliente.numero = caida;
    cliente.limite = caida;
    cliente.salud = caida;

    const salud = await servicio(cliente).leer();

    expect(salud.numeros).toEqual({ estado: "error", mensaje: "Meta sin respuesta: fetch failed" });
    expect(salud.limite.estado).toBe("error");
    expect(salud.estadoDeEnvio.estado).toBe("error");
    expect(salud.plantillas.estado).toBe("error");
  });

  test("un error que no es de dominio igual llega legible", async () => {
    const cliente = new FakeLectura();
    cliente.limite = new TypeError("algo inesperado");

    const salud = await servicio(cliente).leer();

    expect(salud.limite).toEqual({ estado: "error", mensaje: "algo inesperado" });
  });

  test("anota cada falla con la operación que la produjo", async () => {
    const cliente = new FakeLectura();
    cliente.limite = new InfraError("Meta limite HTTP 500: falla de prueba", "meta");
    const logger = new LoggerQueAnota();

    await servicio(cliente, logger).leer();

    expect(logger.avisos).toHaveLength(1);
    expect(logger.avisos[0]?.ctx).toMatchObject({ operacion: "limite", tipo: "InfraError" });
  });

  test("sella la consulta con el reloj y la versión de la API", async () => {
    const salud = await servicio(new FakeLectura()).leer();

    expect(salud.consultadoAt).toEqual(AHORA);
    expect(salud.versionApi).toBe("v21.0");
  });
});
