import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  cargarDiccionario,
  soloConfianzaAlta,
  traducirDescripcion,
  type Combustible,
  type Compatibilidad,
} from "@/lib/catalogo/traducir-descripcion";

/**
 * Las filas de `nombre` de abajo son REALES: salen de `productos` en crm-dev
 * (consulta de solo lectura del 2026-10-05) o de los ejemplos que
 * `docs/catalogo/como-leer-el-catalogo.md` marca como reales. Los resultados
 * esperados se escribieron a mano aplicando las reglas de ese documento. Donde
 * la regla no alcanza para decidir hay un comentario `// DUDA:`.
 */

const CSV = readFileSync(
  path.resolve(process.cwd(), "docs/catalogo/diccionario-modelos-sugerido.csv"),
  "utf8",
);
const COMPLETO = cargarDiccionario(CSV);
// Igual que el script de relleno: solo lo que el dueño/guía marcó con confianza alta.
const ALTA = soloConfianzaAlta(COMPLETO);

type Esperado = Omit<Compatibilidad, "modelo_nombre">;

function v(
  marca: string,
  modelo: string,
  desde: number | null = null,
  hasta: number | null = null,
  cc: string | null = null,
  comb: Combustible | null = null,
): Esperado {
  return {
    marca,
    modelo,
    anio_desde: desde,
    anio_hasta: hasta,
    cilindrada: cc,
    combustible: comb,
  };
}

/** Quita `modelo_nombre`: las tablas de abajo prueban la forma que consume el SQL. */
function proyectar(r: Compatibilidad[]): Esperado[] {
  return r.map(({ modelo_nombre: _n, ...resto }) => resto);
}

function traducir(nombre: string, dic = ALTA): Esperado[] {
  return proyectar(traducirDescripcion(nombre, dic));
}

describe("cargarDiccionario", () => {
  it("lee las 401 filas del CSV sugerido, con BOM, y conserva la confianza", () => {
    expect(COMPLETO).toHaveLength(401);
    const porConfianza = { alta: 0, media: 0, baja: 0 };
    for (const m of COMPLETO) porConfianza[m.confianza] += 1;
    expect(porConfianza).toEqual({ alta: 316, media: 61, baja: 24 });
    expect(COMPLETO[0]).toMatchObject({
      marcaSigla: "HY",
      marca: "Hyundai",
      modeloCatalogo: "ACC",
      modeloSugerido: "Hyundai Accent",
      confianza: "alta",
      esVehiculo: true,
    });
  });

  it("soloConfianzaAlta descarta media y baja", () => {
    expect(ALTA).toHaveLength(316);
    expect(ALTA.every((m) => m.confianza === "alta")).toBe(true);
  });

  it("marca motores y acabados como no-vehículo", () => {
    const porClave = (sigla: string, modelo: string) =>
      COMPLETO.find((m) => m.marcaSigla === sigla && m.modeloCatalogo === modelo);
    expect(porClave("CH", "4ZE1")?.esVehiculo).toBe(false);
    expect(porClave("TY", "22R")?.esVehiculo).toBe(false);
    expect(porClave("KIA", "XCITE")?.esVehiculo).toBe(false);
    expect(porClave("HY", "ACC")?.esVehiculo).toBe(true);
    // El texto dice "Nissan X-Trail motor QR25DE": el motor es el apellido, sigue siendo un auto.
    expect(porClave("NS", "XTRAIL QR25")?.esVehiculo).toBe(true);
  });

  it("marca como compuestas las entradas que juntan dos vehículos con '+'", () => {
    const spark = COMPLETO.find((m) => m.marcaSigla === "CH" && m.modeloCatalogo === "SPARK DW");
    expect(spark?.compuesto).toBe(true);
    const acc = COMPLETO.find((m) => m.marcaSigla === "HY" && m.modeloCatalogo === "ACC");
    expect(acc?.compuesto).toBe(false);
  });

  it("parsea comillas, comas y saltos de línea dentro de un campo (CSV inventado para ilustrar)", () => {
    const csv =
      "﻿marca_sigla,marca,modelo_en_catalogo,tipo,filas,MODELO_REAL_ESCRIBIR_ACA,MODELO_SUGERIDO,CONFIANZA,POR_QUE\r\n" +
      'HY,Hyundai,ACC,modelo,10,,"Hyundai ""Accent"", sedán",alta,"linea 1\nlinea 2, con coma"\r\n' +
      "HY,Hyundai,CRETA,modelo,5,Hyundai Creta (dueño),Hyundai Creta,media,x\r\n";
    const dic = cargarDiccionario(csv);
    expect(dic).toHaveLength(2);
    expect(dic[0]).toMatchObject({
      modeloCatalogo: "ACC",
      modeloSugerido: 'Hyundai "Accent", sedán',
      filas: 10,
    });
    // Si el dueño escribió el modelo real, gana sobre el sugerido.
    expect(dic[1]).toMatchObject({ modeloSugerido: "Hyundai Creta (dueño)", confianza: "media" });
  });
});

/**
 * Filas reales y su traducción esperada con el diccionario de confianza alta.
 * [nombre, esperado]
 */
const FILAS: Array<[string, Esperado[]]> = [
  // --- §3: forma de la descripción, orden no fijo (§3.1) -------------------
  [
    "HY ACC 06- 1.4 /0 XCITE GETZ 1.4",
    [v("Hyundai", "ACC", 2006, null, "1.4"), v("Hyundai", "GETZ", null, null, "1.4")],
  ],
  ["CH SAIL 1.4 12- /0", [v("Chevrolet", "SAIL", 2012, null, "1.4")]],
  ["HY CRETA 1.5 21-", [v("Hyundai", "CRETA", 2021, null, "1.5")]],
  ["HY STA FE 2.2 /0 DSL", [v("Hyundai", "STA FE", null, null, "2.2", "DSL")]],
  ["CH SAIL 1.4", [v("Chevrolet", "SAIL", null, null, "1.4")]],
  ["HY MATRIX", [v("Hyundai", "MATRIX")]],
  ["NS TIIDA", [v("Nissan", "TIIDA")]],

  // --- §7 años: AA- / AA-BB / -AA, regla de siglo ---------------------------
  ["HY CRETA 17- RH", [v("Hyundai", "CRETA", 2017)]],
  [
    "HY ACC 12-18 /0 1.4 1.6 ELANT SOUL",
    [
      v("Hyundai", "ACC", 2012, 2018, "1.4"),
      v("Hyundai", "ACC", 2012, 2018, "1.6"),
      v("Hyundai", "ELANT"),
      v("Kia", "SOUL"),
    ],
  ],
  ["HY STA FE -06", [v("Hyundai", "STA FE", null, 2006)]],
  ["HY STA FE  2.7 -06 AD RH", [v("Hyundai", "STA FE", null, 2006, "2.7")]],
  ["HY ACC -97 POST", [v("Hyundai", "ACC", null, 1997)]],
  ["CH 6VD1 LUV /0 3.2 00-", [v("Chevrolet", "LUV", 2000, null, "3.2")]],
  ["CH 6VD1 TRO /0 3.2 -98", [v("Chevrolet", "TRO", null, 1998, "3.2")]],
  ["HY ACC 94-96", [v("Hyundai", "ACC", 1994, 1996)]],
  ["HY H100 93-04 3&4", [v("Hyundai", "H100", 1993, 2004)]],
  ["CH LUV 2.3 89-96", [v("Chevrolet", "LUV", 1989, 1996, "2.3")]],
  ["NS SEN B13 1.6 91-97 PLUMAS", [v("Nissan", "SEN B13", 1991, 1997, "1.6")]],
  ["KIA SPORTAG 94-03 COMPL", [v("Kia", "SPORTAG", 1994, 2003)]],
  ["HY H1 STAREX 96-00", [v("Hyundai", "H1", 1996, 2000)]], // STAREX no está en el diccionario de confianza alta: H1 queda solo.
  ["CH CAPTIVA  11-17", [v("Chevrolet", "CAPTIVA", 2011, 2017)]],
  ["CH ASTRA 2.0 02-09 P/DIRECC", [v("Chevrolet", "ASTRA", 2002, 2009, "2.0")]],
  ["CH DMAX 3.0 06-13 4JH1", [v("Chevrolet", "DMAX", 2006, 2013, "3.0")]],
  ["HY STA FE 2.4 12 - POST CURV", [v("Hyundai", "STA FE", 2012, null, "2.4")]],
  ["HY ELANTRA XD 04 - 07  T/M", [v("Hyundai", "ELANTRA", 2004, 2007)]],
  // DUDA: "-02-" tiene guion a los dos lados y la guía no lo documenta; no se interpreta como año.
  ["HY VER 1.5 -02- 12V 110R", [v("Hyundai", "VER", null, null, "1.5")]],
  // DUDA: "06" suelto (sin guion) no es una de las tres formas de §7; se ignora y FRONT 00- queda desde 2000.
  ["NS XTRAIL 06 DELT FRONT 00-", [v("Nissan", "XTRAIL"), v("Nissan", "FRONT", 2000)]],
  // DUDA: un año que viene antes del primer vehículo (-98) se descarta en vez de adivinar a quién pertenece.
  ["CH 6VD1 -98 ROD 3.2", [v("Chevrolet", "ROD", null, null, "3.2")]],

  // --- §7.2 trampa AA-BB: medidas en mm, no años ----------------------------
  ["272 ABRAZ METAL PEQÑ 25-38 mm", []],
  ["272 ABRAZ METAL GRAN 70-89mm", []],
  ["ABRAZ G/POLVO 20-38MM", []],
  ["CH LUV 2.3 60.3 MM", [v("Chevrolet", "LUV", null, null, "2.3")]],
  ["CH DMAX 3.5 V6 ACANALADA INTERNO 17 MM", [v("Chevrolet", "DMAX", null, null, "3.5")]],
  ["HY VER MATRIX  ANILLO  74.2 mm.", [v("Hyundai", "VER"), v("Hyundai", "MATRIX")]],

  // --- §6 cilindrada ---------------------------------------------------------
  ["CH ONIX 1.0T 19-  LH", [v("Chevrolet", "ONIX", 2019, null, "1.0")]],
  ["KIA SORENT 3.5  02-05 A/T", [v("Kia", "SORENT", 2002, 2005, "3.5")]],
  [
    "HY TERRAC 3.5  CARITA SORENT 3.5",
    [v("Hyundai", "TERRAC", null, null, "3.5"), v("Kia", "SORENT", null, null, "3.5")],
  ],
  // Varias cilindradas del mismo vehículo: un elemento por cilindrada, mismo año.
  [
    "CH LUV DMAX 4*2 2.4 3.5",
    [v("Chevrolet", "LUV DMAX", null, null, "2.4"), v("Chevrolet", "LUV DMAX", null, null, "3.5")],
  ],
  [
    "KIA PREG 2.7 3.0  00- K2.7",
    [v("Kia", "PREG", 2000, null, "2.7"), v("Kia", "PREG", 2000, null, "3.0")],
  ],
  [
    "HY STA FE DELT DER 2.2 2.4 2.7 07- SORENT",
    [
      v("Hyundai", "STA FE", 2007, null, "2.2"),
      v("Hyundai", "STA FE", 2007, null, "2.4"),
      v("Hyundai", "STA FE", 2007, null, "2.7"),
      v("Kia", "SORENT"),
    ],
  ],
  // Cilindrada sin modelo (§6 trampa): la descripción no dice de qué auto es.
  ["MZ 2.2 F2", []],
  ["MZ 2.0", []],
  ["MZ 2.6 INY G8", []],

  // --- §9 combustible --------------------------------------------------------
  ["HY H100 98- GAS 1C", [v("Hyundai", "H100", 1998, null, null, "GAS")]],
  ["HY H1 08- TQ DSL", [v("Hyundai", "H1", 2008, null, null, "DSL")]],
  ["KIA CERATO   RH 04-08 GAS", [v("Kia", "CERATO", 2004, 2008, null, "GAS")]],
  ["KIA CARENS 1.8 02-06 RH GAS", [v("Kia", "CARENS", 2002, 2006, "1.8", "GAS")]],
  ["KIA SORENTO 2.5 DSL", [v("Kia", "SORENTO", null, null, "2.5", "DSL")]],
  ["KIA CARENS RONDO 2.0 DSL", [v("Kia", "CARENS", null, null, "2.0", "DSL")]],
  [
    "HY TUCS 05- GAS KIA SPORTAG ACT",
    [v("Hyundai", "TUCS", 2005, null, null, "GAS"), v("Kia", "SPORTAG")],
  ],
  ["HY H100 DSL TY HILUX", [v("Hyundai", "H100", null, null, null, "DSL"), v("Toyota", "HILUX")]],
  // DUDA: el DSL va pegado al TUCS (último vehículo nombrado), pero podría ser el 2.2 diesel del Santa Fe.
  [
    "HY STA FE 2.2 TUCS DSL",
    [v("Hyundai", "STA FE", null, null, "2.2"), v("Hyundai", "TUCS", null, null, null, "DSL")],
  ],
  // "DSL/GAS" son dos combustibles: ninguno se elige.
  ["HY H100 DSL/GAS", [v("Hyundai", "H100")]],

  // --- Modelos de varias palabras: gana la coincidencia más larga ------------
  ["HY STA FE 2.7 07- EXT B/MULTIPLE", [v("Hyundai", "STA FE", 2007, null, "2.7")]],
  ["HY GRAND I10 1.2 15- CANISTER", [v("Hyundai", "GRAND I10", 2015, null, "1.2")]],
  ["HY GRAN I10 1.2 LH C/ABS", [v("Hyundai", "GRAN I10", null, null, "1.2")]],
  ["CH GRAN VIT 2.0 /2 J18 J20 5P", [v("Chevrolet", "GRAN VIT", null, null, "2.0")]],
  ["CH TAX AVEO C/A   25183021", [v("Chevrolet", "TAX AVEO")]],
  ["CH SPARK GT 1.2", [v("Chevrolet", "SPARK GT", null, null, "1.2")]],
  ["NS SEN B13 RH", [v("Nissan", "SEN B13")]],
  ["HY TUCS IX TUBO METALICO", [v("Hyundai", "TUCS IX")]],
  ["HY TUCS NX 21- O-RING CRPO ACELERACION", [v("Hyundai", "TUCS NX", 2021)]],
  [
    "HY H1 TQ H100 DSL AD S/REGULACION",
    [v("Hyundai", "H1 TQ"), v("Hyundai", "H100", null, null, null, "DSL")],
  ],
  [
    "HY H1 TQ DSL 4DBH TERRA 2.5 CARRERA 110 mm",
    [v("Hyundai", "H1 TQ", null, null, null, "DSL"), v("Hyundai", "TERRA", null, null, "2.5")],
  ],
  ["CH LUV DMAX INF 4*4 05- LH", [v("Chevrolet", "LUV DMAX", 2005)]],
  // Entradas con " + " (dos autos en una) se descomponen en sus modelos sueltos.
  ["CH 6VD1 LUV TRO WGN 6 CIL", [v("Chevrolet", "LUV"), v("Chevrolet", "TRO")]],
  ["CH VAN N300 LH", [v("Chevrolet", "VAN N300")]],
  // VAN suelto es de confianza media y se descarta; N300 solo sí es alta.
  ["CH N300 N200   RETRO", [v("Chevrolet", "N300")]],
  // DUDA: GRAND es una entrada alta de CH (Grand Vitara) pero acá parece ser la caja "Grand 9D".
  ["CH AVEO 1&2 EXT GRAND 9D", [v("Chevrolet", "AVEO"), v("Chevrolet", "GRAND")]],
  // DUDA: la sobremedida /1 entre RIO y STYLUS se descarta y quedan contiguos, pero RIO STYLUS es media: con alta queda solo RIO.
  ["KIA RIO /1 STYLUS", [v("Kia", "RIO")]],

  // --- §10 compatibles al final, también de otra marca ----------------------
  [
    "HY ACC 06- VER GETZ TUCS MATRIX 54*82C",
    [
      v("Hyundai", "ACC", 2006),
      v("Hyundai", "VER"),
      v("Hyundai", "GETZ"),
      v("Hyundai", "TUCS"),
      v("Hyundai", "MATRIX"),
    ],
  ],
  [
    "HY ACC 06- VER GETZ MATRIX ELANT",
    [
      v("Hyundai", "ACC", 2006),
      v("Hyundai", "VER"),
      v("Hyundai", "GETZ"),
      v("Hyundai", "MATRIX"),
      v("Hyundai", "ELANT"),
    ],
  ],
  [
    "HY TUCS IX 2.0 -13 /0 KIA SPORTG R CARENS 16-",
    [v("Hyundai", "TUCS IX", null, 2013, "2.0"), v("Kia", "SPORTG"), v("Kia", "CARENS", 2016)],
  ],
  ["KIA RIO 18- SOLUTO 19- /0", [v("Kia", "RIO", 2018), v("Kia", "SOLUTO", 2019)]],
  [
    "HY ACC 12- RIO 18- STONIC 20- GUARDAPOLVO",
    [v("Hyundai", "ACC", 2012), v("Kia", "RIO", 2018), v("Kia", "STONIC", 2020)],
  ],
  ["HY ACC 12- DELT KIA RIO R", [v("Hyundai", "ACC", 2012), v("Kia", "RIO R")]],
  ["KIA PICANTO 05- HY I10 PRESION", [v("Kia", "PICANTO", 2005), v("Hyundai", "I10")]],
  ["KIA PICANTO HY I10 1.1 11-", [v("Kia", "PICANTO"), v("Hyundai", "I10", 2011, null, "1.1")]],
  ["HY TUCS 05- KIA SPORTG   LH", [v("Hyundai", "TUCS", 2005), v("Kia", "SPORTG")]],
  [
    "HY TUCS 2.0 MATRIX 1.8 00- X8",
    [v("Hyundai", "TUCS", null, null, "2.0"), v("Hyundai", "MATRIX", 2000, null, "1.8")],
  ],
  [
    "HY TUCS MATRIX 1.8 ELAN 96-",
    [v("Hyundai", "TUCS"), v("Hyundai", "MATRIX", null, null, "1.8"), v("Hyundai", "ELAN", 1996)],
  ],
  [
    "HY TUCS IX 2.0 -13 STA FE 2.4 09- SORENT 2.4 SONAT",
    [
      v("Hyundai", "TUCS IX", null, 2013, "2.0"),
      v("Hyundai", "STA FE", 2009, null, "2.4"),
      v("Kia", "SORENT", null, null, "2.4"),
      v("Hyundai", "SONAT"),
    ],
  ],
  [
    "HY TUCS IX 10-11 HY STA FE 2.4 09-12 ADM SONAT 11-",
    [
      v("Hyundai", "TUCS IX", 2010, 2011),
      v("Hyundai", "STA FE", 2009, 2012, "2.4"),
      v("Hyundai", "SONAT", 2011),
    ],
  ],
  [
    "HY TUCS IX 14- SONT HYB OPTIMA 13- 85*119*9",
    [v("Hyundai", "TUCS IX", 2014), v("Kia", "OPTIMA", 2013)],
  ],
  [
    "KIA CERA FORT 12- SOUL 08- I30 09-",
    [v("Kia", "CERA", 2012), v("Kia", "SOUL", 2008), v("Hyundai", "I30", 2009)],
  ],
  [
    "KIA CARNIVAL 2.9 TERRAC 2.9 B/LEVA",
    [v("Kia", "CARNIVAL", null, null, "2.9"), v("Hyundai", "TERRAC", null, null, "2.9")],
  ],
  [
    "KIA CERAT MATRIX ELANT XD RD 39*74*36",
    [v("Kia", "CERAT"), v("Hyundai", "MATRIX"), v("Hyundai", "ELANT")],
  ],
  [
    "HY ACC XCITE VER GETZ 16V STA FE 2.7 V6 -06",
    [
      v("Hyundai", "ACC"),
      v("Hyundai", "VER"),
      v("Hyundai", "GETZ"),
      v("Hyundai", "STA FE", null, 2006, "2.7"),
    ],
  ],
  [
    "HY ACC KIT X6 -05 VER GETZ C/CAM",
    [v("Hyundai", "ACC", null, 2005), v("Hyundai", "VER"), v("Hyundai", "GETZ")],
  ],
  [
    "CH LUV 3.5 ROD 2.6 3.2 LUV 2.3 B/LEVAS",
    [
      v("Chevrolet", "LUV", null, null, "3.5"),
      v("Chevrolet", "ROD", null, null, "2.6"),
      v("Chevrolet", "ROD", null, null, "3.2"),
      v("Chevrolet", "LUV", null, null, "2.3"),
    ],
  ],
  ["CH SPARK 06- DW MATIZ", [v("Chevrolet", "SPARK", 2006), v("Daewoo", "MATIZ")]],
  ["DW MATIZ TICO DAMAS", [v("Daewoo", "MATIZ"), v("Daewoo", "TICO")]],
  [
    "CH AVEO 4C 1.4 05-11 DMAX PLANO",
    [v("Chevrolet", "AVEO", 2005, 2011, "1.4"), v("Chevrolet", "DMAX")],
  ],
  ["CH TAX AVE C/CAM LAN MAZA", [v("Chevrolet", "TAX AVE"), v("Daewoo", "LAN")]],
  ["CH GRAN VIT 3P SZ VIT 3-5P 16V INY ETEEM", [v("Chevrolet", "GRAN VIT"), v("Suzuki", "VIT")]],
  ["TY HIACE MZ 2.6 G6", [v("Toyota", "HIACE")]],
  // La marca repetida (SZ ... SZ) no corta el vehículo: 2.0 y 08-17 siguen siendo de la Gran Vitara.
  ["SZ GRAN VIT SZ 2.0 08-17", [v("Suzuki", "GRAN VIT", 2008, 2017, "2.0")]],
  // Marca distinta (TY) corta: el 2.2 es del Toyota, que no tiene modelo reconocible, y se descarta.
  ["CH GRAN VIT 2.0 TY 2.2 4Y 2.0 22R", [v("Chevrolet", "GRAN VIT", null, null, "2.0")]],

  // --- §4 trampa MT: Mitsubishi solo si abre un modelo; si no, es transmisión ---
  ["MT MONT 4G54", [v("Mitsubishi", "MONT")]],
  ["HY EXC MT LANC 1.5 4G15", [v("Hyundai", "EXC"), v("Mitsubishi", "LANC", null, null, "1.5")]],
  [
    "HY EXC MT LANC MONT L200/92-",
    [
      v("Hyundai", "EXC"),
      v("Mitsubishi", "LANC"),
      v("Mitsubishi", "MONT"),
      v("Mitsubishi", "L200", 1992),
    ],
  ],
  ["HY H100 DSL MT L300", [v("Hyundai", "H100", null, null, null, "DSL"), v("Mitsubishi", "L300")]],
  ["HY H100 RULIMAN MOTRIZ MT MONTERO", [v("Hyundai", "H100")]],
  ["CH CRUZE 1.8 11- MT RH", [v("Chevrolet", "CRUZE", 2011, null, "1.8")]],
  // DUDA: "MT 4G63" podría ser el motor Mitsubishi o la caja manual; como 4G63 no es un vehículo no se abre Mitsubishi.
  ["HY H100 GAS MT 4G63 L200-300", [v("Hyundai", "H100", null, null, null, "GAS")]],
  ["KIA RIO RP MZ 323 92-", [v("Kia", "RIO"), v("Mazda", "323", 1992)]],

  // --- §10.bis TODOS / UNIV: alcance, no modelo ------------------------------
  ["HY TODOS UNIV 3P HALOGENO", [v("Hyundai", "TODOS")]],
  [
    "CH AVEO TODOS DW LAN CIEL NUB",
    [v("Chevrolet", "AVEO"), v("Daewoo", "LAN"), v("Daewoo", "CIEL"), v("Daewoo", "NUB")],
  ],
  ["CH AVEO TODOS HY TODOS ARANDELA COBRE", [v("Chevrolet", "AVEO"), v("Hyundai", "TODOS")]],
  ["ALOG 3PTAS UNIV", []],

  // --- §13 basura conocida ---------------------------------------------------
  ["NS QASQHAI DEL LH 14-", [v("Nissan", "QASQHAI", 2014)]],
  ["KIA SORENT0 2.5 3/4 D4CB HR76777", [v("Kia", "SORENT0", null, null, "2.5")]],
  ["HY TUCSON KIA SPORTAGUE  RH", [v("Hyundai", "TUCSON"), v("Kia", "SPORTAGUE")]],
  ["KIA SPORTGG 2.0 -03 16V", [v("Kia", "SPORTGG", null, 2003, "2.0")]],
  [
    "HY VERACRIZ SORENTO 3.8 15- /0",
    [v("Hyundai", "VERACRIZ"), v("Kia", "SORENTO", 2015, null, "3.8")],
  ],
  ["HY I10 ATOS PICANT/0", [v("Hyundai", "I10"), v("Hyundai", "ATOS"), v("Kia", "PICANT")]],
  [
    "KIA PICANT/2 HY I10 1.1 11- ATOS PRIME",
    [v("Kia", "PICANT"), v("Hyundai", "I10", 2011, null, "1.1"), v("Hyundai", "ATOS")],
  ],
  [
    "KIA PICAN 06- DELT DER HY I10 GRAN I10",
    [v("Kia", "PICAN", 2006), v("Hyundai", "I10"), v("Hyundai", "GRAN I10")],
  ],
  ["KIA PICA 1.2 18- RIO 18-", [v("Kia", "PICA", 2018, null, "1.2"), v("Kia", "RIO", 2018)]],
  ["KIA SPORTAG/0 16V -03", [v("Kia", "SPORTAG", null, 2003)]],
  ["KIA SPORTAGE/4 16V -03", [v("Kia", "SPORTAGE", null, 2003)]],
  ["TY 22R/0 SIN CEJA", []],
  [
    "CH TRACKER1.8 14- CRUZE 1.8 12-",
    [v("Chevrolet", "TRACKER", 2014, null, "1.8"), v("Chevrolet", "CRUZE", 2012, null, "1.8")],
  ],
  ["KIA SORENT06-09 4*4 POST CORTA SUP", [v("Kia", "SORENT", 2006, 2009)]],
  [
    "HY ACC 06- VER- EXC GETZ C/CAM",
    [v("Hyundai", "ACC", 2006), v("Hyundai", "VER"), v("Hyundai", "EXC"), v("Hyundai", "GETZ")],
  ],
  ["HY ACC 06- VER- TODOS C/CAM 62/28", [v("Hyundai", "ACC", 2006), v("Hyundai", "VER")]],
  [
    "HY H1-06 H100 PREG SOLO FILT LUV DSL 02-",
    [
      v("Hyundai", "H1", null, 2006),
      v("Hyundai", "H100"),
      v("Kia", "PREG"),
      v("Chevrolet", "LUV", 2002, null, null, "DSL"),
    ],
  ],
  // DUDA: el 3.8 se pega a SORENT (último vehículo); probablemente vale para los dos, pero el texto no lo dice.
  ["HY VERACRUZ/SORENT 3.8 V6", [v("Hyundai", "VERACRUZ"), v("Kia", "SORENT", null, null, "3.8")]],
  // DUDA: K300 no es una entrada del diccionario alta (la guía lo trae como typo de K3000), así que el token queda sin traducir.
  ["KIA K2700/K300 INF 04-", []],

  // --- Piezas que no son de un vehículo (§4: 326 filas) ----------------------
  ["ACEITE 10W30 GAL", []],
  ["REFRIG GMB ROJO GALON", []],
  ["SPRAY LIMPIA CONTACTOS", []],
  ["SILICON NEGRO 3.0 OZ", []],
  ["32208", []],
  ["6001 LLU", []],
  ["TY 2Y 3Y", []],
  // Sin sigla de marca pero con un modelo inequívoco.
  ["CAVALIER 1.5 19-23 LH", [v("Chevrolet", "CAVALIER", 2019, 2023, "1.5")]],
  ['12" VW ESCARABAJO REN TWINGO MZ', [v("Renault", "TWINGO")]],
  ["MICROFILTROS KIT  Y ORING  X 12 AVEO", [v("Chevrolet", "AVEO")]],
  ["UNIV 3.0 PUL HY MZ 323", [v("Mazda", "323")]],
  [
    "HY TODOS CH LUV 2.3 MOTRIZ B/H",
    [v("Hyundai", "TODOS"), v("Chevrolet", "LUV", null, null, "2.3")],
  ],
  ["TY TODOS MT L200 92-95", [v("Toyota", "TODOS"), v("Mitsubishi", "L200", 1992, 1995)]],
  ['KIA SPORTG GT 16- A/T INF "T"', [v("Kia", "SPORTG", 2016)]],
];

describe("traducirDescripcion (diccionario de confianza alta)", () => {
  it.each(FILAS)("%s", (nombre, esperado) => {
    expect(traducir(nombre)).toEqual(esperado);
  });

  it("devuelve [] para vacío o solo espacios", () => {
    expect(traducir("")).toEqual([]);
    expect(traducir("   ")).toEqual([]);
  });

  // Ejemplos INVENTADOS para ilustrar: en crm-dev no hay una fila con vehículo y
  // medida en mm a la vez, pero la guía (§7.2) exige que el rango en mm no se lea como año.
  it("un rango en mm después de un vehículo no es un año (ejemplo inventado)", () => {
    expect(traducir("HY ACC 25-38 mm")).toEqual([v("Hyundai", "ACC")]);
    expect(traducir("HY ACC 70-89MM")).toEqual([v("Hyundai", "ACC")]);
    expect(traducir("HY ACC 1.5 mm")).toEqual([v("Hyundai", "ACC")]);
  });

  it("un rango fuera de lo que puede ser un año se descarta (ejemplo inventado)", () => {
    // 45 y 60 caen en el hueco 40-69 donde el catálogo no tiene ningún año.
    expect(traducir("HY ACC 45-60")).toEqual([v("Hyundai", "ACC")]);
    // Hasta anterior al desde: no es un rango de años.
    expect(traducir("HY ACC 18-12")).toEqual([v("Hyundai", "ACC")]);
  });

  it("devuelve [] con un diccionario vacío: nunca inventa un modelo", () => {
    expect(traducirDescripcion("HY ACC 06- 1.4 /0 XCITE GETZ 1.4", [])).toEqual([]);
  });

  it("no repite el mismo vehículo si el nombre lo menciona dos veces igual", () => {
    expect(traducir("CH CRUZE 1.8  TRACK 1.8  EQUINOX TURBO")).toEqual([
      v("Chevrolet", "CRUZE", null, null, "1.8"),
      v("Chevrolet", "EQUINOX"),
    ]);
  });
});

describe("traducirDescripcion — nombre canónico del modelo", () => {
  it("unifica las cinco formas de Picanto en el mismo modelo_nombre", () => {
    const nombres = [
      "KIA PICANTO 18-",
      "KIA PICANT 18-",
      "KIA PIC 18-",
      "KIA PICAN 06- DELT DER HY I10 GRAN I10",
      "KIA PICA 1.2 18- RIO 18-",
    ].map((n) => traducirDescripcion(n, ALTA)[0]?.modelo_nombre);
    expect(new Set(nombres)).toEqual(new Set(["Kia Picanto"]));
  });

  it("modelo conserva la sigla del catálogo y modelo_nombre el nombre sugerido", () => {
    expect(traducirDescripcion("HY ACC 06- 1.4 /0 XCITE GETZ 1.4", ALTA)).toEqual([
      {
        marca: "Hyundai",
        modelo: "ACC",
        modelo_nombre: "Hyundai Accent",
        anio_desde: 2006,
        anio_hasta: null,
        cilindrada: "1.4",
        combustible: null,
      },
      {
        marca: "Hyundai",
        modelo: "GETZ",
        modelo_nombre: "Hyundai Getz",
        anio_desde: null,
        anio_hasta: null,
        cilindrada: "1.4",
        combustible: null,
      },
    ]);
  });

  it("marca viene de la sigla, aunque el nombre sugerido diga otra (SZ = Suzuki)", () => {
    const [r] = traducirDescripcion("SZ FORSA II D/M", COMPLETO);
    expect(r).toMatchObject({
      marca: "Suzuki",
      modelo: "FORSA II",
      modelo_nombre: "Chevrolet Forsa II",
    });
  });

  it("MARCA TODOS es toda la marca", () => {
    expect(traducirDescripcion("HY TODOS UNIV 3P HALOGENO", ALTA)).toEqual([
      {
        marca: "Hyundai",
        modelo: "TODOS",
        modelo_nombre: "Todos",
        anio_desde: null,
        anio_hasta: null,
        cilindrada: null,
        combustible: null,
      },
    ]);
  });
});

describe("traducirDescripcion (diccionario completo, incluye media y baja)", () => {
  const completo = (n: string) => traducir(n, COMPLETO);

  it("MARCA MODELO TODOS es todo ese modelo, sin elemento extra", () => {
    expect(completo("CH COR TODOS")).toEqual([v("Chevrolet", "COR")]);
  });

  it("COR TODOS con rango de cilindrada y año", () => {
    expect(completo("CH COR 1.3-1.8 TODOS")).toEqual([
      v("Chevrolet", "COR", null, null, "1.3"),
      v("Chevrolet", "COR", null, null, "1.8"),
    ]);
    expect(completo("CH COR TODOS -05")).toEqual([v("Chevrolet", "COR", null, 2005)]);
  });

  it("CH COR DW TODOS: el Corsa y todos los Daewoo", () => {
    expect(completo("CH COR DW TODOS")).toEqual([v("Chevrolet", "COR"), v("Daewoo", "TODOS")]);
    // Con la lista de confianza alta, COR (media) se descarta pero DW TODOS se mantiene.
    expect(traducir("CH COR DW TODOS")).toEqual([v("Daewoo", "TODOS")]);
  });

  it("modelos de confianza media: Swift y Alto de Chevrolet", () => {
    expect(completo("CH SWIFT 89 - ALTO")).toEqual([
      v("Chevrolet", "SWIFT", 1989),
      v("Chevrolet", "ALTO"),
    ]);
    // Con alta, SWIFT se resuelve por la entrada de Suzuki y ALTO (media) desaparece.
    expect(traducir("CH SWIFT 89 - ALTO")).toEqual([v("Suzuki", "SWIFT", 1989)]);
  });

  it("sobremedida pegada al modelo (CARRY/2) se ignora", () => {
    expect(completo("SZ CARRY/0 CHANGAN")).toEqual([v("Suzuki", "CARRY")]);
  });

  it("COR EVOL (media) y CLIO de otra marca", () => {
    expect(completo("CH COR EVOL S/A REN CLIO C/A")).toEqual([
      v("Chevrolet", "COR EVOL"),
      v("Renault", "CLIO"),
    ]);
  });
});
