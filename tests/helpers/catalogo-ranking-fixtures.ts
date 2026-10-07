import type { ElementoCompatibilidad } from "@/lib/catalogo/compatibilidad";

/**
 * Los 20 productos que `buscar_productos('termostato', Hyundai, Accent, 2006,
 * 20, '1.6')` devolvió en el stack local con el catálogo real del ERP cargado
 * (2026-10-07, 27.187 filas), tal como están ahí: código, nombre, categoría
 * (grupo del ERP), procedencia (`descripcion`), precio, existencia y
 * compatibilidad traducida. Es la conversación real del cliente que pidió "un
 * termostato para el Accent 1.6" y a quien el agente le cotizó el conjunto
 * completo sin ofrecerle el termostato suelto.
 *
 * Lo comparten el test unitario (repo in-memory) y el de integración
 * (`buscar_productos` en Postgres): un solo juego de datos para las dos
 * implementaciones.
 */

export interface ProductoReal {
  codigo: string;
  nombre: string;
  categoria: string;
  /** `productos.descripcion`: la procedencia, o basura (`52*88C`), o vacío. */
  descripcion: string | null;
  precio: number;
  stock: number;
  compatibilidad: ElementoCompatibilidad[];
}

const el = (
  modelo: string,
  modelo_nombre: string,
  anio_desde: number | null,
  anio_hasta: number | null,
  cilindrada: string | null,
): ElementoCompatibilidad => ({
  marca: "Hyundai",
  modelo,
  modelo_nombre,
  anio_desde,
  anio_hasta,
  cilindrada,
  combustible: null,
});

const ACC = "Hyundai Accent";
const VERNA = "Hyundai Accent Verna";
const ARMADO = "TERMOSTATO ARMADO Y TAPAS";
const SUELTO = "TERMOSTATOS";

export const TERMOSTATOS_REALES: ProductoReal[] = [
  // El termostato suelto: Accent desde 2006, sin cilindrada.
  {
    codigo: "9028",
    nombre: "HY ACC 06- VER GETZ TUCS MATRIX 54*82C",
    categoria: SUELTO,
    descripcion: "MOBIS",
    precio: 12.96,
    stock: 143,
    compatibilidad: [
      el("ACC", ACC, 2006, null, null),
      el("VER", VERNA, null, null, null),
      el("GETZ", "Hyundai Getz", null, null, null),
      el("TUCS", "Hyundai Tucson 1a gen (JM)", null, null, null),
      el("MATRIX", "Hyundai Matrix", null, null, null),
    ],
  },
  {
    codigo: "9015",
    nombre: "HY ACC 06- VER GETZ TUCS MATRIX 54*82C",
    categoria: SUELTO,
    descripcion: "KOREA",
    precio: 6.93,
    stock: 36,
    compatibilidad: [
      el("ACC", ACC, 2006, null, null),
      el("VER", VERNA, null, null, null),
      el("GETZ", "Hyundai Getz", null, null, null),
      el("TUCS", "Hyundai Tucson 1a gen (JM)", null, null, null),
      el("MATRIX", "Hyundai Matrix", null, null, null),
    ],
  },
  // El conjunto completo, la base y la tapa del Accent 1.6 desde 2006.
  {
    codigo: "19309",
    nombre: "HY ACC 1.6 06- CVVT COMPL",
    categoria: ARMADO,
    descripcion: "MOBIS",
    precio: 40.53,
    stock: 3,
    compatibilidad: [el("ACC", ACC, 2006, null, "1.6")],
  },
  {
    codigo: "14074",
    nombre: "HY ACC 1.6 06- CVVT COMPL",
    categoria: ARMADO,
    descripcion: "CHINA",
    precio: 16.12,
    stock: 2,
    compatibilidad: [el("ACC", ACC, 2006, null, "1.6")],
  },
  {
    codigo: "12090",
    nombre: "HY ACC 1.6 06- CVVT BASE TERMOST",
    categoria: ARMADO,
    descripcion: "MOBIS",
    precio: 24.82,
    stock: 3,
    compatibilidad: [el("ACC", ACC, 2006, null, "1.6")],
  },
  {
    codigo: "12089",
    nombre: "HY ACC 1.6 06- CVVT BASE TERMOST",
    categoria: ARMADO,
    descripcion: "KOREA",
    precio: 8.02,
    stock: 3,
    compatibilidad: [el("ACC", ACC, 2006, null, "1.6")],
  },
  {
    codigo: "16423",
    nombre: "HY ACC 1.6 06- CVVT TAPA 1 GRUESA",
    categoria: ARMADO,
    descripcion: "MOBIS",
    precio: 9.95,
    stock: 4,
    compatibilidad: [el("ACC", ACC, 2006, null, "1.6")],
  },
  {
    codigo: "20952",
    nombre: "HY ACC 1.6 06- CVVT TAPA 1 GRUESA",
    categoria: ARMADO,
    descripcion: "CHINA",
    precio: 5.77,
    stock: 2,
    compatibilidad: [el("ACC", ACC, 2006, null, "1.6")],
  },
  // Accent sin año ni cilindrada declarados: la compatibilidad no dice más.
  {
    codigo: "24570",
    nombre: "HY ACC VERNA 01-05 1.5 C/SENSOR",
    categoria: ARMADO,
    descripcion: "KOREA",
    precio: 24.7,
    stock: 5,
    compatibilidad: [el("ACC", ACC, null, null, null), el("VERNA", VERNA, 2001, 2005, "1.5")],
  },
  {
    codigo: "7606",
    nombre: "HY ACC VER 1.5 -05 12V 54*88°",
    categoria: SUELTO,
    descripcion: "MOBIS",
    precio: 10.34,
    stock: 3,
    compatibilidad: [el("ACC", ACC, null, null, null), el("VER", VERNA, null, 2005, "1.5")],
  },
  // Solo la variante Verna: sirve, pero no es el modelo que pidió el cliente.
  {
    codigo: "12088",
    nombre: "HY VER EMPA GRD TAPA",
    categoria: ARMADO,
    descripcion: "MOBIS",
    precio: 1.41,
    stock: 3,
    compatibilidad: [el("VER", VERNA, null, null, null)],
  },
  {
    codigo: "12005",
    nombre: "HY VER TOMA AGUA TAPA",
    categoria: ARMADO,
    descripcion: "MOBIS",
    precio: 11.37,
    stock: 3,
    compatibilidad: [el("VER", VERNA, null, null, null)],
  },
  // Sin compatibilidad cargada: "no sabemos".
  {
    codigo: "25530",
    nombre: "CH TAX ORING CARCASA TERMOSTATO",
    categoria: ARMADO,
    descripcion: "GM",
    precio: 0.75,
    stock: 6,
    compatibilidad: [],
  },
  {
    codigo: "11068",
    nombre: "CH COR TODOS EVOL",
    categoria: ARMADO,
    descripcion: null,
    precio: 12.05,
    stock: 23,
    compatibilidad: [],
  },
  {
    codigo: "10134",
    nombre: "CH COR TODOS EVOL",
    categoria: ARMADO,
    descripcion: "GM",
    precio: 38.41,
    stock: 14,
    compatibilidad: [],
  },
  {
    codigo: "14566",
    nombre: "MZ 2.2 2.6 INY VALVULA",
    categoria: SUELTO,
    descripcion: "52*88C",
    precio: 11.23,
    stock: 18,
    compatibilidad: [],
  },
  // El Accent 1.4 con la Verna sin cilindrada: entra por la Verna, pero el
  // Accent que declara es 1.4 y el cliente pidió 1.6.
  {
    codigo: "12249",
    nombre: "HY ACC 1.4 06- VER 03- BASE TERMOSTATO",
    categoria: ARMADO,
    descripcion: "MOBIS",
    precio: 25.11,
    stock: 6,
    compatibilidad: [el("ACC", ACC, 2006, null, "1.4"), el("VER", VERNA, 2003, null, null)],
  },
  {
    codigo: "22223",
    nombre: "HY ACC 1.4 06- VER 03- BASE TERMOSTATO",
    categoria: ARMADO,
    descripcion: "KOREA",
    precio: 17.47,
    stock: 3,
    compatibilidad: [el("ACC", ACC, 2006, null, "1.4"), el("VER", VERNA, 2003, null, null)],
  },
  {
    codigo: "13671",
    nombre: "HY ACC 1.4 06- VERNA GETZ COMPLETO",
    categoria: ARMADO,
    descripcion: "CHINA",
    precio: 27.22,
    stock: 9,
    compatibilidad: [
      el("ACC", ACC, 2006, null, "1.4"),
      el("VERNA", VERNA, null, null, null),
      el("GETZ", "Hyundai Getz", null, null, null),
    ],
  },
  {
    codigo: "18261",
    nombre: "HY ACC 1.4 06- VERNA GETZ COMPLETO",
    categoria: ARMADO,
    descripcion: "MOBIS",
    precio: 61.8,
    stock: 5,
    compatibilidad: [
      el("ACC", ACC, 2006, null, "1.4"),
      el("VERNA", VERNA, null, null, null),
      el("GETZ", "Hyundai Getz", null, null, null),
    ],
  },
];

/** La consulta exacta de la conversación real. */
export const CONSULTA_ACCENT_2006 = {
  q: "termostato",
  marca: "Hyundai",
  modelo: "Accent",
  anio: 2006,
  cilindrada: "1.6",
  tope: 20,
} as const;

/**
 * El orden correcto por escalones: lo que está en un escalón va antes que todo
 * lo del siguiente; adentro de un escalón el orden es el del puntaje y la
 * existencia, que no se fija acá.
 */
export const ESCALONES_ESPERADOS: string[][] = [
  // Accent, año 2006 y cilindrada 1.6 declarados (la base, la tapa y el conjunto).
  ["19309", "14074", "12090", "12089", "16423", "20952"],
  // Accent desde 2006 sin cilindrada: el termostato suelto.
  ["9028", "9015"],
  // Accent sin año ni cilindrada declarados.
  ["24570", "7606"],
  // Solo la variante Verna.
  ["12088", "12005"],
  // Sin compatibilidad cargada: no sabemos.
  ["25530", "11068", "10134", "14566"],
  // Declaran un Accent de otra cilindrada y solo entran por la Verna.
  ["12249", "22223", "13671", "18261"],
];
