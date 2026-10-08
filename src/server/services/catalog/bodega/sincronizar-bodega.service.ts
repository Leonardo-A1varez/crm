import { mismoCursor, type CursorBodega, type TablaBodega } from "@/lib/catalogo/bodega-contrato";
import type { BodegaCatalogoRepository } from "@/server/repositories/bodega-catalogo.repo";
import { BodegaTimeoutError, type BodegaCatalogoClient } from "./bodega-client";

/** Lo que el contrato recomienda (§3). */
export const LIMITE_PAGINA = 1000;
/** Piso del límite al reintentar un 57014: por debajo de esto no tiene sentido seguir. */
const LIMITE_MINIMO = 100;

export interface ResultadoPagina {
  /** Filas que trajo Bodega Web. */
  filas: number;
  /** Filas que cambiaron en la base (altas, modificaciones, bajas). */
  aplicadas: number;
  /** El cursor guardado al terminar (o el mismo si no hubo nada nuevo). */
  cursor: CursorBodega;
  /** No nulo si puede haber más páginas. */
  siguiente: CursorBodega | null;
}

export interface SincronizarBodegaService {
  /** El cursor guardado de cada tabla (`-infinity` si nunca se sincronizó). */
  leerCursores(): Promise<Record<TablaBodega, CursorBodega>>;
  /**
   * Una página de una tabla: la pide a Bodega Web desde `cursor`, la aplica y guarda el
   * nuevo cursor EN LA MISMA transacción. Si algo falla antes de eso, el cursor guardado
   * no avanza y el reintento vuelve a pedir la misma página (los upserts son idempotentes).
   */
  sincronizarPagina(tabla: TablaBodega, cursor: CursorBodega): Promise<ResultadoPagina>;
}

export class DefaultSincronizarBodegaService implements SincronizarBodegaService {
  constructor(
    private readonly deps: {
      client: BodegaCatalogoClient;
      repo: BodegaCatalogoRepository;
    },
  ) {}

  leerCursores(): Promise<Record<TablaBodega, CursorBodega>> {
    return this.deps.repo.leerCursores();
  }

  async sincronizarPagina(tabla: TablaBodega, cursor: CursorBodega): Promise<ResultadoPagina> {
    const pagina = await this.pedir(tabla, cursor);

    // Nada nuevo y la misma posición: no hay nada que escribir (cada 5 minutos, casi
    // siempre pasa esto).
    if (pagina.filas.length === 0 && mismoCursor(pagina.cursor, cursor)) {
      return { filas: 0, aplicadas: 0, cursor, siguiente: null };
    }

    // Tipado por tabla en el contrato; acá la tabla es un valor en tiempo de ejecución.
    const aplicadas = await this.deps.repo.aplicarPagina(
      tabla,
      pagina.filas as never,
      pagina.cursor,
    );
    return {
      filas: pagina.filas.length,
      aplicadas,
      cursor: pagina.cursor,
      siguiente: pagina.siguiente,
    };
  }

  /**
   * Pide la página. Un 57014 (Bodega Web corta a los 3 s) se reintenta con la mitad del
   * límite, hasta el piso; ahí se deja subir el error, que es reintentable.
   */
  private async pedir(tabla: TablaBodega, cursor: CursorBodega) {
    let limite = LIMITE_PAGINA;
    for (;;) {
      try {
        return await this.deps.client.cambios(tabla, { cursor, limite });
      } catch (e) {
        if (!(e instanceof BodegaTimeoutError) || limite <= LIMITE_MINIMO) throw e;
        limite = Math.max(LIMITE_MINIMO, Math.floor(limite / 2));
      }
    }
  }
}
