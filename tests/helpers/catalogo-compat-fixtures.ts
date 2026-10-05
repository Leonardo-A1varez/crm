import type { ElementoCompatibilidad, ModeloCatalogo } from "@/lib/catalogo/compatibilidad";

/**
 * Datos y consultas compartidos entre el test unitario (que corre la regla en
 * TypeScript, la del repo in-memory) y el de integración (que corre
 * `buscar_productos` en Postgres). Un solo juego de casos para los dos es lo que
 * impide que las dos implementaciones se separen sin que nadie se entere.
 *
 * TODO es inventado para el test: ni los productos ni el diccionario salen del
 * catálogo real.
 */

export const MODELOS: ModeloCatalogo[] = [
  {
    marca: "Hyundai",
    sigla_modelo: "ACC",
    nombre_real: "Hyundai Accent",
    alias: [],
    confianza: "alta",
    confirmado: false,
  },
  {
    marca: "Hyundai",
    sigla_modelo: "ACCENT",
    nombre_real: "Hyundai Accent",
    alias: [],
    confianza: "alta",
    confirmado: false,
  },
  {
    marca: "Hyundai",
    sigla_modelo: "VER",
    nombre_real: "Hyundai Accent Verna",
    alias: [],
    confianza: "alta",
    confirmado: false,
  },
  {
    marca: "Hyundai",
    sigla_modelo: "STA FE",
    nombre_real: "Hyundai Santa Fe",
    alias: ["santafe"],
    confianza: "alta",
    confirmado: false,
  },
  {
    marca: "Hyundai",
    sigla_modelo: "TUCS",
    nombre_real: "Hyundai Tucson 1a gen (JM)",
    alias: [],
    confianza: "alta",
    confirmado: false,
  },
  {
    marca: "Hyundai",
    sigla_modelo: "TUCS IX",
    nombre_real: "Hyundai Tucson ix / ix35 (LM)",
    alias: [],
    confianza: "alta",
    confirmado: false,
  },
  {
    marca: "Chevrolet",
    sigla_modelo: "AVEO",
    nombre_real: "Chevrolet Aveo",
    alias: [],
    confianza: "alta",
    confirmado: false,
  },
  // Sugerencia con confianza media y sin confirmar: NO se usa en la búsqueda.
  {
    marca: "Chevrolet",
    sigla_modelo: "COR",
    nombre_real: "Chevrolet Corsa",
    alias: [],
    confianza: "media",
    confirmado: false,
  },
  // Confianza baja pero confirmada por el dueño: SÍ se usa. Catalogada bajo
  // la marca Suzuki aunque el nombre real lleva "Chevrolet".
  {
    marca: "Suzuki",
    sigla_modelo: "VIT",
    nombre_real: "Chevrolet Vitara",
    alias: [],
    confianza: "baja",
    confirmado: true,
  },
  {
    marca: "Kia",
    sigla_modelo: "RIO",
    nombre_real: "Kia Rio",
    alias: [],
    confianza: "alta",
    confirmado: false,
  },
  // Un modelo con varias siglas en el inventario (PIC / PICANT / PICANTO).
  ...["PIC", "PICANT", "PICANTO"].map(
    (sigla_modelo): ModeloCatalogo => ({
      marca: "Kia",
      sigla_modelo,
      nombre_real: "Kia Picanto",
      alias: [],
      confianza: "alta",
      confirmado: false,
    }),
  ),
];

export interface ProductoCompat {
  codigo: string;
  nombre: string;
  compatibilidad: ElementoCompatibilidad[];
}

const el = (
  marca: string,
  modelo: string,
  anio_desde: number | null,
  anio_hasta: number | null,
  cilindrada: string | null,
  combustible: "GAS" | "DSL" | null,
  modelo_nombre?: string,
): ElementoCompatibilidad => ({
  marca,
  modelo,
  anio_desde,
  anio_hasta,
  cilindrada,
  combustible,
  ...(modelo_nombre ? { modelo_nombre } : {}),
});

export const PRODUCTOS: ProductoCompat[] = [
  {
    codigo: "P1",
    nombre: "TERMOSTATO HY ACCENT 1.4",
    compatibilidad: [el("Hyundai", "ACC", 2006, 2011, "1.4", "GAS")],
  },
  {
    codigo: "P2",
    nombre: "TERMOSTATO HY ACCENT 1.6",
    compatibilidad: [el("Hyundai", "ACC", 2006, 2011, "1.6", "GAS")],
  },
  {
    codigo: "P3",
    nombre: "TERMOSTATO HY ACCENT 12-",
    compatibilidad: [el("Hyundai", "ACC", 2012, null, "1.6", "GAS")],
  },
  {
    codigo: "P4",
    nombre: "TERMOSTATO HY ACCENT VIEJO",
    compatibilidad: [el("Hyundai", "ACC", null, 2005, null, null)],
  },
  {
    codigo: "P5",
    nombre: "TERMOSTATO KIA RIO",
    compatibilidad: [el("Kia", "RIO", 2012, 2017, "1.4", "GAS")],
  },
  { codigo: "P6", nombre: "TERMOSTATO SIN COMPAT", compatibilidad: [] },
  {
    codigo: "P7",
    nombre: "TERMOSTATO CH CORSA",
    compatibilidad: [el("Chevrolet", "COR", 2000, 2010, null, null)],
  },
  {
    codigo: "P8",
    nombre: "TERMOSTATO VITARA",
    compatibilidad: [el("Suzuki", "VIT", 1998, 2005, "1.6", "GAS")],
  },
  {
    codigo: "P9",
    nombre: "TERMOSTATO STA FE",
    compatibilidad: [
      el("Hyundai", "STA FE", 2010, 2012, "2.2", "DSL"),
      el("Hyundai", "STA FE", 2013, null, "2.4", "GAS"),
    ],
  },
  // Un mismo modelo escrito con distintas siglas en el inventario.
  {
    codigo: "P10",
    nombre: "TERMOSTATO KIA PICANT",
    compatibilidad: [el("Kia", "PICANT", 2012, null, "1.0", "GAS")],
  },
  {
    codigo: "P11",
    nombre: "TERMOSTATO KIA PIC",
    compatibilidad: [el("Kia", "PIC", 2010, 2014, "1.1", "GAS")],
  },
  // `MARCA TODOS`: sirve para cualquier modelo de la marca.
  {
    codigo: "P12",
    nombre: "TERMOSTATO KIA TODOS",
    compatibilidad: [el("Kia", "TODOS", null, null, null, null)],
  },
  // Sigla que el diccionario no conoce, pero con el nombre unificado que escribe el traductor.
  {
    codigo: "P13",
    nombre: "TERMOSTATO KIA SIGLA RARA",
    compatibilidad: [el("Kia", "PICAN", 2012, null, null, null, "Kia Picanto")],
  },
];

export interface ConsultaCompat {
  nombre: string;
  marca?: string;
  modelo?: string;
  anio?: number;
  cilindrada?: string;
  /** Códigos esperados, sin importar el orden. */
  esperados: string[];
}

export const CONSULTAS: ConsultaCompat[] = [
  {
    nombre: "sin vehículo: no filtra nada",
    esperados: ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "P12", "P13"],
  },
  {
    nombre: '"Accent" se resuelve a ACC (y a sus variantes), no a otros modelos',
    marca: "Hyundai",
    modelo: "Accent",
    esperados: ["P1", "P2", "P3", "P4", "P6"],
  },
  {
    nombre: "el modelo se resuelve aunque no venga la marca",
    modelo: "accent",
    esperados: ["P1", "P2", "P3", "P4", "P6"],
  },
  {
    nombre: "año dentro de un rango cerrado",
    marca: "Hyundai",
    modelo: "Accent",
    anio: 2008,
    esperados: ["P1", "P2", "P6"],
  },
  {
    nombre: "año en el borde del rango (el hasta es inclusivo)",
    marca: "Hyundai",
    modelo: "Accent",
    anio: 2011,
    esperados: ["P1", "P2", "P6"],
  },
  {
    nombre: "año en el borde inferior del rango (el desde es inclusivo)",
    marca: "Hyundai",
    modelo: "Accent",
    anio: 2006,
    esperados: ["P1", "P2", "P6"],
  },
  {
    nombre: "año justo en el desde de un rango sin fin",
    marca: "Hyundai",
    modelo: "Accent",
    anio: 2012,
    esperados: ["P3", "P6"],
  },
  {
    nombre: "año en un rango sin fin (anio_hasta nulo)",
    marca: "Hyundai",
    modelo: "Accent",
    anio: 2030,
    esperados: ["P3", "P6"],
  },
  {
    nombre: "año en un rango sin inicio (anio_desde nulo)",
    marca: "Hyundai",
    modelo: "Accent",
    anio: 1999,
    esperados: ["P4", "P6"],
  },
  {
    nombre: "cilindrada: descarta la otra, deja la que no declara cilindrada",
    marca: "Hyundai",
    modelo: "Accent",
    anio: 2003,
    cilindrada: "1.6",
    esperados: ["P4", "P6"],
  },
  {
    nombre: "cilindrada con año",
    marca: "Hyundai",
    modelo: "Accent",
    anio: 2008,
    cilindrada: "1.6",
    esperados: ["P2", "P6"],
  },
  {
    nombre: "cilindrada escrita con coma",
    marca: "Hyundai",
    modelo: "Accent",
    anio: 2008,
    cilindrada: "1,6",
    esperados: ["P2", "P6"],
  },
  {
    nombre: "un alias resuelve el modelo",
    modelo: "Santafe",
    esperados: ["P6", "P9"],
  },
  {
    nombre: "el nombre real con espacios resuelve la sigla con espacios",
    marca: "Hyundai",
    modelo: "Santa Fe",
    esperados: ["P6", "P9"],
  },
  {
    nombre: '"Tucson" sirve para todas las generaciones del diccionario',
    modelo: "Tucson",
    esperados: ["P6"],
  },
  {
    nombre:
      "modelo sin confirmar y con confianza media: no se resuelve y cae al texto del producto",
    modelo: "Corsa",
    esperados: ["P6", "P7"],
  },
  {
    nombre: "confirmado por el dueño aunque la confianza sea baja; la marca sale del nombre real",
    marca: "Chevrolet",
    modelo: "Vitara",
    esperados: ["P6", "P8"],
  },
  {
    nombre: "modelo desconocido: solo quedan las filas sin compatibilidad (no sabemos)",
    marca: "Hyundai",
    modelo: "Zzzmodel",
    esperados: ["P6"],
  },
  {
    nombre: "solo marca (incluye el TODOS de la marca)",
    marca: "Kia",
    esperados: ["P5", "P6", "P10", "P11", "P12", "P13"],
  },
  {
    nombre:
      "marca equivocada para un modelo resuelto: no mezcla marcas (solo queda el TODOS de Kia, que no es de ningún modelo)",
    marca: "Kia",
    modelo: "Accent",
    esperados: ["P6", "P12"],
  },
  {
    nombre:
      "modelo con varias siglas: Picanto resuelve PIC, PICANT y PICANTO, el TODOS de la marca y el modelo_nombre",
    modelo: "Picanto",
    esperados: ["P6", "P10", "P11", "P12", "P13"],
  },
  {
    nombre: "varias siglas con año: solo los rangos que lo incluyen (más TODOS y sin compat)",
    marca: "Kia",
    modelo: "Picanto",
    anio: 2013,
    esperados: ["P6", "P10", "P11", "P12", "P13"],
  },
  {
    nombre: "varias siglas con un año anterior a todos los rangos",
    marca: "Kia",
    modelo: "Picanto",
    anio: 2009,
    esperados: ["P6", "P12"],
  },
  {
    nombre: "varias siglas con cilindrada: descarta la 1.0, deja las que no declaran",
    marca: "Kia",
    modelo: "Picanto",
    anio: 2013,
    cilindrada: "1.1",
    esperados: ["P6", "P11", "P12", "P13"],
  },
  {
    nombre: "TODOS sirve para cualquier modelo resuelto de la marca",
    marca: "Kia",
    modelo: "Rio",
    esperados: ["P5", "P6", "P12"],
  },
  {
    nombre: "TODOS de una marca no sirve para modelos de otra marca",
    marca: "Hyundai",
    modelo: "Santa Fe",
    esperados: ["P6", "P9"],
  },
  {
    nombre: "TODOS no entra cuando el modelo no resuelve y no se dijo la marca",
    modelo: "Corsa",
    esperados: ["P6", "P7"],
  },
];
