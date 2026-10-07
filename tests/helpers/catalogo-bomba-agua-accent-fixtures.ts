import type { ElementoCompatibilidad } from "@/lib/catalogo/compatibilidad";
import type { ProductoReal } from "./catalogo-ranking-fixtures";

/**
 * Lo que devolvió `buscar_productos('bomba de agua', 'Hyundai', 'Accent', 2006)` en
 * crm-dev (SELECT de solo lectura, 2026-10-07), con código, nombre, categoría,
 * procedencia, precio, existencia, puntaje, nivel de vehículo y compatibilidad como
 * en la base. Es la búsqueda de la conversación real «Necesito Una bomba de agua
 * para el accent 2006», donde el agente cotizó 4 precios mezclados (dos eran
 * empaques de la bomba y uno, una polea). Se dejan los candidatos que confirman el
 * vehículo (nivel 0 o más) y dos de otro auto, que comparten la categoría.
 */

export interface ProductoRealConRanking extends ProductoReal {
  puntaje: number;
  nivel_vehiculo: number;
}

const accent = (anioDesde: number | null): ElementoCompatibilidad[] => [
  {
    marca: "Hyundai",
    modelo: "ACC",
    modelo_nombre: "Hyundai Accent",
    anio_desde: anioDesde,
    anio_hasta: null,
    cilindrada: null,
    combustible: null,
  },
  {
    marca: "Hyundai",
    modelo: "VER",
    modelo_nombre: "Hyundai Accent Verna",
    anio_desde: null,
    anio_hasta: null,
    cilindrada: null,
    combustible: null,
  },
];

const verna = (anioDesde: number | null): ElementoCompatibilidad[] => [
  {
    marca: "Hyundai",
    modelo: "VER",
    modelo_nombre: "Hyundai Accent Verna",
    anio_desde: anioDesde,
    anio_hasta: null,
    cilindrada: null,
    combustible: null,
  },
];

const fila = (
  codigo: string,
  nombre: string,
  categoria: string,
  descripcion: string | null,
  precio: number,
  stock: number,
  puntaje: number,
  nivel_vehiculo: number,
  compatibilidad: ElementoCompatibilidad[],
): ProductoRealConRanking => ({
  codigo,
  nombre,
  categoria,
  descripcion,
  precio,
  stock,
  puntaje,
  nivel_vehiculo,
  compatibilidad,
});

const POLEA = "POLEA BOMBA AGUA E HIDRAU";
const BOMBA = "BOMBA DE AGUA";

export const BOMBA_DE_AGUA_ACCENT_2006: ProductoRealConRanking[] = [
  fila("6879", "HY ACC 06- XCITE VER GETZ B/AGUA", POLEA, "MOBIS", 7.16, 19, 28, 5, accent(2006)),
  fila(
    "13215",
    "HY ACC 06- VER GETZ KIA XCITE 16V GWHY-23A",
    BOMBA,
    "JUNGWOO",
    22.01,
    74,
    24,
    5,
    accent(2006),
  ),
  fila(
    "10478",
    "HY ACC 06- VER GETZ KIA XCITE 16V GWHY-23A",
    BOMBA,
    "MOBIS",
    66.18,
    13,
    24,
    5,
    accent(2006),
  ),
  fila("27333", "HY ACC 06- VER XCITE EMPAQ", BOMBA, null, 0.64, 9, 24, 5, accent(2006)),
  fila("14894", "HY ACC 06- VER XCITE EMPAQ", BOMBA, "MOBIS", 3.19, 2, 24, 5, accent(2006)),
  fila("10576", "HY VER 00- XCITE PEQ D/H", POLEA, "MOBIS", 5.38, 2, 24, 1, verna(2000)),
  fila("6996", "HY VER 00- XCITE D/H", POLEA, "MOBIS", 10.02, 0, 24, 1, verna(2000)),
  fila(
    "5383",
    "HY VER 12V EXC 4G15 GWM17A MD-997076",
    BOMBA,
    "KOREA",
    19.58,
    2,
    24,
    0,
    verna(null),
  ),
  fila("12619", "CH COR EVOL 1.8", BOMBA, "BR", 21.32, 23, 24, -1, []),
  fila("25853", "OCPÁR", BOMBA, "GM", 110, 18, 24, -1, []),
];
