import type { Abreviatura } from "@/lib/catalogo/abreviaturas";
import type { ProductoReal } from "./catalogo-ranking-fixtures";

/**
 * Abreviaturas de PRUEBA. Los tokens (`AMORTIG`, `DELT`, `DEL`, `POST`, `POS`,
 * `LH`, `RH`) y el grupo `REPUESTO EMG` son los que se leen en las filas de abajo;
 * las expansiones son las que le dan sentido en estos tests y no pretenden ser
 * el diccionario del dueño (ese lo carga `scripts/catalogo/cargar-abreviaturas.mjs`
 * desde `docs/catalogo/abreviaturas-sugeridas.csv`).
 */
const a = (
  abrev: string,
  expansion: string,
  tipo: Abreviatura["tipo"],
  ambito: Abreviatura["ambito"] = "ambos",
): Abreviatura => ({ abrev, expansion, tipo, ambito, confianza: "alta", confirmado: false });

export const ABREVIATURAS: Abreviatura[] = [
  a("AMORTIG", "amortiguador", "pieza", "categoria"),
  a("DELT", "delantero", "posicion"),
  a("DEL", "delantero", "posicion"),
  // Con la aclaración entre paréntesis, como las escribe el dueño en el CSV.
  a("POST", "posterior (trasero)", "posicion"),
  a("POS", "posterior (variante de POST)", "posicion"),
  a("LH", "izquierdo (lado del conductor en Ecuador)", "posicion", "nombre"),
  a("RH", "derecho (lado del pasajero en Ecuador)", "posicion", "nombre"),
  a("INF", "inferior", "posicion", "nombre"),
  a("SUP", "superior", "posicion", "nombre"),
  a("DSL", "diesel", "atributo", "nombre"),
  a("SEN", "sensor", "pieza", "categoria"),
  a("MANG", "manguera", "pieza"),
  a("REPUESTO EMG", "repuesto de emergencia", "ruido", "categoria"),
];

const niro = [
  {
    marca: "Kia",
    modelo: "NIRO",
    modelo_nombre: "Kia Niro",
    anio_desde: 2017,
    anio_hasta: null,
    cilindrada: null,
    combustible: null,
  },
] as const;

const fila = (
  codigo: string,
  nombre: string,
  categoria: string,
  descripcion: string,
  precio: number,
  stock: number,
  compatibilidad: ProductoReal["compatibilidad"],
): ProductoReal => ({ codigo, nombre, categoria, descripcion, precio, stock, compatibilidad });

/**
 * Filas de la base local cargada con el ERP real (27.187 ítems, `crm_catalogo_erp.csv`,
 * 2026-10-07): los tres amortiguadores del Niro y las dos filas de `REPUESTO EMG` que la
 * herramienta cotizó en crm-dev el 2026-10-07 19:12 UTC con la consulta «amortiguadores
 * delanteros» + Kia Niro 2020. Código, nombre, grupo, descripción, precio, existencia y
 * compatibilidad como en la base.
 */
export const AMORTIGUADORES_NIRO: ProductoReal[] = [
  fila("23868", "KIA NIRO HYB 17- LH", "AMORTIG DELT", "MANDO", 89.55, 11, [...niro]),
  fila("23869", "KIA NIRO HYB 17- RH", "AMORTIG DELT", "MANDO", 94.22, 7, [...niro]),
  fila("23870", "KIA NIRO HYB 17-", "AMORTIG POST", "MANDO", 45.47, 8, [...niro]),
  fila("24695", "290 AMORTIGUADORES DEL CH TAOHE 2011", "REPUESTO EMG", "", 76.37, 0, []),
  fila("24696", "291 AMORTIGUADORES POS CH TAOHE 2011", "REPUESTO EMG", "", 63.64, 0, []),
];
