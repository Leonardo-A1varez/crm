import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ErrorLectura, type CargadoresProductos } from "@/components/productos/cliente-productos";
import { LOTES_EN_PARALELO, useCargaProductos } from "@/components/productos/use-carga-productos";
import { LOTE_TAMANO } from "@/lib/validation/productos-filtros.schema";
import type { LoteProductos, ProductoFila } from "@/types/productos";

/** Filas inventadas: lo único que importa es el id y que haya `n`. */
function filas(n: number, prefijo = "p"): ProductoFila[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefijo}-${i}`,
    codigo_interno: String(i + 1),
    codigo_fabrica: null,
    otros_codigos: [],
    sku_proveedor: null,
    nombre: `Producto ${i}`,
    descripcion: null,
    categoria: null,
    precio: 1,
    stock: 1,
    activo: true,
  }));
}

/** Un servidor de mentira con `total` filas que atiende por lotes y mide la concurrencia. */
function servidor(total: number, opciones: { prefijo?: string } = {}) {
  const todas = filas(total, opciones.prefijo);
  const pedidos: number[] = [];
  let enVuelo = 0;
  let maximo = 0;
  const lote = vi.fn(
    async (_consulta: string, numero: number, signal: AbortSignal): Promise<LoteProductos> => {
      pedidos.push(numero);
      enVuelo += 1;
      maximo = Math.max(maximo, enVuelo);
      await new Promise((r) => setTimeout(r, 0));
      enVuelo -= 1;
      if (signal.aborted) throw new DOMException("abortado", "AbortError");
      const desde = (numero - 1) * LOTE_TAMANO;
      return { filas: todas.slice(desde, desde + LOTE_TAMANO), total, lote: numero, desde };
    },
  );
  return { lote, pedidos, maximoEnVuelo: () => maximo };
}

afterEach(cleanup);

const montar = (consulta: string, version: number, lote: CargadoresProductos["lote"]) =>
  renderHook(
    (p: { consulta: string; version: number }) => useCargaProductos(p.consulta, p.version, lote),
    {
      initialProps: { consulta, version },
    },
  );

describe("useCargaProductos", () => {
  test("arranca cargando", () => {
    const s = servidor(10);
    const { result } = montar("", 0, s.lote);
    expect(result.current.estado).toEqual({ tipo: "cargando" });
  });

  test("el primer lote va solo y los demás de a LOTES_EN_PARALELO", async () => {
    const s = servidor(9_500); // 10 lotes
    const { result } = montar("", 0, s.lote);
    await waitFor(() => expect(result.current.estado.tipo).toBe("lista"));
    await waitFor(() => {
      const e = result.current.estado;
      expect(e.tipo === "lista" && e.completo).toBe(true);
    });
    expect(s.pedidos[0]).toBe(1);
    expect(s.pedidos.slice(1, 1 + LOTES_EN_PARALELO).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
    expect(s.pedidos.slice(5, 9).sort((a, b) => a - b)).toEqual([6, 7, 8, 9]);
    expect(s.pedidos.slice(9)).toEqual([10]);
    expect(s.maximoEnVuelo()).toBe(LOTES_EN_PARALELO);
    const e = result.current.estado;
    if (e.tipo !== "lista") throw new Error("se esperaba la lista");
    expect(e.filas).toHaveLength(9_500);
    expect(e.total).toBe(9_500);
    expect(new Set(e.filas.map((f) => f.id)).size).toBe(9_500);
    // Las filas llegan en el orden del servidor: lote tras lote.
    expect(e.filas.map((f) => f.id)).toEqual(filas(9_500).map((f) => f.id));
  });

  test("pinta tras cada tanda: primero un prefijo (completo: false) y al final todo", async () => {
    const s = servidor(2_300); // 3 lotes: 1 solo y después 2 y 3 juntos
    const vistos: { n: number; completo: boolean }[] = [];
    const { result } = renderHook(() => {
      const c = useCargaProductos("", 0, s.lote);
      if (c.estado.tipo === "lista") {
        const ultimo = vistos.at(-1);
        if (ultimo?.n !== c.estado.filas.length) {
          vistos.push({ n: c.estado.filas.length, completo: c.estado.completo });
        }
      }
      return c;
    });
    await waitFor(() => {
      const e = result.current.estado;
      expect(e.tipo === "lista" && e.completo).toBe(true);
    });
    expect(vistos).toEqual([
      { n: 1_000, completo: false },
      { n: 2_300, completo: true },
    ]);
  });

  test("un catálogo de un solo lote queda completo de entrada", async () => {
    const s = servidor(120);
    const { result } = montar("", 0, s.lote);
    await waitFor(() => expect(result.current.estado.tipo).toBe("lista"));
    expect(result.current.estado).toMatchObject({
      total: 120,
      completo: true,
      actualizando: false,
    });
    expect(s.pedidos).toEqual([1]);
  });

  test("sin filas: lista completa con total 0", async () => {
    const s = servidor(0);
    const { result } = montar("", 0, s.lote);
    await waitFor(() => expect(result.current.estado.tipo).toBe("lista"));
    expect(result.current.estado).toMatchObject({ filas: [], total: 0, completo: true });
  });

  test("cambiar la consulta aborta lo que viaja y empieza de cero con la consulta nueva", async () => {
    const senales: AbortSignal[] = [];
    const consultas: string[] = [];
    const s = servidor(5_000);
    const lote: CargadoresProductos["lote"] = (consulta, n, signal) => {
      senales.push(signal);
      consultas.push(consulta);
      return s.lote(consulta, n, signal);
    };
    const { result, rerender } = montar("a=1", 0, lote);
    await waitFor(() => expect(senales.length).toBeGreaterThan(0));
    rerender({ consulta: "b=2", version: 0 });
    expect(senales[0]?.aborted).toBe(true);
    // Vuelve al esqueleto mientras llega la consulta nueva.
    expect(result.current.estado.tipo).toBe("cargando");
    await waitFor(() => {
      const e = result.current.estado;
      expect(e.tipo === "lista" && e.completo).toBe(true);
    });
    expect(consultas.at(-1)).toBe("b=2");
  });

  test("un 400 del servidor es 'invalido' con los mensajes que mandó", async () => {
    const lote: CargadoresProductos["lote"] = async () => {
      throw new ErrorLectura("Filtros no válidos.", 400, [
        "El mínimo de precio no puede ser mayor que el máximo.",
      ]);
    };
    const { result } = montar("precioMin=9&precioMax=1", 0, lote);
    await waitFor(() => expect(result.current.estado.tipo).toBe("invalido"));
    expect(result.current.estado).toEqual({
      tipo: "invalido",
      mensajes: ["El mínimo de precio no puede ser mayor que el máximo."],
    });
  });

  test("si falla a mitad de camino deja a la vista lo que llegó y Reintentar vuelve a pedir todo", async () => {
    const s = servidor(2_300);
    let fallar = true;
    const lote: CargadoresProductos["lote"] = async (c, n, signal) => {
      if (fallar && n === 3) throw new ErrorLectura("No se pudo leer el catálogo.", 500);
      return s.lote(c, n, signal);
    };
    const { result } = montar("", 0, lote);
    await waitFor(() => expect(result.current.estado.tipo).toBe("error"));
    const e = result.current.estado;
    if (e.tipo !== "error") throw new Error("se esperaba un error");
    expect(e.mensaje).toBe("No se pudo leer el catálogo.");
    expect(e.total).toBe(2_300);
    // El lote 2 pudo haber llegado o no, pero nunca se mezclan lotes a medias.
    expect(e.filas.length === 1_000 || e.filas.length === 0).toBe(true);

    fallar = false;
    act(() => result.current.reintentar());
    expect(result.current.estado.tipo).toBe("cargando");
    await waitFor(() => {
      const l = result.current.estado;
      expect(l.tipo === "lista" && l.completo).toBe(true);
    });
  });

  test("un total que cambia durante la carga es un error, no una tabla mezclada", async () => {
    const lote: CargadoresProductos["lote"] = async (_c, n) => ({
      filas: filas(n === 1 ? 1_000 : 1_000, `l${n}`),
      total: n === 1 ? 2_000 : 2_100,
      lote: n,
      desde: (n - 1) * 1_000,
    });
    const { result } = montar("", 0, lote);
    await waitFor(() => expect(result.current.estado.tipo).toBe("error"));
    expect(result.current.estado).toMatchObject({
      mensaje: "El catálogo cambió durante la carga.",
    });
  });

  test("un lote que repite un producto es un error y no contamina las filas ya publicadas", async () => {
    const lote: CargadoresProductos["lote"] = async (_c, n) => ({
      filas: filas(1_000, "igual"),
      total: 2_000,
      lote: n,
      desde: (n - 1) * 1_000,
    });
    const { result } = montar("", 0, lote);
    await waitFor(() => expect(result.current.estado.tipo).toBe("error"));
    const e = result.current.estado;
    expect(e).toMatchObject({ mensaje: "La carga repitió un producto." });
    if (e.tipo === "error") expect(e.filas).toHaveLength(1_000);
  });

  test("subir la versión recarga en segundo plano: las filas de antes siguen y se cambian de una vez", async () => {
    const viejas = servidor(2_300, { prefijo: "viejo" });
    const nuevas = servidor(2_300, { prefijo: "nuevo" });
    let cual = viejas;
    const lote: CargadoresProductos["lote"] = (c, n, s) => cual.lote(c, n, s);
    const { result, rerender } = montar("", 0, lote);
    await waitFor(() => {
      const e = result.current.estado;
      expect(e.tipo === "lista" && e.completo).toBe(true);
    });

    cual = nuevas;
    const vistos: string[] = [];
    rerender({ consulta: "", version: 1 });
    // Mientras recarga no vuelve al esqueleto: la lista vieja está a la vista y dice que actualiza.
    const durante = result.current.estado;
    expect(durante.tipo).toBe("lista");
    if (durante.tipo === "lista") {
      expect(durante.actualizando).toBe(true);
      vistos.push(durante.filas[0]?.id ?? "");
    }
    await waitFor(() => {
      const e = result.current.estado;
      expect(e.tipo === "lista" && !e.actualizando).toBe(true);
    });
    const e = result.current.estado;
    if (e.tipo !== "lista") throw new Error("se esperaba la lista");
    expect(vistos).toEqual(["viejo-0"]);
    expect(e.filas[0]?.id).toBe("nuevo-0");
    expect(e.filas).toHaveLength(2_300);
  });

  test("si la recarga en segundo plano falla, siguen a la vista las filas de antes", async () => {
    const s = servidor(2_300);
    let romper = false;
    const lote: CargadoresProductos["lote"] = async (c, n, signal) => {
      if (romper) throw new ErrorLectura("No se pudo leer el catálogo.", 500);
      return s.lote(c, n, signal);
    };
    const { result, rerender } = montar("", 0, lote);
    await waitFor(() => {
      const e = result.current.estado;
      expect(e.tipo === "lista" && e.completo).toBe(true);
    });
    romper = true;
    rerender({ consulta: "", version: 1 });
    await waitFor(() => expect(result.current.estado.tipo).toBe("error"));
    const e = result.current.estado;
    if (e.tipo === "error") expect(e.filas).toHaveLength(2_300);
  });
});
