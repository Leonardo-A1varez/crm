import { LOTE_TAMANO } from "@/lib/validation/productos-filtros.schema";
import type { ColumnaLista } from "@/lib/catalogo/columnas-productos";
import type { Faceta, LoteProductos, ProductoFila } from "@/types/productos";

/**
 * Lo que la pantalla le pide al servidor: un lote del catálogo y la lista de valores de
 * una columna. Son dos `GET` abortables (ver `app/api/productos/_lib/responder.ts`) y
 * viven acá, detrás de una interfaz, para que los tests inyecten los suyos.
 */

export interface CargadoresProductos {
  /** El lote `lote` (1-based) del conjunto que define `consulta`. */
  lote(consulta: string, lote: number, signal: AbortSignal): Promise<LoteProductos>;
  /** La lista de valores de `columna`; `busqueda` es lo escrito en su buscador. */
  faceta(
    consulta: string,
    columna: ColumnaLista,
    busqueda: string,
    signal: AbortSignal,
  ): Promise<Faceta>;
}

/** Una lectura que el servidor rechazó o que llegó mal. `mensajes` son los de un 400. */
export class ErrorLectura extends Error {
  constructor(
    message: string,
    readonly estado: number | null,
    readonly mensajes: string[] = [],
  ) {
    super(message);
    this.name = "ErrorLectura";
  }
}

async function pedir(url: string, signal: AbortSignal): Promise<unknown> {
  const respuesta = await fetch(url, { signal, credentials: "same-origin" });
  if (!respuesta.ok) {
    const cuerpo: unknown = await respuesta.json().catch(() => null);
    const datos = (typeof cuerpo === "object" && cuerpo !== null ? cuerpo : {}) as {
      error?: unknown;
      mensajes?: unknown;
    };
    throw new ErrorLectura(
      typeof datos.error === "string" ? datos.error : `HTTP ${respuesta.status}`,
      respuesta.status,
      Array.isArray(datos.mensajes)
        ? datos.mensajes.filter((m): m is string => typeof m === "string")
        : [],
    );
  }
  return respuesta.json();
}

function esTextoONulo(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function esFila(v: unknown): v is ProductoFila {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f["id"] === "string" &&
    typeof f["codigo_interno"] === "string" &&
    esTextoONulo(f["codigo_fabrica"]) &&
    Array.isArray(f["otros_codigos"]) &&
    esTextoONulo(f["sku_proveedor"]) &&
    typeof f["nombre"] === "string" &&
    esTextoONulo(f["descripcion"]) &&
    esTextoONulo(f["categoria"]) &&
    typeof f["precio"] === "number" &&
    typeof f["stock"] === "number" &&
    typeof f["activo"] === "boolean"
  );
}

function esEnteroNoNegativo(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

export function leerLote(v: unknown): LoteProductos {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ErrorLectura("Respuesta inválida del catálogo.", null);
  }
  const { filas, total, lote, desde } = v as Record<string, unknown>;
  if (
    !Array.isArray(filas) ||
    !filas.every(esFila) ||
    !esEnteroNoNegativo(total) ||
    !esEnteroNoNegativo(lote) ||
    lote < 1 ||
    !esEnteroNoNegativo(desde) ||
    filas.length > LOTE_TAMANO
  ) {
    throw new ErrorLectura("Respuesta incompleta del catálogo.", null);
  }
  return { filas, total, lote, desde };
}

export function leerFaceta(v: unknown): Faceta {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ErrorLectura("Respuesta inválida de la lista.", null);
  }
  const { valores, distintos } = v as Record<string, unknown>;
  if (
    !Array.isArray(valores) ||
    !esEnteroNoNegativo(distintos) ||
    !valores.every(
      (x) =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as { valor?: unknown }).valor === "string" &&
        esEnteroNoNegativo((x as { cantidad?: unknown }).cantidad),
    )
  ) {
    throw new ErrorLectura("Respuesta incompleta de la lista.", null);
  }
  return { valores: valores as Faceta["valores"], distintos };
}

function conClaves(consulta: string, extra: Record<string, string>): string {
  const params = new URLSearchParams(consulta);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return params.toString();
}

export const cargadoresDeRed: CargadoresProductos = {
  async lote(consulta, lote, signal) {
    const url = `/api/productos/lote?${conClaves(consulta, { lote: String(lote) })}`;
    return leerLote(await pedir(url, signal));
  },
  async faceta(consulta, columna, busqueda, signal) {
    const extra: Record<string, string> = { columna };
    if (busqueda !== "") extra["busqueda"] = busqueda;
    const url = `/api/productos/faceta?${conClaves(consulta, extra)}`;
    return leerFaceta(await pedir(url, signal));
  },
};
