import { describe, expect, it, vi } from "vitest";
import {
  claveDeCursores,
  claveDePagina,
  makeSincronizarBodegaFn,
  sincronizarBodegaHandler,
} from "@/inngest/functions/sincronizar-bodega.cron";
import type { CursorBodega, TablaBodega } from "@/lib/catalogo/bodega-contrato";
import type { Logger } from "@/lib/observability/logger";
import type {
  ResultadoPagina,
  SincronizarBodegaService,
} from "@/server/services/catalog/bodega/sincronizar-bodega.service";

const TS = Date.UTC(2026, 9, 8, 14, 7, 31);
const INICIO: CursorBodega = { desde: "-infinity", despues: null };
const cur = (n: number): CursorBodega => ({
  desde: `2026-10-07T15:04:05.12345${n}Z`,
  despues: String(n),
});

/** Un step.run que recuerda por nombre, como hace Inngest al reintentar una corrida. */
function pasoConMemoria() {
  const memoria = new Map<string, unknown>();
  return {
    memoria,
    run: async <T>(nombre: string, fn: () => Promise<T>): Promise<T> => {
      if (memoria.has(nombre)) return memoria.get(nombre) as T;
      const valor = await fn();
      memoria.set(nombre, valor);
      return valor;
    },
  };
}

function loggerEspia() {
  const l = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => l,
  };
  return l as unknown as Logger & typeof l;
}

/** Un servicio con N páginas llenas por tabla y la última corta. */
function servicioConPaginas(paginasPorTabla: Partial<Record<TablaBodega, number>>) {
  const llamadas: { tabla: TablaBodega; cursor: CursorBodega }[] = [];
  const servicio: SincronizarBodegaService = {
    leerCursores: vi.fn(async () => ({
      marcas: INICIO,
      existencias: INICIO,
      variantes: INICIO,
      bajas: INICIO,
    })),
    sincronizarPagina: vi.fn(
      async (tabla: TablaBodega, cursor: CursorBodega): Promise<ResultadoPagina> => {
        llamadas.push({ tabla, cursor });
        const hechas = llamadas.filter((l) => l.tabla === tabla).length;
        const total = paginasPorTabla[tabla] ?? 1;
        const nuevo = cur(hechas);
        return {
          filas: 10,
          aplicadas: 10,
          cursor: nuevo,
          siguiente: hechas < total ? nuevo : null,
        };
      },
    ),
  };
  return { servicio, llamadas };
}

describe("claves de idempotencia", () => {
  it("la de los cursores lleva función, día y ventana de 5 minutos", () => {
    expect(claveDeCursores(new Date(TS))).toBe("sincronizar-bodega-2026-10-08-1405-cursores");
  });

  it("la de una página incluye la tabla y la posición exacta, con los microsegundos", () => {
    const c = { desde: "2026-10-07T15:04:05.123456Z", despues: "10234" };
    expect(claveDePagina(new Date(TS), "variantes", c)).toBe(
      "sincronizar-bodega-2026-10-08-1405-variantes-2026-10-07T15:04:05.123456Z~10234",
    );
    expect(claveDePagina(new Date(TS), "bajas", INICIO)).toBe(
      "sincronizar-bodega-2026-10-08-1405-bajas--infinity~",
    );
  });

  it("dos posiciones distintas nunca comparten clave", () => {
    const a = claveDePagina(new Date(TS), "marcas", { desde: "x", despues: null });
    const b = claveDePagina(new Date(TS), "marcas", { desde: "x", despues: "1" });
    const c = claveDePagina(new Date(TS), "existencias", { desde: "x", despues: null });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("sincronizarBodegaHandler", () => {
  it("sin configuración no hace nada, sin pasos y con un log info (no error)", async () => {
    const logger = loggerEspia();
    const paso = pasoConMemoria();
    const r = await sincronizarBodegaHandler({ ts: TS }, { servicio: null, logger }, paso);

    expect(r).toMatchObject({ configurado: false, paginas: 0, filas: 0 });
    expect(paso.memoria.size).toBe(0);
    expect(logger.info).toHaveBeenCalledWith("bodega-sync-no-configurado", expect.any(Object));
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("recorre las tablas en el orden del contrato: marcas, existencias, variantes, bajas", async () => {
    const { servicio, llamadas } = servicioConPaginas({});
    await sincronizarBodegaHandler({ ts: TS }, { servicio }, pasoConMemoria());
    expect(llamadas.map((l) => l.tabla)).toEqual(["marcas", "existencias", "variantes", "bajas"]);
  });

  it("sigue pidiendo páginas mientras haya `siguiente`, desde el cursor devuelto", async () => {
    const { servicio, llamadas } = servicioConPaginas({ existencias: 3 });
    const r = await sincronizarBodegaHandler({ ts: TS }, { servicio }, pasoConMemoria());

    const deExistencias = llamadas.filter((l) => l.tabla === "existencias");
    expect(deExistencias.map((l) => l.cursor)).toEqual([INICIO, cur(1), cur(2)]);
    expect(r.porTabla.existencias).toEqual({ paginas: 3, filas: 30, aplicadas: 30 });
    expect(r.topeAlcanzado).toBe(false);
  });

  it("corta en el tope de páginas y deja el resto para la próxima corrida", async () => {
    const { servicio, llamadas } = servicioConPaginas({ marcas: 1, existencias: 100 });
    const r = await sincronizarBodegaHandler(
      { ts: TS },
      { servicio, maxPaginas: 5 },
      pasoConMemoria(),
    );
    expect(llamadas).toHaveLength(5);
    expect(r).toMatchObject({ paginas: 5, topeAlcanzado: true });
    expect(llamadas.some((l) => l.tabla === "variantes")).toBe(false);
    expect(llamadas.some((l) => l.tabla === "bajas")).toBe(false);
  });

  it("una página llena que no mueve el cursor no se repite para siempre", async () => {
    const logger = loggerEspia();
    const servicio: SincronizarBodegaService = {
      leerCursores: async () => ({
        marcas: INICIO,
        existencias: INICIO,
        variantes: INICIO,
        bajas: INICIO,
      }),
      sincronizarPagina: vi.fn(async (_t, cursor) => ({
        filas: 1,
        aplicadas: 0,
        cursor,
        siguiente: cursor,
      })),
    };
    await sincronizarBodegaHandler({ ts: TS }, { servicio, logger }, pasoConMemoria());
    // Una página por tabla y se sigue con la próxima tabla.
    expect(servicio.sincronizarPagina).toHaveBeenCalledTimes(4);
    expect(logger.warn).toHaveBeenCalledWith("bodega-sync-sin-progreso", expect.any(Object));
  });

  it("reintentar la corrida no vuelve a pedir ni escribir páginas ya hechas (replay)", async () => {
    const { servicio, llamadas } = servicioConPaginas({ existencias: 2 });
    const paso = pasoConMemoria();

    const primera = await sincronizarBodegaHandler({ ts: TS }, { servicio }, paso);
    const hechas = llamadas.length;
    const otra = await sincronizarBodegaHandler({ ts: TS }, { servicio }, paso);

    expect(llamadas).toHaveLength(hechas);
    expect(servicio.leerCursores).toHaveBeenCalledTimes(1);
    expect(otra).toEqual(primera);
    expect([...paso.memoria.keys()]).toContain(
      "sincronizar-bodega-2026-10-08-1405-existencias--infinity~",
    );
  });

  it("si una página falla a mitad, el reintento retoma sin repetir las anteriores", async () => {
    const { servicio, llamadas } = servicioConPaginas({ existencias: 3 });
    const real = servicio.sincronizarPagina as ReturnType<typeof vi.fn>;
    const original = real.getMockImplementation();
    let fallar = true;
    real.mockImplementation(async (tabla: TablaBodega, cursor: CursorBodega) => {
      if (tabla === "existencias" && cursor.despues === "1" && fallar) {
        fallar = false;
        throw new Error("corte de red");
      }
      return (original as (t: TablaBodega, c: CursorBodega) => Promise<ResultadoPagina>)(
        tabla,
        cursor,
      );
    });
    const paso = pasoConMemoria();

    await expect(sincronizarBodegaHandler({ ts: TS }, { servicio }, paso)).rejects.toThrow(
      "corte de red",
    );
    const antes = llamadas.length;
    await sincronizarBodegaHandler({ ts: TS }, { servicio }, paso);

    // Las páginas memoizadas (marcas y la primera de existencias) no se repiten.
    const marcas = llamadas.filter((l) => l.tabla === "marcas");
    expect(marcas).toHaveLength(1);
    expect(llamadas.length).toBeGreaterThan(antes);
  });

  it("nunca loguea el contenido de las filas ni credenciales", async () => {
    const logger = loggerEspia();
    const { servicio } = servicioConPaginas({});
    await sincronizarBodegaHandler({ ts: TS }, { servicio, logger }, pasoConMemoria());
    const todo = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(todo).not.toMatch(/clave|apikey|anon|Bearer/i);
  });
});

describe("makeSincronizarBodegaFn", () => {
  it("se registra con su id", () => {
    const fn = makeSincronizarBodegaFn({ servicio: null });
    expect(fn.id()).toContain("sincronizar-bodega");
  });
});
