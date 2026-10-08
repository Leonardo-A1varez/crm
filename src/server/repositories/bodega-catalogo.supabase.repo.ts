import {
  CURSOR_INICIAL,
  TABLAS_BODEGA,
  type CursorBodega,
  type FilaDeTabla,
  type TablaBodega,
} from "@/lib/catalogo/bodega-contrato";
import type { VarianteBodega } from "@/lib/catalogo/procedencia";
import { ValidationError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import type { Json } from "@/server/db/types.gen";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { BodegaCatalogoRepository } from "./bodega-catalogo.repo";

/** Los candidatos del agente son a lo sumo 20; esto es solo un techo defensivo. */
const MAX_CODIGOS = 200;
const MAX_VARIANTES = 2000;

/**
 * La escritura va por `bodega_aplicar_pagina` (una función = una transacción: las filas
 * y el cursor entran juntos o no entra nada). Solo `service_role` puede ejecutarla, así
 * que este repo se construye con el client de service-role (Inngest). La lectura de
 * variantes sirve con el client autenticado también: RLS deja leer a admin y vendedor.
 */
export class SupabaseBodegaCatalogoRepository implements BodegaCatalogoRepository {
  constructor(private readonly db: AppClient) {}

  async leerCursores(): Promise<Record<TablaBodega, CursorBodega>> {
    const { data, error } = await this.db
      .from("bodega_sync_cursor")
      .select("tabla, desde, despues");
    if (error) throw mapPostgrestError(error, { resource: "bodega_sync_cursor" });
    const out = {} as Record<TablaBodega, CursorBodega>;
    for (const t of TABLAS_BODEGA) out[t] = { ...CURSOR_INICIAL };
    for (const fila of data ?? []) {
      const tabla = TABLAS_BODEGA.find((t) => t === fila.tabla);
      if (tabla) out[tabla] = { desde: fila.desde, despues: fila.despues };
    }
    return out;
  }

  async aplicarPagina<T extends TablaBodega>(
    tabla: T,
    filas: readonly FilaDeTabla[T][],
    cursor: CursorBodega,
  ): Promise<number> {
    const { data, error } = await this.db.rpc("bodega_aplicar_pagina", {
      p_tabla: tabla as string,
      p_filas: filas as unknown as Json,
      p_cursor: { desde: cursor.desde, despues: cursor.despues } as Json,
    });
    if (error) {
      // 22023: la función rechazó la forma de la página. Es determinista: reintentar
      // el mismo cuerpo no lo arregla (el mensaje nombra la fila, no su contenido).
      if (error.code === "22023") {
        throw new ValidationError(
          `bodega_aplicar_pagina rechazó la página de ${tabla}: ${error.message}`,
        );
      }
      throw mapPostgrestError(error, { resource: "bodega_aplicar_pagina" });
    }
    return data ?? 0;
  }

  async variantesDeItems(codigosInternos: readonly string[]): Promise<VarianteBodega[]> {
    const codigos = [...new Set(codigosInternos)].slice(0, MAX_CODIGOS);
    if (codigos.length === 0) return [];
    const { data, error } = await this.db
      .from("bodega_variantes")
      .select(
        "id, item_codigo_interno, marca_canonica, marca_procedencia, lado, estado, descartada, activa",
      )
      .in("item_codigo_interno", codigos)
      .eq("activa", true)
      .limit(MAX_VARIANTES);
    if (error) throw mapPostgrestError(error, { resource: "bodega_variantes" });
    return (data ?? []).map((r) => ({
      id: r.id,
      item_codigo_interno: r.item_codigo_interno,
      marca_canonica: r.marca_canonica,
      marca_procedencia: r.marca_procedencia,
      lado: r.lado,
      estado: r.estado,
      descartada: r.descartada,
      activa: r.activa,
    }));
  }
}
