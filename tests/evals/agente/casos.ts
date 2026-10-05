import { construirDiferencias } from "@/lib/catalogo/compatibilidad";
import type { AgentVehiculo } from "@/server/services/ai-agent.service";
import type {
  BuscarRepuestoInput,
  BuscarRepuestoMatch,
  BuscarRepuestoOutput,
} from "@/lib/validation/ai";

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
    catalogo: [
      prod("TER-14", "TERMOSTATO HY ACCENT 1.4", 12, 6, { cilindradas: ["1.4"] }),
      prod("TER-16", "TERMOSTATO HY ACCENT 1.6", 14, 6, { cilindradas: ["1.6"] }),
    ],
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
    catalogo: [
      prod("TER-16A", "TERMOSTATO HY ACCENT 1.6 00-05", 13, 3, { anios: ["2000-2005"] }),
      prod("TER-16B", "TERMOSTATO HY ACCENT 1.6 10-14", 15, 3, { anios: ["2010-2014"] }),
    ],
    diferencias: construirDiferencias(["anio"], { anio: ["2000-2005", "2010-2014"] }),
    verificaciones: [pideDato(/\bano\b|generacion|modelo del/, "el año"), sinCotizar()],
  },
  {
    id: "inv-12-difieren-por-combustible",
    origen: "inventado",
    proposito:
      "La tool avisa que los candidatos difieren en combustible (diesel y gasolina): pregunta por el combustible en vez de elegir uno, y no cotiza.",
    turno: ["lead: Necesito un filtro de combustible para la Hyundai Santa Fe 2012"],
    catalogo: [
      prod("FC-DSL", "FILTRO COMBUSTIBLE HY STA FE 2.2 DSL", 18, 4, { combustibles: ["DSL"] }),
      prod("FC-GAS", "FILTRO COMBUSTIBLE HY STA FE 2.4", 9, 4, { combustibles: ["GAS"] }),
    ],
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
