import { DEFINICIONES_LISTA, type CampoOrden } from "@/lib/catalogo/columnas-productos";
import { EMPRESAS_ERP, type EmpresaErpDef } from "@/lib/catalogo/precios-erp";
import type { ColumnaLista } from "@/lib/catalogo/columnas-productos";
import type { GrupoFiltro } from "@/lib/ui/filtros-productos";

/**
 * Las columnas de la tabla de `/productos`, en el orden en que se ven, y qué panel abre
 * el clic en cada encabezado.
 *
 * El ancho es fijo (la tabla es `table-layout: fixed`): con ancho automático la
 * columna cambiaría de medida según qué filas están dibujadas en ese momento de la
 * virtualización, y el encabezado saltaría al desplazarse. Descripción no lleva ancho:
 * se queda con lo que sobra.
 */
export type FiltroDeColumna =
  | { tipo: "lista"; columna: ColumnaLista }
  | { tipo: "precio" }
  | { tipo: "stock" }
  | { tipo: "estado" };

export interface ColumnaTabla {
  id: CampoOrden;
  etiqueta: string;
  /** Ancho en px; sin él, la columna se lleva el resto. */
  ancho?: number;
  derecha?: boolean;
  /** Código y números van en la fuente monoespaciada. */
  mono?: boolean;
  filtro: FiltroDeColumna;
  /** El filtro de la URL que enciende el indicador del encabezado. */
  grupo: GrupoFiltro;
}

function lista(columna: ColumnaLista, extra: Partial<ColumnaTabla> = {}): ColumnaTabla {
  return {
    id: columna,
    etiqueta: DEFINICIONES_LISTA[columna].etiqueta,
    filtro: { tipo: "lista", columna },
    grupo: columna,
    ...extra,
  };
}

export const COLUMNAS_TABLA: readonly ColumnaTabla[] = [
  lista("codigo", { ancho: 150, mono: true }),
  lista("codigoFabrica", { ancho: 120, mono: true }),
  lista("otrosCodigos", { ancho: 132, mono: true }),
  lista("categoria", { ancho: 132 }),
  lista("descripcion"),
  lista("marca", { ancho: 116 }),
  {
    id: "precio",
    etiqueta: "Precio",
    ancho: 124,
    derecha: true,
    mono: true,
    filtro: { tipo: "precio" },
    grupo: "precio",
  },
  {
    id: "stock",
    etiqueta: "Stock",
    ancho: 100,
    derecha: true,
    mono: true,
    filtro: { tipo: "stock" },
    grupo: "stock",
  },
  { id: "estado", etiqueta: "Estado", ancho: 108, filtro: { tipo: "estado" }, grupo: "estado" },
];

/** Ancho de cada columna de precio por empresa del ERP. */
export const ANCHO_PRECIO_EMPRESA = 108;

/**
 * Lo que dibuja la tabla, en orden: las columnas del catálogo y, justo después de
 * "Precio" (el más barato), una de precio por cada empresa del ERP. Las de empresa
 * se ordenan (panel solo de orden) pero no se filtran.
 */
export type ColumnaVisible =
  | { tipo: "catalogo"; columna: ColumnaTabla }
  | { tipo: "empresa"; empresa: EmpresaErpDef; ancho: number };

export const COLUMNAS_VISIBLES: readonly ColumnaVisible[] = COLUMNAS_TABLA.flatMap(
  (columna): ColumnaVisible[] => {
    const propia: ColumnaVisible = { tipo: "catalogo", columna };
    if (columna.id !== "precio") return [propia];
    return [
      propia,
      ...EMPRESAS_ERP.map(
        (empresa): ColumnaVisible => ({ tipo: "empresa", empresa, ancho: ANCHO_PRECIO_EMPRESA }),
      ),
    ];
  },
);

export function anchoDeColumna(c: ColumnaVisible): number | undefined {
  return c.tipo === "catalogo" ? c.columna.ancho : c.ancho;
}

/** La columna de Editar / Desactivar, solo para admin. */
export const ANCHO_ACCIONES = 164;
/** Lo que mide la descripción como mínimo antes de que la tabla pase a desplazarse de costado. */
export const ANCHO_MINIMO_DESCRIPCION = 250;

export function anchoMinimoDeTabla(isAdmin: boolean): number {
  const fijos = COLUMNAS_VISIBLES.reduce((suma, c) => suma + (anchoDeColumna(c) ?? 0), 0);
  return fijos + ANCHO_MINIMO_DESCRIPCION + (isAdmin ? ANCHO_ACCIONES : 0);
}
