import { construirDiferencias } from "@/lib/catalogo/compatibilidad";
import type { ProductoSearchHit } from "@/server/repositories/productos.repo";
import { armarSalida } from "@/server/services/catalog-matcher.service";
import type { AgentVehiculo } from "@/server/services/ai-agent.service";
import type {
  BuscarRepuestoInput,
  BuscarRepuestoMatch,
  BuscarRepuestoOutput,
} from "@/lib/validation/ai";
import { BOMBA_DE_AGUA_ACCENT_2006 } from "../../helpers/catalogo-bomba-agua-accent-fixtures";
import { BOMBA_DE_AGUA_RIO_18 } from "../../helpers/catalogo-bomba-agua-fixtures";
import { MARCAS } from "../../helpers/catalogo-marcas-fixtures";
import { ESCALONES_ESPERADOS, TERMOSTATOS_REALES } from "../../helpers/catalogo-ranking-fixtures";

/**
 * Casos del eval del agente vendedor. Para agregar uno: un objeto más en
 * `CASOS` (abajo), con `origen` obligatorio y sus `verificaciones` armadas con
 * los helpers de `./verificaciones`. Nada más hay que tocar.
 *
 * `origen`:
 *   - "real": el turno del cliente sale de un mensaje que llegó de verdad a
 *     crm-dev (leído de `mensajes`, sin teléfono ni nombres). El catálogo del
 *     stub puede incluir datos que NO son reales; cada caso lo aclara en
 *     `notaOrigen`.
 *   - "inventado": escrito a mano para cubrir un comportamiento. No es un
 *     mensaje de un cliente real.
 */

export type Origen = "real" | "inventado";

/** Una búsqueda que el agente hizo y lo que el stub le devolvió. */
export interface BusquedaHecha {
  args: BuscarRepuestoInput;
  matches: BuscarRepuestoMatch[];
}

/** Lo que una verificación mira: la respuesta, las búsquedas y el catálogo del stub. */
export interface ResultadoTurno {
  texto: string;
  busquedas: BusquedaHecha[];
  /** Todos los productos que el stub puede devolver en este caso. */
  catalogo: BuscarRepuestoMatch[];
  /** El turno de entrada tal cual lo vio el agente. */
  turno: string[];
}

/** `null` = pasa. Un string = por qué falló, escrito para quien lee el reporte. */
export type Verificacion = (r: ResultadoTurno) => string | null;

export interface CasoAgente {
  id: string;
  origen: Origen;
  /** Qué comportamiento protege este caso. */
  proposito: string;
  /** Solo para "real": qué parte es real y qué parte no. */
  notaOrigen?: string;
  /** Líneas `lead: ...` / `ia: ...`, la última es el mensaje a contestar. */
  turno: string[];
  /** Autos guardados del cliente, el vigente primero (como los arma `vehiculosParaAgente`). */
  vehiculos?: AgentVehiculo[];
  consultaPrevia?: string;
  /** Qué devuelve el stub de `buscar_repuesto` para cualquier búsqueda. */
  catalogo: BuscarRepuestoMatch[];
  /**
   * Lo que la tool real calcula con la compatibilidad de los candidatos (ver
   * `diferenciasEntre`): el stub lo devuelve tal cual junto a los matches. Sin
   * esto el agente nunca ve en qué se diferencian y el caso no mide la regla.
   */
  diferencias?: BuscarRepuestoOutput["diferencias"];
  /**
   * La salida completa de la herramienta, armada con la función de producción
   * (`armarSalida`) sobre filas reales. Si está, el stub la devuelve tal cual y
   * `catalogo` / `diferencias` se ignoran para armar la respuesta.
   */
  salida?: BuscarRepuestoOutput;
  verificaciones: Verificacion[];
}

import {
  anioEn,
  argumento,
  buscaAlgunaVez,
  derivaAHumano,
  mencionaIva,
  ningunaBusquedaCon,
  noBusca,
  noInventaCodigos,
  noInventaPrecios,
  noAfirmaTener,
  noOfreceDescuento,
  noPrometeDisponibilidad,
  noVuelveAPedirElModelo,
  pideAclaracion,
  pideDato,
  pideVehiculo,
  siBusca,
  sinAnioEnNingunaBusqueda,
  sinCotizar,
  citaPrecio,
  dice,
  citaOpcion,
  citaProcedenciaConPrecio,
  noCitaPrecios,
  preguntaPieza,
  noMenciona,
  noRepregunta,
  sinCodigosDeProducto,
  sinRangoDePrecios,
} from "./verificaciones";

let n = 0;
/** Producto del stub. Los ids son UUID deterministas; el código y el precio los pone el caso. */
function prod(
  codigo: string,
  nombre: string,
  precio: number,
  stock: number,
  extra: Partial<BuscarRepuestoMatch> = {},
): BuscarRepuestoMatch {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    codigo_interno: codigo,
    nombre,
    precio,
    stock,
    ...extra,
  };
}

// En la conversación real la herramienta se llamó con marca Kia y año 2018: el
// auto ya estaba identificado para el agente. Se reproduce como auto guardado.
const RIO_2018: AgentVehiculo = {
  marca: "Kia",
  modelo: "Rio",
  anio: 2018,
  motor: null,
  actual: true,
};

const AVEO_2005: AgentVehiculo = {
  marca: "Chevrolet",
  modelo: "Aveo",
  anio: 2005,
  motor: "1.6",
  actual: true,
};

// Los datos de este radiador (código, nombre, precio) salen de la respuesta
// real que dio el agente el 2026-10-01 en crm-dev.
const RADIADOR_AVEO = prod("96817344/CH", "RADIADOR CH AVEO 1.6 (05-09)", 37.13, 3);

/**
 * Los candidatos de 'termostato para el Accent 1.6, 2006' en el orden y con el
 * nivel de vehículo que devolvió `buscar_productos` (tests/helpers/
 * catalogo-ranking-fixtures.ts), pasados por la función de producción que arma
 * lo que ve el agente.
 */
const NIVELES_ESCALONES = [7, 5, 4, 0, -1, -2];
const HITS_ACCENT_2006: ProductoSearchHit[] = ESCALONES_ESPERADOS.flatMap((codigos, i) =>
  codigos.map((codigo, j): ProductoSearchHit => {
    const p = TERMOSTATOS_REALES.find((x) => x.codigo === codigo);
    if (!p) throw new Error(`falta el producto real ${codigo} en los fixtures`);
    return {
      id: `00000000-0000-4000-9000-${String(i * 10 + j + 1).padStart(12, "0")}`,
      codigo_interno: p.codigo,
      codigo_fabrica: null,
      nombre: p.nombre,
      categoria: p.categoria,
      descripcion: p.descripcion,
      precio: p.precio,
      stock: p.stock,
      puntaje: 12,
      nivel_vehiculo: NIVELES_ESCALONES[i] ?? 0,
      compatibilidad: p.compatibilidad,
    };
  }),
);
const DADO_ACCENT_2006 = { anio: 2006, cilindrada: "1.6" };
const VEHICULO_ACCENT = { marca: "Hyundai", modelo: "Accent" };
// «termostato» es exactamente la categoría TERMOSTATOS: se cotiza sola y la base,
// la tapa y el conjunto se nombran sin precio.
const SALIDA_ACCENT_2006: BuscarRepuestoOutput = armarSalida(
  HITS_ACCENT_2006,
  DADO_ACCENT_2006,
  { query: "termostato", ...VEHICULO_ACCENT },
  MARCAS,
);
// Después de «la base nomás» el agente busca la base: ahora la exacta es esa.
const SALIDA_ACCENT_2006_BASE: BuscarRepuestoOutput = armarSalida(
  HITS_ACCENT_2006,
  DADO_ACCENT_2006,
  { query: "base de termostato", ...VEHICULO_ACCENT },
  MARCAS,
);
// «termostato completo» pide a la vez el termostato y el conjunto: hay que elegir.
const SALIDA_ACCENT_2006_COMPLETO: BuscarRepuestoOutput = armarSalida(
  HITS_ACCENT_2006,
  DADO_ACCENT_2006,
  { query: "termostato completo", ...VEHICULO_ACCENT },
  MARCAS,
);

/**
 * Los candidatos de 'bomba de agua para el accent 2006' (SELECT de solo lectura de
 * crm-dev, tests/helpers/catalogo-bomba-agua-accent-fixtures.ts) pasados por la
 * función de producción.
 */
const HITS_BOMBA_ACCENT_2006: ProductoSearchHit[] = BOMBA_DE_AGUA_ACCENT_2006.map(
  (p, i): ProductoSearchHit => ({
    id: `00000000-0000-4000-b000-${String(i + 1).padStart(12, "0")}`,
    codigo_interno: p.codigo,
    codigo_fabrica: null,
    nombre: p.nombre,
    categoria: p.categoria,
    descripcion: p.descripcion,
    precio: p.precio,
    stock: p.stock,
    puntaje: p.puntaje,
    nivel_vehiculo: p.nivel_vehiculo,
    compatibilidad: p.compatibilidad,
  }),
);
const SALIDA_BOMBA_ACCENT_2006: BuscarRepuestoOutput = armarSalida(
  HITS_BOMBA_ACCENT_2006,
  { anio: 2006 },
  { query: "bomba de agua", ...VEHICULO_ACCENT },
  MARCAS,
);

/**
 * Lo que la herramienta devuelve cuando todavía hay algo que preguntar (año,
 * cilindrada, combustible): sin precio, como en producción.
 */
const sinPrecios = (matches: BuscarRepuestoMatch[]): BuscarRepuestoMatch[] =>
  matches.map(({ precio: _precio, marca: _marca, procedencia: _procedencia, ...resto }) => resto);

/**
 * Los candidatos de 'bomba de agua para el Rio 18' que devolvió `buscar_productos`
 * (filas de crm-dev, tests/helpers/catalogo-bomba-agua-fixtures.ts), pasados por
 * la función de producción con lo que el agente buscó en cada turno.
 */
const PUNTAJE_BOMBA: Record<string, number> = {
  "BOMBA DE AGUA": 60,
  "POLEA BOMBA AGUA E HIDRAU": 50,
};
const HITS_BOMBA_RIO_18: ProductoSearchHit[] = BOMBA_DE_AGUA_RIO_18.map(
  (p, i): ProductoSearchHit => ({
    id: `00000000-0000-4000-a000-${String(i + 1).padStart(12, "0")}`,
    codigo_interno: p.codigo,
    codigo_fabrica: null,
    nombre: p.nombre,
    categoria: p.categoria,
    descripcion: p.descripcion,
    precio: p.precio,
    stock: p.stock,
    puntaje: PUNTAJE_BOMBA[p.categoria] ?? 30,
    nivel_vehiculo: p.compatibilidad.some((c) => c.anio_desde !== null) ? 5 : 4,
    compatibilidad: p.compatibilidad,
  }),
);
const SALIDA_BOMBA_T1 = armarSalida(
  HITS_BOMBA_RIO_18,
  { anio: 2018 },
  { query: "bomba de agua", marca: "Kia", modelo: "Rio" },
  MARCAS,
);
const SALIDA_BOMBA_T2 = armarSalida(
  HITS_BOMBA_RIO_18,
  { anio: 2018 },
  { query: "bomba de agua completa", marca: "Kia", modelo: "Rio" },
  MARCAS,
);

export const CASOS: CasoAgente[] = [
  // ───────────────────────── Derivados de mensajes reales ─────────────────────────
  {
    id: "real-radiador-aveo-con-auto-guardado",
    origen: "real",
    proposito:
      "Con un Aveo 2005 guardado y el cliente sin nombrar año, busca con marca/modelo/año del auto guardado (regresión: cotizaba el Aveo 2005 como 2023).",
    notaOrigen:
      "Mensaje real del 2026-10-01. El auto guardado y el catálogo del stub son los de esa conversación (radiador 96817344/CH a 37,13 sale de la respuesta real del agente).",
    turno: ["lead: Necesito un radiador para el aveo activo"],
    vehiculos: [AVEO_2005],
    catalogo: [RADIADOR_AVEO],
    verificaciones: [
      buscaAlgunaVez(),
      argumento("modelo", "aveo"),
      argumento("anio", 2005),
      citaPrecio(37.13),
      mencionaIva(),
      noInventaCodigos(),
    ],
  },
  {
    id: "real-radiador-aveo-sin-auto-guardado",
    origen: "real",
    proposito:
      "Regla del dueño 2026-10-05: solo pide el vehículo si no hay ninguno guardado NI nombrado. Acá el cliente nombra el Aveo: busca ya y no vuelve a pedir el modelo (si algo difiere, pregunta solo eso).",
    notaOrigen:
      "Mensaje real del 2026-08-15 (típico del turno anterior al auto guardado). Catálogo del stub: el radiador real.",
    turno: ["lead: Busco radiador para el aveo"],
    catalogo: [RADIADOR_AVEO],
    verificaciones: [
      buscaAlgunaVez(),
      argumento("modelo", "aveo"),
      noVuelveAPedirElModelo(),
      noInventaPrecios(),
      noInventaCodigos(),
    ],
  },
  {
    id: "real-radiador-aveo-activo-sin-stock",
    origen: "real",
    proposito:
      "Catálogo sin coincidencias: dice que no lo tiene y no inventa precio ni código ni stock.",
    notaOrigen:
      'Mensaje real del 2026-08-15, con su typo ("radiator para e aveo activo"). Stub vacío. El Aveo 2005 guardado NO es real de ese mensaje: se agrega para que el caso pruebe el "sin resultados" y no la pregunta por el vehículo.',
    turno: ["lead: Busco un radiator para e aveo activo"],
    vehiculos: [AVEO_2005],
    catalogo: [],
    verificaciones: [buscaAlgunaVez(), noPrometeDisponibilidad(), sinCotizar(), noInventaCodigos()],
  },
  {
    id: "real-axial-mazda-allegro",
    origen: "real",
    proposito:
      'Pieza en texto de catálogo ("RH 00- MZ ALEG") con el catálogo vacío: busca con marca Mazda y no inventa.',
    notaOrigen: "Mensaje real del 2026-08-15, tal cual. Stub vacío.",
    turno: ["lead: Necesito un axial de direccion para el Mazda alegro RH 00- MZ ALEG"],
    catalogo: [],
    verificaciones: [
      buscaAlgunaVez(),
      argumento("marca", "mazda"),
      noPrometeDisponibilidad(),
      sinCotizar(),
      noInventaCodigos(),
    ],
  },
  {
    id: "real-pregunta-por-codigo",
    origen: "real",
    proposito:
      "El cliente pregunta por un código exacto que sí está: si busca, confirma el precio con IVA; si en cambio pide el vehículo, también es válido (la regla del dueño no distingue códigos). Nunca inventa.",
    notaOrigen: 'Mensaje real del 2026-08-15 ("Tenes el 96817344/CH"). Catálogo: el radiador real.',
    turno: ["lead: Tenes el 96817344/CH"],
    catalogo: [RADIADOR_AVEO],
    verificaciones: [
      noInventaCodigos(),
      noInventaPrecios(),
      siBusca(citaPrecio(37.13), mencionaIva()),
    ],
  },
  {
    id: "real-aceite-con-auto-guardado",
    origen: "real",
    proposito: "Lista de aceites: solo cita precios del catálogo, con IVA, sin códigos inventados.",
    notaOrigen:
      'Mensaje real del 2026-08-15 ("Necesito un aceite"). Nombres y precios son los de la respuesta real del agente; los códigos AC-xxx son INVENTADOS porque no los tengo.',
    turno: ["lead: Necesito un aceite"],
    vehiculos: [AVEO_2005],
    catalogo: [
      prod("AC-001", "ACEITE 10W30 1/4", 5.65, 20),
      prod("AC-002", "ACEITE 10W30 GAL", 22.9, 8),
      prod("AC-003", "ACEITE 5W30 1/4", 7.19, 15),
      prod("AC-004", "ACEITE 5W30 GAL", 27.87, 6),
    ],
    verificaciones: [buscaAlgunaVez(), mencionaIva(), noInventaPrecios(), noInventaCodigos()],
  },
  {
    id: "real-factura-con-ruc",
    origen: "real",
    proposito: "Pedido que no es de repuestos: no busca en catálogo ni cotiza nada.",
    notaOrigen: "Mensaje real del 2026-08-16. Stub con el radiador por si el agente se desvía.",
    turno: ["lead: Necesito factura con RUC para la compra"],
    catalogo: [RADIADOR_AVEO],
    verificaciones: [noBusca(), sinCotizar()],
  },
  {
    id: "real-saludo",
    origen: "real",
    proposito: "Un saludo suelto: no busca, no cotiza y pregunta qué necesita.",
    notaOrigen: 'Mensaje real ("Hola", varias veces en crm-dev).',
    turno: ["lead: Hola"],
    catalogo: [RADIADOR_AVEO],
    verificaciones: [noBusca(), sinCotizar(), pideAclaracion()],
  },
  {
    id: "real-termostato-accent-cotiza-el-termostato",
    origen: "real",
    proposito:
      "Regla del dueño 2026-10-07: 'termostato para el Accent 1.6' + año. La categoría TERMOSTATOS es exactamente lo pedido: cotiza solo esas opciones (MOBIS (Original) $12,96 · KOREA $6,93), sin rangos, y ofrece la base y el conjunto por su nombre, sin precios (regresión: cotizó el rango del conjunto armado y nunca ofreció el termostato suelto).",
    notaOrigen:
      "Primer mensaje y año ('2006') reales de crm-dev, 2026-10-06. La pregunta del medio es reconstruida. La salida de la tool es la de producción (`armarSalida`) sobre las filas reales del catálogo del ERP que devolvió la búsqueda de esa conversación (tests/helpers/catalogo-ranking-fixtures.ts).",
    turno: [
      "lead: Necesito un termostato para el Accent 1.6",
      "ia: ¿De qué año es tu Accent?",
      "lead: 2006",
    ],
    catalogo: SALIDA_ACCENT_2006.matches,
    salida: SALIDA_ACCENT_2006,
    verificaciones: [
      buscaAlgunaVez(),
      argumento("modelo", "accent"),
      citaOpcion("MOBIS", "Original", 12.96),
      citaProcedenciaConPrecio("KOREA", 6.93),
      mencionaIva(),
      dice(/(base|conjunto)/, "debería ofrecer la base o el conjunto por su nombre"),
      noCitaPrecios([40.53, 16.12, 24.82, 8.02, 9.95, 5.77], "la base, la tapa o el conjunto"),
      sinRangoDePrecios(),
      sinCodigosDeProducto(),
      noInventaPrecios(),
    ],
  },
  {
    id: "inv-termostato-completo-sigue-pidiendo-la-pieza",
    origen: "inventado",
    proposito:
      "'Termostato completo' pide a la vez el termostato suelto y el conjunto armado: no hay una sola pieza exacta, así que pregunta cuál y la herramienta no le da precios (no puede listarlos).",
    notaOrigen:
      "El turno del cliente es inventado. Catálogo: las filas reales del caso 'real-termostato-accent-cotiza-el-termostato', con la consulta 'termostato completo'.",
    turno: [
      "lead: Necesito un termostato completo para el Accent 1.6",
      "ia: ¿De qué año es tu Accent?",
      "lead: 2006",
    ],
    catalogo: SALIDA_ACCENT_2006_COMPLETO.matches,
    salida: SALIDA_ACCENT_2006_COMPLETO,
    verificaciones: [
      buscaAlgunaVez(),
      preguntaPieza(),
      noMenciona(/\$|\d+[.,]\d{2}/, "dio un precio sin que la herramienta se los diera"),
      sinCotizar(),
      noInventaCodigos(),
    ],
  },
  {
    id: "real-bomba-de-agua-rio-18-cotiza-y-ofrece-polea",
    origen: "real",
    proposito:
      "Regla del dueño 2026-10-07: 'una bomba de agua para el Rio 18' cotiza solo la bomba (MOBIS (Original) $96,66 · JUNGWOO (Korea) $21,51) y nombra la polea sin precio; nunca los manguitos ni la bomba de combustible, que entran por una palabra suelta.",
    notaOrigen:
      "El mensaje del cliente es real (crm-dev, 2026-10-07 04:15 UTC, sin datos personales); el auto guardado Kia Rio 2018 es reconstruido (se deduce de los argumentos reales de la herramienta). La salida de la tool es la de producción (`armarSalida`) sobre filas reales de crm-dev recortadas a las que sirven para un Kia Rio 2018 (tests/helpers/catalogo-bomba-agua-fixtures.ts).",
    turno: ["lead: Necesito Una bomba de agua para el rio 18"],
    vehiculos: [RIO_2018],
    catalogo: SALIDA_BOMBA_T1.matches,
    salida: SALIDA_BOMBA_T1,
    verificaciones: [
      buscaAlgunaVez(),
      argumento("modelo", "rio"),
      citaOpcion("MOBIS", "Original", 96.66),
      citaOpcion("JUNGWOO", "Korea", 21.51),
      mencionaIva(),
      dice(/polea/, "debería ofrecer la polea por su nombre"),
      noCitaPrecios([7.72, 41.43], "la polea"),
      noMenciona(
        /(mangu|manguer|radiador|combustible|inyec|gasolina)/,
        "ofreció una pieza que no tiene sentido",
      ),
      sinCodigosDeProducto(),
      noInventaPrecios(),
    ],
  },
  {
    id: "real-bomba-de-agua-accent-2006-cotiza-solo-la-bomba",
    origen: "real",
    proposito:
      "Falla real 2026-10-07 16:52 UTC: 'bomba de agua para el accent 2006' devolvió bombas, poleas y empaques, y el agente cotizó 4 precios mezclados sin decir qué pieza (JUNGWOO $22,01 · MOBIS $66,18 eran las bombas; $0,64 y $3,19 eran empaques). Ahora cotiza solo las bombas (JUNGWOO (Korea) $22,01 · MOBIS (Original) $66,18) y nombra la polea y el empaque sin precio.",
    notaOrigen:
      "El mensaje del cliente es real (crm-dev, sin datos personales). La salida de la tool es la de producción (`armarSalida`) sobre filas reales de crm-dev leídas con SELECT de solo lectura (tests/helpers/catalogo-bomba-agua-accent-fixtures.ts).",
    turno: ["lead: Necesito Una bomba de agua para el accent 2006"],
    catalogo: SALIDA_BOMBA_ACCENT_2006.matches,
    salida: SALIDA_BOMBA_ACCENT_2006,
    verificaciones: [
      buscaAlgunaVez(),
      argumento("modelo", "accent"),
      citaOpcion("JUNGWOO", "Korea", 22.01),
      citaOpcion("MOBIS", "Original", 66.18),
      mencionaIva(),
      noCitaPrecios(
        [0.64, 3.19, 7.16, 5.38, 10.02, 19.58, 21.32, 110],
        "los empaques, la polea u otra bomba",
      ),
      sinRangoDePrecios(),
      sinCodigosDeProducto(),
      noInventaPrecios(),
    ],
  },
  {
    id: "real-bomba-de-agua-rio-18-completa-cotiza",
    origen: "real",
    proposito:
      "Después de que el cliente elige 'la bomba de agua completa', cotiza las opciones como MARCA (Procedencia) $precio con IVA (MOBIS (Original) $96,66 · JUNGWOO (Korea) $21,51), sin volver a preguntar y sin precios de la polea, los manguitos ni la bomba de combustible.",
    notaOrigen:
      "Los dos mensajes del cliente son reales (crm-dev, 2026-10-07 04:15 y 04:18 UTC). La pregunta de la IA del medio es reconstruida, y el auto guardado Kia Rio 2018 también (se deduce de los argumentos reales de la herramienta: marca Kia, año 2018). La salida de la tool es la de producción sobre las filas reales de crm-dev (tests/helpers/catalogo-bomba-agua-fixtures.ts), para la búsqueda 'bomba de agua completa'.",
    turno: [
      "lead: Necesito Una bomba de agua para el rio 18",
      "ia: ¿Necesitás la bomba de agua completa o la polea de la bomba?",
      "lead: La bomba de agua completa",
    ],
    vehiculos: [RIO_2018],
    catalogo: SALIDA_BOMBA_T2.matches,
    salida: SALIDA_BOMBA_T2,
    verificaciones: [
      buscaAlgunaVez(),
      citaOpcion("MOBIS", "Original", 96.66),
      citaOpcion("JUNGWOO", "Korea", 21.51),
      mencionaIva(),
      noRepregunta(),
      sinCodigosDeProducto(),
      noCitaPrecios(
        [7.72, 41.43, 12.53, 7.18, 10.78, 9.66, 12.98, 48.41, 69.7, 347.03],
        "la polea, los manguitos o la bomba de combustible",
      ),
      noInventaPrecios(),
    ],
  },
  {
    id: "inv-termostato-accent-solo-el-termostato",
    origen: "inventado",
    proposito:
      "Después de preguntar la pieza, el cliente dice 'solo el termostato': cotiza el termostato suelto, una opción por marca y procedencia con su precio (MOBIS (Original) $12,96 · KOREA $6,93: la segunda es solo un país, sin marca), con IVA, sin rangos, sin códigos y sin precios del conjunto, la base ni la tapa.",
    notaOrigen:
      "El turno del cliente es inventado (así lo espera el dueño). Catálogo: las filas reales del caso 'real-termostato-accent-pide-la-pieza'.",
    turno: [
      "lead: Necesito un termostato para el Accent 1.6",
      "ia: ¿De qué año es tu Accent?",
      "lead: 2006",
      "ia: ¿Necesitás solo el termostato, la base/tapa o el conjunto completo?",
      "lead: solo el termostato",
    ],
    catalogo: SALIDA_ACCENT_2006.matches,
    salida: SALIDA_ACCENT_2006,
    verificaciones: [
      buscaAlgunaVez(),
      citaOpcion("MOBIS", "Original", 12.96),
      citaProcedenciaConPrecio("KOREA", 6.93),
      mencionaIva(),
      sinRangoDePrecios(),
      noCitaPrecios([40.53, 16.12, 24.82, 8.02, 9.95, 5.77], "el conjunto, la base o la tapa"),
      sinCodigosDeProducto(),
      noInventaPrecios(),
    ],
  },
  {
    id: "inv-termostato-accent-solo-la-base",
    origen: "inventado",
    proposito:
      "El cliente elige la base: presenta las opciones de esa pieza (MOBIS (Original) $24,82 · KOREA $8,02), sin rangos ni códigos y sin los precios de otras piezas.",
    notaOrigen:
      "El turno del cliente es inventado. Catálogo: las filas reales del caso 'real-termostato-accent-pide-la-pieza'.",
    turno: [
      "lead: Necesito un termostato para el Accent 1.6",
      "ia: ¿De qué año es tu Accent?",
      "lead: 2006",
      "ia: ¿Necesitás solo el termostato, la base/tapa o el conjunto completo?",
      "lead: la base nomás",
    ],
    catalogo: SALIDA_ACCENT_2006_BASE.matches,
    salida: SALIDA_ACCENT_2006_BASE,
    verificaciones: [
      buscaAlgunaVez(),
      citaOpcion("MOBIS", "Original", 24.82),
      citaProcedenciaConPrecio("KOREA", 8.02),
      mencionaIva(),
      sinRangoDePrecios(),
      noCitaPrecios([40.53, 16.12, 12.96, 6.93, 9.95, 5.77], "otra pieza"),
      sinCodigosDeProducto(),
      noInventaPrecios(),
    ],
  },

  {
    id: "inv-bomba-marca-sin-procedencia-y-pais-sin-marca",
    origen: "inventado",
    proposito:
      "Regla del dueño 2026-10-07: «MARCA (Procedencia) $precio» solo con lo que trae la herramienta. Una opción con marca y sin procedencia se dice «TAIHO $30,40» (sin paréntesis ni país inventado) y una opción que es solo un país se dice «China $25,90».",
    notaOrigen:
      "Inventado: la herramienta devuelve dos opciones de la misma pieza, una con `marca` TAIHO sin `procedencia` (marca de origen desconocido) y otra con `procedencia` China sin `marca`. Nombres de pieza y precios no son reales.",
    turno: ["lead: Necesito una bomba de agua para el Rio 2018", "ia: ¿Completa?", "lead: sí"],
    vehiculos: [RIO_2018],
    catalogo: [
      prod("BA-INV-1", "BOMBA DE AGUA KIA RIO 18-", 30.4, 5, { marca: "TAIHO" }),
      prod("BA-INV-2", "BOMBA DE AGUA KIA RIO 18-", 25.9, 3, { procedencia: "China" }),
    ],
    diferencias: construirDiferencias([], {}, ["TAIHO", "China"]),
    verificaciones: [
      buscaAlgunaVez(),
      citaProcedenciaConPrecio("TAIHO", 30.4),
      citaProcedenciaConPrecio("China", 25.9),
      noMenciona(/taiho\s*\(/, "le inventó una procedencia a TAIHO"),
      noMenciona(
        /(korea|japon|original|alemania|francia|india|taiwan)/,
        "inventó una procedencia que la herramienta no trajo",
      ),
      mencionaIva(),
      sinRangoDePrecios(),
      sinCodigosDeProducto(),
      noInventaPrecios(),
    ],
  },

  // ───────────────────────────── Inventados ─────────────────────────────
  {
    id: "inv-otro-auto-con-anio",
    origen: "inventado",
    proposito:
      "El cliente nombra OTRO auto (Corolla 2012) con un Aveo guardado: busca el Corolla y no usa el Aveo.",
    turno: ["lead: Necesito pastillas de freno para un Corolla 2012"],
    vehiculos: [AVEO_2005],
    catalogo: [prod("PF-100", "PASTILLAS FRENO DEL TOYOTA COROLLA 09-13", 28.4, 5)],
    verificaciones: [
      buscaAlgunaVez(),
      argumento("modelo", "corolla"),
      argumento("anio", 2012),
      ningunaBusquedaCon("modelo", "aveo"),
      ningunaBusquedaCon("anio", 2005),
    ],
  },
  {
    id: "inv-otro-auto-sin-anio",
    origen: "inventado",
    proposito:
      "El cliente nombra otro auto sin año (Sail): no le hereda el año 2005 del Aveo guardado.",
    turno: ["lead: Ahora busco un filtro de aceite para mi Sail"],
    vehiculos: [AVEO_2005],
    catalogo: [prod("FA-210", "FILTRO ACEITE CHEVROLET SAIL", 6.2, 14)],
    verificaciones: [
      buscaAlgunaVez(),
      argumento("modelo", "sail"),
      ningunaBusquedaCon("anio", 2005),
      ningunaBusquedaCon("modelo", "aveo"),
    ],
  },
  {
    id: "inv-auto-guardado-sin-anio",
    origen: "inventado",
    proposito: "El auto guardado no tiene año: busca sin año en vez de inventarlo.",
    turno: ["lead: Necesito un filtro de aire"],
    vehiculos: [{ marca: "Chevrolet", modelo: "Aveo", anio: null, motor: null, actual: true }],
    catalogo: [prod("FAIR-050", "FILTRO AIRE CHEVROLET AVEO", 9.9, 7)],
    verificaciones: [buscaAlgunaVez(), argumento("modelo", "aveo"), sinAnioEnNingunaBusqueda()],
  },
  {
    id: "inv-precio-con-iva",
    origen: "inventado",
    proposito: "Cuando da un precio, aclara IVA incluido y el monto es el del catálogo.",
    turno: ["lead: Cuanto cuesta el filtro de aire para Chevrolet Spark 2014?"],
    catalogo: [prod("FAIR-077", "FILTRO AIRE CHEVROLET SPARK 11-15", 8.5, 12)],
    verificaciones: [buscaAlgunaVez(), citaPrecio(8.5), mencionaIva(), noInventaCodigos()],
  },
  {
    id: "inv-stock-cero",
    origen: "inventado",
    proposito: "El producto existe pero con stock 0: no promete disponibilidad.",
    turno: ["lead: Tienen amortiguador delantero para el Aveo 2008?"],
    catalogo: [prod("AMD-300", "AMORTIGUADOR DEL CHEVROLET AVEO 08-12", 41.0, 0)],
    verificaciones: [buscaAlgunaVez(), noPrometeDisponibilidad(), noInventaCodigos()],
  },
  {
    id: "inv-solo-hay-otra-pieza",
    origen: "inventado",
    proposito:
      "Piden pastillas y el catálogo solo devuelve discos: puede ofrecer los discos como discos, pero no afirma tener pastillas ni inventa.",
    turno: ["lead: Necesito pastillas de freno para el Aveo 2007"],
    catalogo: [prod("DF-400", "DISCO FRENO DEL CHEVROLET AVEO 04-09", 33.5, 4)],
    verificaciones: [
      buscaAlgunaVez(),
      noInventaCodigos(),
      noInventaPrecios(),
      noAfirmaTener(/pastilla/, "pastillas"),
    ],
  },
  {
    id: "inv-pieza-ambigua-sin-auto",
    origen: "inventado",
    proposito:
      "Decisión del dueño 2026-10-05: pedido ambiguo y sin auto: pide el vehículo antes de buscar; no busca ni cotiza.",
    turno: ["lead: Necesito un sensor"],
    catalogo: [prod("SEN-500", "SENSOR OXIGENO UNIVERSAL", 55.0, 2)],
    verificaciones: [noBusca(), pideVehiculo(), sinCotizar(), noInventaCodigos()],
  },
  {
    id: "inv-garantia",
    origen: "inventado",
    proposito: "Reclamo de garantía: lo deriva a un humano y no promete ni cotiza.",
    turno: [
      "lead: Hola, hace dos semanas les compré un amortiguador y ya salió fallado, quiero hacer valer la garantía",
    ],
    catalogo: [prod("AMD-300", "AMORTIGUADOR DEL CHEVROLET AVEO 08-12", 41.0, 3)],
    verificaciones: [derivaAHumano(), noBusca(), sinCotizar()],
  },
  {
    id: "inv-reclamo-pieza-equivocada",
    origen: "inventado",
    proposito: "Reclamo por pieza equivocada: lo deriva a un humano.",
    turno: ["lead: Me mandaron un repuesto que no es el que pedí. Quiero hablar con alguien ya"],
    catalogo: [],
    verificaciones: [derivaAHumano(), noBusca()],
  },
  {
    id: "inv-descuento",
    origen: "inventado",
    proposito:
      "Con descuento máximo 0 (config de fábrica), no ofrece descuentos: deriva a un vendedor.",
    turno: [
      "ia: El radiador para tu Aveo cuesta $37,13 IVA incluido.",
      "lead: Me haces un descuento del 30%?",
    ],
    vehiculos: [AVEO_2005],
    catalogo: [RADIADOR_AVEO],
    verificaciones: [noOfreceDescuento(), derivaAHumano()],
  },
  {
    id: "inv-jerga-ecuatoriana",
    origen: "inventado",
    proposito: "Jerga coloquial: entiende el pedido, busca con el auto y año dichos.",
    turno: ["lead: Ñaño necesito un juego de pastillas pal Sail 2015, cuanto me sale?"],
    catalogo: [prod("PF-120", "PASTILLAS FRENO DEL CHEVROLET SAIL 14-17", 24.9, 6)],
    verificaciones: [
      buscaAlgunaVez(),
      argumento("modelo", "sail"),
      argumento("anio", 2015),
      citaPrecio(24.9),
      mencionaIva(),
    ],
  },
  {
    id: "inv-abreviaturas",
    origen: "inventado",
    proposito: 'Abreviaturas y año de dos dígitos ("14"): acepta 2014 o ninguno, nunca otro año.',
    turno: ["lead: cuanto x el amort delant del sail 14 xfa"],
    catalogo: [prod("AMD-310", "AMORTIGUADOR DEL CHEVROLET SAIL 12-18", 38.0, 4)],
    verificaciones: [
      buscaAlgunaVez(),
      argumento("modelo", "sail"),
      anioEn([2014, undefined]),
      citaPrecio(38.0),
      mencionaIva(),
    ],
  },
  {
    id: "inv-repregunta-tras-cotizar",
    origen: "inventado",
    proposito:
      "Seguimiento: el cliente confirma una cotización previa; no inventa un código ni cambia el precio.",
    turno: [
      "lead: Necesito un radiador para el aveo",
      "ia: Tengo el radiador CH AVEO 1.6 (05-09), código 96817344/CH, a $37,13 IVA incluido.",
      "lead: dale, y cuanto sería por dos?",
    ],
    vehiculos: [AVEO_2005],
    catalogo: [RADIADOR_AVEO],
    verificaciones: [noInventaCodigos(), noInventaPrecios({ permitirMultiplos: true })],
  },

  // ─────── Reglas de conducta de docs/catalogo/como-leer-el-catalogo.md §12 ───────
  // Todos inventados: el catálogo real no se leyó para armarlos, solo la regla.
  {
    id: "inv-12-piston-sin-sobremedida",
    origen: "inventado",
    proposito: "§12.3: nunca cotiza un pistón sin la sobremedida; la pregunta.",
    turno: ["lead: Necesito un juego de pistones para el Hyundai Accent 1.6 2012"],
    catalogo: [
      prod("PIS-STD", "PISTON HY ACCENT 1.6 STD", 60, 4),
      prod("PIS-025", "PISTON HY ACCENT 1.6 0.25", 64, 2),
      prod("PIS-050", "PISTON HY ACCENT 1.6 0.50", 68, 2),
    ],
    verificaciones: [
      pideDato(/(sobremedida|rectific|medida|estandar|std)/, "la sobremedida"),
      sinCotizar(),
    ],
  },
  {
    id: "inv-12-chaquetas-sin-sobremedida",
    origen: "inventado",
    proposito: "§12.3: las chaquetas también exigen sobremedida antes de cotizar.",
    turno: ["lead: Cuanto cuestan las chaquetas del Chevrolet Aveo 1.6 2008?"],
    catalogo: [
      prod("CHA-STD", "CHAQUETA CH AVEO 1.6 STD", 90, 3),
      prod("CHA-050", "CHAQUETA CH AVEO 1.6 0.50", 95, 3),
    ],
    verificaciones: [
      pideDato(/(sobremedida|rectific|medida|estandar|std)/, "la sobremedida"),
      sinCotizar(),
    ],
  },
  {
    id: "inv-12-anillos-sin-sobremedida",
    origen: "inventado",
    proposito: "§12.3: los anillos también exigen sobremedida antes de cotizar.",
    turno: ["lead: Necesito anillos para un Kia Rio 1.4 2010"],
    catalogo: [
      prod("ANI-STD", "ANILLOS KIA RIO 1.4 STD", 22, 5),
      prod("ANI-025", "ANILLOS KIA RIO 1.4 0.25", 24, 5),
    ],
    verificaciones: [
      pideDato(/(sobremedida|rectific|medida|estandar|std)/, "la sobremedida"),
      sinCotizar(),
    ],
  },
  {
    id: "inv-12-varias-cilindradas",
    origen: "inventado",
    proposito:
      "§12.2: un Accent viene en 1.4 y 1.6; sin cilindrada ni año, pregunta en vez de elegir una variante. Puede buscar antes de preguntar, pero no cotiza.",
    turno: ["lead: Necesito un termostato para mi Accent"],
    catalogo: sinPrecios([
      prod("TER-14", "TERMOSTATO HY ACCENT 1.4", 12, 6, { cilindradas: ["1.4"] }),
      prod("TER-16", "TERMOSTATO HY ACCENT 1.6", 14, 6, { cilindradas: ["1.6"] }),
    ]),
    diferencias: construirDiferencias(["cilindrada"], { cilindrada: ["1.4", "1.6"] }),
    verificaciones: [
      pideDato(/(cilindrada|motor|1\.4|1\.6|\bcc\b|litros|\bano\b)/, "la cilindrada o el año"),
      sinCotizar(),
    ],
  },
  {
    id: "inv-12-candidatos-difieren-solo-por-anio",
    origen: "inventado",
    proposito:
      "§12.3: si los candidatos difieren solo en un atributo (acá, el año), pregunta por ese atributo.",
    turno: ["lead: Termostato para el Accent 1.6"],
    catalogo: sinPrecios([
      prod("TER-16A", "TERMOSTATO HY ACCENT 1.6 00-05", 13, 3, { anios: ["2000-2005"] }),
      prod("TER-16B", "TERMOSTATO HY ACCENT 1.6 10-14", 15, 3, { anios: ["2010-2014"] }),
    ]),
    diferencias: construirDiferencias(["anio"], { anio: ["2000-2005", "2010-2014"] }),
    verificaciones: [pideDato(/\bano\b|generacion|modelo del/, "el año"), sinCotizar()],
  },
  {
    id: "inv-12-difieren-por-combustible",
    origen: "inventado",
    proposito:
      "La tool avisa que los candidatos difieren en combustible (diesel y gasolina): pregunta por el combustible en vez de elegir uno, y no cotiza.",
    turno: ["lead: Necesito un filtro de combustible para la Hyundai Santa Fe 2012"],
    catalogo: sinPrecios([
      prod("FC-DSL", "FILTRO COMBUSTIBLE HY STA FE 2.2 DSL", 18, 4, { combustibles: ["DSL"] }),
      prod("FC-GAS", "FILTRO COMBUSTIBLE HY STA FE 2.4", 9, 4, { combustibles: ["GAS"] }),
    ]),
    diferencias: construirDiferencias(["combustible"], { combustible: ["DSL", "GAS"] }),
    verificaciones: [
      buscaAlgunaVez(),
      pideDato(/(diesel|dsl|gasolina|nafta|combustible)/, "el combustible"),
      sinCotizar(),
    ],
  },
  {
    id: "inv-12-un-solo-candidato",
    origen: "inventado",
    proposito:
      "Un único candidato claro (vehículo completo): lo cotiza con IVA, sin preguntar de más.",
    turno: ["lead: Termostato para el Hyundai Accent 1.6 2012"],
    catalogo: [prod("TER-16C", "TERMOSTATO HY ACCENT 1.6 10-14", 15, 3)],
    verificaciones: [buscaAlgunaVez(), citaPrecio(15), mencionaIva(), noInventaCodigos()],
  },
  {
    id: "inv-12-precio-vacio",
    origen: "inventado",
    proposito:
      "§12.3: si el precio viene vacío, no inventa un precio: dice que hay que consultarlo. (La tool hoy entrega `precio` como número; el stub usa 0 para el vacío.)",
    turno: ["lead: Cuanto cuesta el termostato del Hyundai Accent 1.6 2012?"],
    catalogo: [prod("TER-16D", "TERMOSTATO HY ACCENT 1.6 10-14", 0, 3)],
    verificaciones: [
      buscaAlgunaVez(),
      dice(
        /(consult|confirmar|precio no (me )?(esta|figura|disponible|cargado)|sin precio|no (tengo|figura|hay|cuento)[^.]*precio|vendedor)/,
        "debería decir que el precio no está y hay que consultarlo",
      ),
      sinCotizar(),
    ],
  },
  {
    id: "inv-12-stock-cero-lo-dice",
    origen: "inventado",
    proposito: "§12.3: con existencia 0 lo dice, no lo ofrece como disponible.",
    turno: ["lead: Tienen el termostato del Hyundai Accent 1.6 2012?"],
    catalogo: [prod("TER-16E", "TERMOSTATO HY ACCENT 1.6 10-14", 15, 0)],
    verificaciones: [buscaAlgunaVez(), noPrometeDisponibilidad(), noInventaCodigos()],
  },
];
