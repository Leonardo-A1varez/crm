import type { EmpresaErp, ErpSyncEstado } from "@/types/entities";

/**
 * Las cuatro empresas del ERP y la columna de precio de cada una.
 *
 * El código es el del ERP (`usuarios.empresa_erp`): 1 Matriz, 3 Magdalena,
 * 5 Koreanos SAS, 6 SAS Repuestos. Sin dependencias de React ni de servidor: lo
 * leen la tabla de productos, Ajustes y las acciones.
 */
export type CampoPrecioErp =
  | "precio_matriz"
  | "precio_magdalena"
  | "precio_koreanos"
  | "precio_sas_repuestos";

export interface EmpresaErpDef {
  codigo: EmpresaErp;
  campo: CampoPrecioErp;
  /** Título de la columna de la tabla. */
  etiqueta: string;
  /** Nombre completo, para el selector de Ajustes. */
  nombre: string;
}

export const EMPRESAS_ERP: readonly EmpresaErpDef[] = [
  { codigo: 1, campo: "precio_matriz", etiqueta: "Matriz", nombre: "Matriz" },
  { codigo: 3, campo: "precio_magdalena", etiqueta: "Magdalena", nombre: "Magdalena" },
  { codigo: 5, campo: "precio_koreanos", etiqueta: "Koreanos", nombre: "Koreanos SAS" },
  { codigo: 6, campo: "precio_sas_repuestos", etiqueta: "SAS", nombre: "SAS Repuestos" },
];

export function esEmpresaErp(v: unknown): v is EmpresaErp {
  return EMPRESAS_ERP.some((e) => e.codigo === v);
}

/** La columna de precio de la empresa del usuario, o `null` si no tiene empresa. */
export function campoDeEmpresa(empresa: number | null | undefined): CampoPrecioErp | null {
  return EMPRESAS_ERP.find((e) => e.codigo === empresa)?.campo ?? null;
}

/** El precio de una empresa. 0 y nulo son lo mismo: esa empresa no lo vende. */
export function precioDeEmpresa(
  p: Partial<Record<CampoPrecioErp, number | null>>,
  campo: CampoPrecioErp,
): number | null {
  const v = p[campo];
  return typeof v === "number" && v > 0 ? v : null;
}

const precioFmt = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Coma decimal y dos decimales. Sin precio: "A consultar". */
export function formatearPrecio(precio: number | null | undefined): string {
  return typeof precio === "number" ? precioFmt.format(precio) : "A consultar";
}

// ---------------------------------------------------------------------------
// Estado de la sincronización con el ERP
// ---------------------------------------------------------------------------

/** Pasado este tiempo desde la última corrida buena, se avisa que está atrasado. */
export const UMBRAL_ATRASO_MINUTOS = 30;

export type NivelSincronizacion = "ok" | "atrasado" | "error" | "sin-datos";

export interface EstadoSincronizacion {
  nivel: NivelSincronizacion;
  texto: string;
}

function haceCuanto(desde: Date, ahora: Date): string {
  const minutos = Math.max(0, Math.floor((ahora.getTime() - desde.getTime()) / 60_000));
  if (minutos < 1) return "hace menos de 1 min";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

/**
 * Cómo se dice, arriba de la tabla, qué tan fresco está el catálogo.
 *
 * Un error en la última corrida gana sobre la antigüedad: el texto no repite el
 * mensaje del error (viene del servidor del ERP y lo ve todo el equipo), solo dice
 * que falló. Se asume que `ultimo_error` es `null` cuando la corrida salió bien.
 */
export function estadoSincronizacion(
  estado: ErpSyncEstado | null,
  ahora: Date,
): EstadoSincronizacion {
  const exito = estado?.ultimo_exito ?? null;
  const fallo = (estado?.ultimo_error ?? "").trim() !== "";

  if (fallo) {
    const cola =
      exito !== null
        ? `; la última buena fue ${haceCuanto(exito, ahora)}`
        : "; todavía no hubo ninguna corrida buena";
    return { nivel: "error", texto: `Falló la última sincronización con el ERP${cola}` };
  }
  if (exito === null) {
    return { nivel: "sin-datos", texto: "Sin sincronización con el ERP todavía" };
  }
  const minutos = (ahora.getTime() - exito.getTime()) / 60_000;
  return {
    nivel: minutos > UMBRAL_ATRASO_MINUTOS ? "atrasado" : "ok",
    texto: `Actualizado ${haceCuanto(exito, ahora)}`,
  };
}
