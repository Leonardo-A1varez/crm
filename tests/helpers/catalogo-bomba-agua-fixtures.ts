import type { ElementoCompatibilidad } from "@/lib/catalogo/compatibilidad";
import type { ProductoReal } from "./catalogo-ranking-fixtures";

/**
 * Filas de crm-dev (leídas con SELECT el 2026-10-07) de los grupos del ERP que
 * entraron en la conversación real de "una bomba de agua para el Rio 18": la
 * bomba, la polea de la bomba, las mangueras (entran solo por la palabra `agua`)
 * y la bomba de combustible (entra solo por `bomba`). Código, nombre, categoría,
 * procedencia, precio, existencia y compatibilidad están como en la base; se
 * recortó a las filas que sirven para un Kia Rio 2018.
 */

const rio = (desde: number | null): ElementoCompatibilidad => ({
  marca: "Kia",
  modelo: "RIO",
  modelo_nombre: "Kia Rio",
  anio_desde: desde,
  anio_hasta: null,
  cilindrada: null,
  combustible: null,
});

const fila = (
  codigo: string,
  nombre: string,
  categoria: string,
  descripcion: string,
  precio: number,
  stock: number,
  desde: number | null,
): ProductoReal => ({
  codigo,
  nombre,
  categoria,
  descripcion,
  precio,
  stock,
  compatibilidad: [rio(desde)],
});

export const BOMBA_DE_AGUA_RIO_18: ProductoReal[] = [
  fila("21688", "KIA RIO 18-", "BOMBA DE AGUA", "MOBIS", 96.66, 2, 2018),
  fila("21693", "KIA RIO 18-", "BOMBA DE AGUA", "JUNGWOO", 21.51, 24, 2018),
  fila("13973", "KIA RIO STYLUS", "BOMBA DE AGUA", "JUNGWOO", 33.02, 41, null),
  fila("21776", "KIA RIO 18- POLEA B/AGUA", "POLEA BOMBA AGUA E HIDRAU", "MOBIS", 7.72, 13, 2018),
  fila(
    "21843",
    "KIA RIO 18- POLEA CONDENSADOR",
    "POLEA BOMBA AGUA E HIDRAU",
    "MOBIS",
    41.43,
    2,
    2018,
  ),
  fila("21697", "KIA RIO 18- SUP", "MANG RADIADOR", "MOBIS", 12.53, 8, 2018),
  fila("24043", "KIA RIO 18- SUP", "MANG RADIADOR", "CHINA", 7.18, 16, 2018),
  fila("24042", "KIA RIO 18- BOMBA AGUA", "MANG RADIADOR", "CHINA OEM", 10.78, 13, 2018),
  fila("24058", "KIA RIO 18- TUBO AGUA", "MANG PASO AGUA", "CHINA", 9.66, 53, 2018),
  fila("21699", "KIA RIO 18- BOMBA AGUA", "MANG PASO AGUA", "MOBIS", 12.98, 0, 2018),
  fila("25843", "KIA RIO 18- DEPURADOR", "MANG PASO AGUA", "MOBIS", 48.41, 2, 2018),
  fila("21722", "KIA RIO 18-", "BOMBA COMPLETA COMBUST INYEC", "KOREA", 69.7, 11, 2018),
  fila("23926", "KIA RIO 18-", "BOMBA COMPLETA COMBUST INYEC", "MOBIS", 347.03, 1, 2018),
];
