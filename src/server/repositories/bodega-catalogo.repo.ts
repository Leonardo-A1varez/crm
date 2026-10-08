import {
  CURSOR_INICIAL,
  selloEnMicros as sello,
  TABLAS_BODEGA,
  type CursorBodega,
  type FilaBaja,
  type FilaExistencia,
  type FilaMarca,
  type FilaVariante,
  type FilaDeTabla,
  type TablaBodega,
} from "@/lib/catalogo/bodega-contrato";
import type { VarianteBodega } from "@/lib/catalogo/procedencia";

/**
 * La copia de solo lectura del catálogo de Bodega Web.
 *
 * `aplicarPagina` escribe las filas Y guarda el cursor en la MISMA transacción (en
 * Supabase, la función `bodega_aplicar_pagina`): si se corta el proceso se retoma desde
 * el último cursor confirmado y, como mucho, se vuelve a recibir la última página, y
 * los upserts son idempotentes.
 */
export interface BodegaCatalogoRepository {
  /** El cursor guardado de cada tabla, o el inicial (`-infinity`, `null`) si no hay. */
  leerCursores(): Promise<Record<TablaBodega, CursorBodega>>;
  /** Devuelve cuántas filas cambiaron (altas, modificaciones o bajas). */
  aplicarPagina<T extends TablaBodega>(
    tabla: T,
    filas: readonly FilaDeTabla[T][],
    cursor: CursorBodega,
  ): Promise<number>;
  /**
   * Las variantes ACTIVAS (incluidas las descartadas y las no confiables, con sus
   * banderas) de esos ítems. Una sola consulta para todos los códigos.
   */
  variantesDeItems(codigosInternos: readonly string[]): Promise<VarianteBodega[]>;
}

/** Lo que guarda la copia de una marca de Bodega Web (lo que importa a la regla de bajas). */
interface MarcaGuardada {
  nombre: string;
  tipo: string | null;
  procedencia: string | null;
  activa: boolean;
  alias: string[];
  bodegaActualizadaEn: number | null;
}

interface ExistenciaGuardada {
  no_item: string;
  grupo_numero: number | null;
  origen: string | null;
  bodegaActualizadoEn: number;
  activa: boolean;
}

interface VarianteGuardada extends VarianteBodega {
  bodegaActualizadoEn: number;
}

/**
 * Una fila por nombre (sin mayúsculas), como la función SQL: gana la de tipo
 * `producto` y, a igualdad, la de sello más reciente.
 */
function unaPorNombre(filas: readonly FilaMarca[]): FilaMarca[] {
  const mejor = new Map<string, FilaMarca>();
  for (const f of filas) {
    const k = f.nombre.trim().toLowerCase();
    const actual = mejor.get(k);
    const gana =
      !actual ||
      (f.tipo === "producto" && actual.tipo !== "producto") ||
      ((f.tipo === "producto") === (actual.tipo === "producto") &&
        sello(f.actualizada_en) > sello(actual.actualizada_en));
    if (gana) mejor.set(k, f);
  }
  return [...mejor.values()];
}

/**
 * Implementación en memoria, con las MISMAS reglas que `bodega_aplicar_pagina`: un
 * upsert no pisa una fila con sello más nuevo, una fila que llega reactiva, y una baja
 * solo aplica si lo guardado es ANTERIOR al borrado. Solo para tests y entorno local.
 */
export class InMemoryBodegaCatalogoRepository implements BodegaCatalogoRepository {
  private readonly cursores = new Map<TablaBodega, CursorBodega>();
  private readonly marcas = new Map<string, MarcaGuardada>();
  private readonly existencias = new Map<string, ExistenciaGuardada>();
  private readonly variantes = new Map<string, VarianteGuardada>();

  async leerCursores(): Promise<Record<TablaBodega, CursorBodega>> {
    const out = {} as Record<TablaBodega, CursorBodega>;
    for (const t of TABLAS_BODEGA) {
      const c = this.cursores.get(t);
      out[t] = c ? { ...c } : { ...CURSOR_INICIAL };
    }
    return out;
  }

  async aplicarPagina<T extends TablaBodega>(
    tabla: T,
    filas: readonly FilaDeTabla[T][],
    cursor: CursorBodega,
  ): Promise<number> {
    let n = 0;
    switch (tabla) {
      case "marcas":
        for (const f of unaPorNombre(filas as readonly FilaMarca[])) n += this.aplicarMarca(f);
        break;
      case "existencias":
        for (const f of filas as readonly FilaExistencia[]) n += this.aplicarExistencia(f);
        break;
      case "variantes":
        for (const f of filas as readonly FilaVariante[]) n += this.aplicarVariante(f);
        break;
      case "bajas":
        for (const f of filas as readonly FilaBaja[]) n += this.aplicarBaja(f);
        break;
    }
    this.cursores.set(tabla, { ...cursor });
    return n;
  }

  async variantesDeItems(codigos: readonly string[]): Promise<VarianteBodega[]> {
    const pedidos = new Set(codigos);
    const out: VarianteBodega[] = [];
    for (const v of this.variantes.values()) {
      if (!v.activa || !pedidos.has(v.item_codigo_interno)) continue;
      const { bodegaActualizadoEn: _omitido, ...publica } = v;
      out.push(publica);
    }
    return out;
  }

  // ---- Lectura para los tests del contrato ----

  marca(nombre: string): MarcaGuardada | undefined {
    return this.marcas.get(nombre.toLowerCase());
  }

  existencia(noItem: string): ExistenciaGuardada | undefined {
    return this.existencias.get(noItem);
  }

  variante(id: string): VarianteGuardada | undefined {
    return this.variantes.get(id);
  }

  /** Siembra una marca como la dejaría la carga del ERP: sin sello de Bodega Web. */
  sembrarMarcaDelErp(m: { nombre: string; tipo: string | null; procedencia: string | null }): void {
    this.marcas.set(m.nombre.toLowerCase(), {
      ...m,
      activa: true,
      alias: [],
      bodegaActualizadaEn: null,
    });
  }

  // ---- Reglas (espejo de la función SQL) ----

  private aplicarMarca(f: FilaMarca): number {
    const clave = f.nombre.trim().toLowerCase();
    const previa = this.marcas.get(clave);
    const nueva = sello(f.actualizada_en);
    if (previa && previa.bodegaActualizadaEn !== null && previa.bodegaActualizadaEn > nueva) {
      return 0;
    }
    this.marcas.set(clave, {
      nombre: f.nombre.trim(),
      tipo: f.tipo?.trim() || null,
      procedencia: f.procedencia?.trim() || null,
      activa: f.activa,
      alias: f.alias.map((a) => a.trim()),
      bodegaActualizadaEn: nueva,
    });
    return 1;
  }

  private aplicarExistencia(f: FilaExistencia): number {
    const noItem = f.no_item.trim();
    const previa = this.existencias.get(noItem);
    const nueva = sello(f.actualizado_en);
    if (previa && previa.bodegaActualizadoEn > nueva) return 0;
    this.existencias.set(noItem, {
      no_item: noItem,
      grupo_numero: f.grupo_numero,
      origen: f.origen?.trim() || null,
      bodegaActualizadoEn: nueva,
      activa: true,
    });
    return 1;
  }

  private aplicarVariante(f: FilaVariante): number {
    const previa = this.variantes.get(f.id);
    const nueva = sello(f.actualizado_en);
    if (previa && previa.bodegaActualizadoEn > nueva) return 0;
    this.variantes.set(f.id, {
      id: f.id,
      item_codigo_interno: f.item_codigo_interno.trim(),
      marca_canonica: f.marca_canonica,
      marca_procedencia: f.marca_procedencia,
      lado: f.lado,
      estado: f.estado,
      descartada: f.descartada,
      activa: true,
      bodegaActualizadoEn: nueva,
    });
    return 1;
  }

  private aplicarBaja(f: FilaBaja): number {
    const borrado = sello(f.borrado_en);
    const clave = f.clave.trim();
    switch (f.tabla) {
      case "existencias": {
        const e = this.existencias.get(clave);
        if (e?.activa && e.bodegaActualizadoEn < borrado) {
          e.activa = false;
          return 1;
        }
        return 0;
      }
      case "variantes": {
        const v = this.variantes.get(clave);
        if (v?.activa && v.bodegaActualizadoEn < borrado) {
          v.activa = false;
          return 1;
        }
        return 0;
      }
      case "marcas": {
        const m = this.marcas.get(clave.toLowerCase());
        if (
          m?.activa &&
          m.nombre === clave &&
          (m.bodegaActualizadaEn === null || m.bodegaActualizadaEn < borrado)
        ) {
          m.activa = false;
          return 1;
        }
        return 0;
      }
      default:
        return 0;
    }
  }
}
