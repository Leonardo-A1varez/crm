/**
 * Verifica las paletas de `src/app/globals.css` contra las varas que las
 * gobiernan. Existe porque los valores viven en el CSS con números en el
 * comentario, y un número en un comentario que nadie puede reproducir es una
 * afirmación sin respaldo (AGENTS.md, lección 8).
 *
 *   node scripts/verificar-paleta-clara.mjs
 *
 * Cubre DOS paletas:
 *
 *   A. ETAPAS DEL EMBUDO, tema claro (`--stage-*`). Congeladas: `stage.ts` las
 *      consume y ya estaban calibradas. Se verifican para que no se rompan.
 *
 *   B. TOKENS SEMÁNTICOS (`--ok/--warn/--caution/--danger/--info/--special`),
 *      LOS DOS TEMAS. Se agregaron acá el 2026-09-03, cuando se midió que tres
 *      pares colisionaban y que cuatro de los seis tokens claros no llegaban a
 *      4.5:1 en el patrón en que realmente se dibujan.
 *
 * Las tres varas de las etapas:
 *
 * 1. CONTRASTE >= 4.5 sobre su propio tinte al 13%. El badge de etapa
 *    (`stageBadgeBackground()` en `src/lib/ui/stage.ts`) pinta el texto sobre
 *    un `color-mix` al 13% del mismo color, no sobre superficie plana: ese
 *    tinte acerca el fondo al color del texto y come contraste.
 *
 * 2. DISTANCIA OKLab >= 0.054 entre dos etapas cualesquiera. No es un número
 *    elegido a gusto: es la separación más chica que ya tiene la paleta
 *    oscura en producción (identificando/cotizado), o sea el nivel de
 *    parecido que el producto ya acepta sin que nadie confunda dos etapas.
 *
 * 3. CHROMA OKLab, que es "qué tan vivo se ve". No tiene umbral duro; se
 *    reporta para poder comparar contra el resto de la paleta. El ámbar y el
 *    naranja oscurecidos daban 0.103 y 0.143 (marrones); el resto de la
 *    paleta vive entre 0.19 y 0.25.
 */

const CLARO = {
  nuevo: "#0369a1",
  identificando: "#4f46e5",
  cotizado: "#7c3aed",
  negociando: "#c2185b",
  esperando_pago: "#7e22ce",
  cerrado: "#047857",
  perdido: "#b91c1c",
  requiere_humano: "#a21caf",
};

/** La oscura, sólo para calcular la vara de distancia. No se valida. */
const OSCURA = {
  nuevo: "#38bdf8",
  identificando: "#818cf8",
  cotizado: "#a78bfa",
  negociando: "#fbbf24",
  esperando_pago: "#fb923c",
  cerrado: "#34d399",
  perdido: "#f87171",
  requiere_humano: "#e879f9",
};

const ALPHA_TINTE = 0.13;
const CONTRASTE_MINIMO = 4.5;

const aRgb = (hex) => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
};
const linealizar = (v) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const luminancia = ([r, g, b]) =>
  0.2126 * linealizar(r) + 0.7152 * linealizar(g) + 0.0722 * linealizar(b);
const componer = (frente, alpha, fondo) => frente.map((v, i) => v * alpha + fondo[i] * (1 - alpha));

function contraste(a, b) {
  const x = luminancia(a);
  const y = luminancia(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function aOklab(rgb) {
  const [r, g, b] = rgb.map(linealizar);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

const chroma = (hex) => {
  const o = aOklab(aRgb(hex));
  return Math.sqrt(o.a * o.a + o.b * o.b);
};

function distancia(hexA, hexB) {
  const A = aOklab(aRgb(hexA));
  const B = aOklab(aRgb(hexB));
  return Math.sqrt((A.L - B.L) ** 2 + (A.a - B.a) ** 2 + (A.b - B.b) ** 2);
}

/** Menor separación entre dos colores cualesquiera de una paleta. */
function separacionMinima(paleta) {
  const claves = Object.keys(paleta);
  let min = Infinity;
  let par = "";
  for (let i = 0; i < claves.length; i++) {
    for (let j = i + 1; j < claves.length; j++) {
      const d = distancia(paleta[claves[i]], paleta[claves[j]]);
      if (d < min) {
        min = d;
        par = `${claves[i]}/${claves[j]}`;
      }
    }
  }
  return { min, par };
}

const BLANCO = [255, 255, 255];
const contrasteEnTinte = (hex) => {
  const rgb = aRgb(hex);
  return contraste(rgb, componer(rgb, ALPHA_TINTE, BLANCO));
};

const vara = separacionMinima(OSCURA);
const propia = separacionMinima(CLARO);

console.log("Paleta de etapas — tema claro\n");
for (const [etapa, hex] of Object.entries(CLARO)) {
  const c = contrasteEnTinte(hex);
  console.log(
    `  ${etapa.padEnd(16)} ${hex}  contraste ${c.toFixed(2).padStart(5)}` +
      `  chroma ${chroma(hex).toFixed(3)}  ${c >= CONTRASTE_MINIMO ? "ok" : "BAJO"}`,
  );
}

const peorContraste = Math.min(...Object.values(CLARO).map(contrasteEnTinte));

console.log(
  `\n  contraste mínimo   ${peorContraste.toFixed(2)}  (vara ${CONTRASTE_MINIMO})` +
    `\n  separación mínima  ${propia.min.toFixed(3)}  (vara ${vara.min.toFixed(3)}` +
    ` = ${vara.par} de la paleta oscura)  → ${propia.par}`,
);

const fallas = [];
if (peorContraste < CONTRASTE_MINIMO) fallas.push("contraste por debajo de 4.5");
if (propia.min < vara.min) fallas.push("dos etapas más parecidas de lo que el producto ya acepta");

// ───────────────────────────────────────────────────────────────────────────
// B. TOKENS SEMÁNTICOS, los dos temas.
//
// Por qué se mide distinto que las etapas: un token semántico casi nunca se
// dibuja como texto sobre superficie plana. El patrón real, en decenas de call
// sites, es `text-danger` encima de `bg-danger/10` — texto de un color sobre un
// tinte de SÍ MISMO, que es justo lo que `stage.ts` ya contemplaba para los
// badges de etapa. Medido contra superficie plana, cuatro de los seis tokens
// claros parecían cumplir; medidos contra su propio tinte, no cumplían.
//
// Las varas, todas del validador de la skill `dataviz`
// (`scripts/validate_palette.js`), que implementa la simulación de daltonismo
// de Machado-Oliveira-Fernandes (2009) a severidad 1.0:
//
//   CONTRASTE  >= 4.5 sobre el tinte 13% de sí mismo Y sobre la superficie
//              plana más hostil del tema. 13% es el mismo alfa que usan los
//              badges de etapa; los call sites van de 6% a 16%.
//   NORMAL     ΔE OKLab x100 >= 15 entre dos tokens que comparten pantalla.
//              Es un piso DURO: por debajo, dos colores no se distinguen ni
//              con visión de color completa, y la codificación secundaria no
//              lo excusa.
//   CVD        ΔE >= 8 objetivo, >= 6 piso. Entre 6 y 8 es legal SOLO con
//              codificación secundaria (glifo + palabra).
//
// Tres pares quedan EXENTOS del piso de 15, con motivo:
//
//   warn/caution   No son una escala categórica sino una RAMPA ORDINAL
//                  (`URGENCIA_CONFIG` en `TwinPanel.tsx`: baja→media→alta).
//                  Para una rampa la vara no es ΔE 15 sino el escalón de
//                  luminosidad — 0.060 en `dataviz` — más el piso OKLab que el
//                  propio proyecto se puso para las etapas (0.054 → ΔE 5.4).
//                  Se verifican esas dos, no la de 15.
//   special/stage  `--special` y `--stage-requiere-humano` son el MISMO
//                  concepto ("pidió una persona"): que se parezcan es la
//                  intención, no un defecto.
//   */brand        `--brand` no es un color de estado. Que aparezca en la
//                  escala categórica de `PanelVendedores.tsx` es un defecto de
//                  ese consumidor, no de los tokens: `--brand` está congelado
//                  por decisión de producto y no se puede reescalonar.
// ───────────────────────────────────────────────────────────────────────────

const SEMANTICOS = {
  claro: {
    ok: "#097957",
    warn: "#863a00",
    caution: "#8f5509",
    danger: "#c52a4d",
    info: "#2362a9",
    special: "#ab25ab",
  },
  oscuro: {
    ok: "#31d7a5",
    warn: "#fe9d4a",
    caution: "#f7d710",
    danger: "#f9667c",
    info: "#99cbfe",
    special: "#e679f8",
  },
};

/** Colores congelados que comparten gráfico con los semánticos. */
const FIJOS = {
  claro: { brand: "#d61f1f", stageRH: "#a21caf" },
  oscuro: { brand: "#d61f1f", stageRH: "#e879f9" },
};

/**
 * Superficies de control. `tinte` es donde se dibuja el badge (el tinte se
 * compone encima); `plana` es la superficie plana de menor contraste del tema.
 */
const SUPERFICIES = {
  claro: { plana: "#f1f2f4", tinte: "#ffffff" },
  oscuro: { plana: "#191c22", tinte: "#0f1116" },
};

const NORMAL_MINIMO = 15;
const CVD_OBJETIVO = 8;
const CVD_PISO = 6;
const DL_ORDINAL = 0.06;

// Machado, Oliveira & Fernandes (2009), severidad 1.0, sobre RGB lineal.
const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};

const simular = (rgb, tipo) => {
  const lineal = rgb.map(linealizar);
  const M = MACHADO[tipo];
  const aByte = (v) => {
    const c = Math.max(0, Math.min(1, v));
    const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return s * 255;
  };
  return [0, 1, 2].map((i) =>
    aByte(M[i][0] * lineal[0] + M[i][1] * lineal[1] + M[i][2] * lineal[2]),
  );
};

/** ΔE OKLab x100, la unidad en la que están expresadas las varas de dataviz. */
const deltaE = (rgbA, rgbB) => {
  const A = aOklab(rgbA);
  const B = aOklab(rgbB);
  return 100 * Math.sqrt((A.L - B.L) ** 2 + (A.a - B.a) ** 2 + (A.b - B.b) ** 2);
};
const deltaECvd = (hexA, hexB) =>
  Math.min(
    deltaE(simular(aRgb(hexA), "protan"), simular(aRgb(hexB), "protan")),
    deltaE(simular(aRgb(hexA), "deutan"), simular(aRgb(hexB), "deutan")),
  );

const EXENTOS = new Set(["warn/caution", "caution/warn", "special/stageRH", "stageRH/special"]);

/**
 * Un par CRUZADO mezcla dos paletas distintas: la semántica con `--brand` o
 * con las etapas del embudo. Las tres son sistemas separados y congelados de a
 * uno (`--brand` por decisión de producto, `--stage-*` por estar ya
 * calibradas), así que ningún valor semántico puede arreglar la colisión: la
 * única salida es que el consumidor deje de mezclarlas en la misma escala.
 * Se reportan siempre y no hacen fallar la corrida, porque no son un defecto
 * de estos tokens. Hoy NINGÚN consumidor las mezcla: `PanelVendedores.tsx` era
 * el único y el 2026-09-03 pasó a `COLORES_ATENCION` y a `escalaSecuencial`
 * (`src/lib/ui/metricas.ts`), las dos escalas que verifica el bloque C. La
 * lista se conserva como advertencia: dice qué NO se puede volver a juntar.
 */
const esCruzado = (a, b) => [a, b].some((k) => k === "brand" || k === "stageRH");

for (const [tema, paleta] of Object.entries(SEMANTICOS)) {
  const { plana, tinte } = SUPERFICIES[tema];
  const fondoTinte = aRgb(tinte);
  const contrastePlano = (hex) => contraste(aRgb(hex), aRgb(plana));
  const contrasteSobreSuTinte = (hex) => {
    const rgb = aRgb(hex);
    return contraste(rgb, componer(rgb, ALPHA_TINTE, fondoTinte));
  };

  console.log(`\n\nTokens semánticos — tema ${tema}`);
  console.log(`  (plana ${plana} · tinte ${ALPHA_TINTE * 100}% sobre ${tinte})\n`);
  console.log("  token      hex       chroma   plano   tinte");

  let contrasteBajo = 0;
  for (const [nombre, hex] of Object.entries(paleta)) {
    const cp = contrastePlano(hex);
    const ct = contrasteSobreSuTinte(hex);
    const bajo = cp < CONTRASTE_MINIMO || ct < CONTRASTE_MINIMO;
    if (bajo) contrasteBajo++;
    console.log(
      `  ${nombre.padEnd(9)} ${hex}  ${chroma(hex).toFixed(3)}   ` +
        `${cp.toFixed(2).padStart(5)}   ${ct.toFixed(2).padStart(5)}  ${bajo ? "BAJO" : "ok"}`,
    );
  }

  const todos = { ...paleta, ...FIJOS[tema] };
  const claves = Object.keys(todos);
  const pares = [];
  for (let i = 0; i < claves.length; i++) {
    for (let j = i + 1; j < claves.length; j++) {
      const a = claves[i];
      const b = claves[j];
      pares.push({
        par: `${a}/${b}`,
        normal: deltaE(aRgb(todos[a]), aRgb(todos[b])),
        cvd: deltaECvd(todos[a], todos[b]),
        exento: EXENTOS.has(`${a}/${b}`),
        cruzado: esCruzado(a, b),
      });
    }
  }
  pares.sort((x, y) => x.normal - y.normal);

  console.log("\n  par                     normal    CVD   estado");
  const duros = [];
  const cruzadosFlojos = [];
  for (const p of pares) {
    let estado;
    if (p.exento) estado = "exento — rampa ordinal / mismo concepto";
    else if (p.cruzado) {
      const flojo = p.normal < NORMAL_MINIMO || p.cvd < CVD_PISO;
      if (flojo) cruzadosFlojos.push(p.par);
      estado = flojo ? "CRUZADO FLOJO — arreglar en el consumidor, no en el token" : "cruzado, ok";
    } else if (p.normal < NORMAL_MINIMO) {
      estado = `FALLA normal < ${NORMAL_MINIMO}`;
      duros.push(p.par);
    } else if (p.cvd < CVD_PISO) {
      estado = `FALLA CVD < ${CVD_PISO}`;
      duros.push(p.par);
    } else if (p.cvd < CVD_OBJETIVO) estado = "CVD 6-8: legal sólo con glifo + palabra";
    else estado = "ok";
    console.log(
      `  ${p.par.padEnd(22)}  ${p.normal.toFixed(1).padStart(5)}  ${p.cvd.toFixed(1).padStart(5)}   ${estado}`,
    );
  }

  // La rampa ordinal caution -> warn se mide con su propia vara.
  const dL = Math.abs(aOklab(aRgb(paleta.warn)).L - aOklab(aRgb(paleta.caution)).L);
  const dRampa = distancia(paleta.caution, paleta.warn);
  const rampaOk = dL >= DL_ORDINAL && dRampa >= vara.min;
  console.log(
    `\n  rampa ordinal caution→warn:  ΔL ${dL.toFixed(3)} (vara ${DL_ORDINAL.toFixed(3)})` +
      `  ·  OKLab ${dRampa.toFixed(3)} (vara ${vara.min.toFixed(3)})  ${rampaOk ? "ok" : "BAJO"}`,
  );
  console.log(
    `  contraste por debajo de 4.5: ${contrasteBajo}  ·  pares duros incumplidos: ${duros.length}`,
  );
  if (cruzadosFlojos.length > 0) {
    console.log(
      `  AVISO — pares cruzados flojos (${cruzadosFlojos.join(", ")}): mezclan la paleta\n` +
        "  semántica con --brand o con las etapas, las dos congeladas. No se arreglan\n" +
        "  moviendo un token; se arreglan en el consumidor que las pone en la misma escala.",
    );
  }

  if (contrasteBajo > 0) fallas.push(`${tema}: ${contrasteBajo} token(s) por debajo de 4.5:1`);
  if (duros.length > 0) fallas.push(`${tema}: ${duros.join(", ")} por debajo del piso duro`);
  if (!rampaOk) fallas.push(`${tema}: la rampa caution→warn no tiene escalón suficiente`);
}

// ───────────────────────────────────────────────────────────────────────────
// C. ESCALAS DE LOS REPARTOS de `src/components/metricas/`.
//
// Los tokens pueden estar todos bien y una PANTALLA seguir siendo ilegible, si
// mete en la misma barra apilada colores que no se separan. Hasta el
// 2026-09-03 `PanelVendedores.tsx` tenía las dos formas de ese defecto:
//
//   1. una escala categórica de SEIS colores que incluía `--brand`, y
//   2. una barra de tres franjas que mezclaba `--info` con
//      `--stage-requiere-humano`.
//
// Este bloque verifica las dos escalas que las reemplazaron, y de paso mide el
// techo que hacía que la primera fuese imposible de arreglar como categórica.
// ───────────────────────────────────────────────────────────────────────────

console.log("\n\nEscalas de los repartos — src/lib/ui/metricas.ts\n");

const paresSeparados = (a, b) =>
  ["claro", "oscuro"].every((t) => {
    const A = aRgb(SEMANTICOS[t][a]);
    const B = aRgb(SEMANTICOS[t][b]);
    return (
      deltaE(A, B) >= NORMAL_MINIMO && deltaECvd(SEMANTICOS[t][a], SEMANTICOS[t][b]) >= CVD_OBJETIVO
    );
  });

// C1. ¿Cuántos colores admite una escala CATEGÓRICA hecha de tokens semánticos?
//     Es el techo que condena a `COLORES_RAZON`: tenía seis.
const nombresSem = Object.keys(SEMANTICOS.claro);
let mayorClique = [];
for (let mask = 1; mask < 1 << nombresSem.length; mask++) {
  const sub = nombresSem.filter((_, i) => mask & (1 << i));
  if (sub.length <= mayorClique.length) continue;
  let ok = true;
  for (let i = 0; i < sub.length && ok; i++) {
    for (let j = i + 1; j < sub.length && ok; j++) ok = paresSeparados(sub[i], sub[j]);
  }
  if (ok) mayorClique = sub;
}
console.log(
  `  C1  escala categórica más grande posible con estos tokens: ${mayorClique.length} colores` +
    ` (${mayorClique.join(", ")})\n` +
    "      Por eso los motivos de escalado NO usan escala categórica: eran seis.",
);

// C2. `COLORES_ATENCION`: la barra de tres franjas del reparto de la atención.
const ATENCION = ["ok", "info", "caution"];
let peorAtencion = { normal: Infinity, cvd: Infinity, par: "" };
for (const tema of ["claro", "oscuro"]) {
  for (let i = 0; i < ATENCION.length; i++) {
    for (let j = i + 1; j < ATENCION.length; j++) {
      const a = ATENCION[i];
      const b = ATENCION[j];
      const cvd = deltaECvd(SEMANTICOS[tema][a], SEMANTICOS[tema][b]);
      if (cvd < peorAtencion.cvd) {
        peorAtencion = {
          normal: deltaE(aRgb(SEMANTICOS[tema][a]), aRgb(SEMANTICOS[tema][b])),
          cvd,
          par: `${tema} ${a}/${b}`,
        };
      }
    }
  }
}
const atencionOk = peorAtencion.normal >= NORMAL_MINIMO && peorAtencion.cvd >= CVD_OBJETIVO;
console.log(
  `  C2  COLORES_ATENCION [${ATENCION.join("/")}]  peor par ${peorAtencion.par}:` +
    ` ${peorAtencion.normal.toFixed(1)} normal · ${peorAtencion.cvd.toFixed(1)} CVD` +
    `  ${atencionOk ? "ok" : "BAJO"}`,
);
if (!atencionOk) fallas.push("COLORES_ATENCION: dos franjas de la barra no se separan");

// C3. `escalaSecuencial`: hasta cuántos tramos aguanta la rampa de un tono.
//     Se mide sobre las CUATRO superficies donde la barra se dibuja de verdad
//     (dos temas x track de la barra y fondo de la tarjeta), no sobre una sola.
const SUPERFICIES_BARRA = { claro: ["#f1f2f4", "#ffffff"], oscuro: ["#14161b", "#0f1116"] };
const ALFA_MINIMO_RAMPA = 0.28;
const TRAMOS_DECLARADOS = 5;

function peorEscalonDeRampa(tramos) {
  let peor = Infinity;
  for (const tema of ["claro", "oscuro"]) {
    const base = aRgb(SEMANTICOS[tema].info);
    for (const fondo of SUPERFICIES_BARRA[tema]) {
      const f = aRgb(fondo);
      const pasos = Array.from({ length: tramos }, (_, i) =>
        componer(base, 1 - i * ((1 - ALFA_MINIMO_RAMPA) / (tramos - 1)), f),
      );
      for (let i = 0; i + 1 < tramos; i++) {
        const cvd = Math.min(
          deltaE(simular(pasos[i], "protan"), simular(pasos[i + 1], "protan")),
          deltaE(simular(pasos[i], "deutan"), simular(pasos[i + 1], "deutan")),
        );
        if (cvd < peor) peor = cvd;
      }
    }
  }
  return peor;
}

const rampaDeclarada = peorEscalonDeRampa(TRAMOS_DECLARADOS);
const rampaUnaMas = peorEscalonDeRampa(TRAMOS_DECLARADOS + 1);
const rampaOk = rampaDeclarada >= CVD_OBJETIVO;
console.log(
  `  C3  escalaSecuencial con ${TRAMOS_DECLARADOS} tramos: peor escalón` +
    ` ${rampaDeclarada.toFixed(1)} CVD  ${rampaOk ? "ok" : "BAJO"}   ·   con` +
    ` ${TRAMOS_DECLARADOS + 1} daría ${rampaUnaMas.toFixed(1)}, por eso TRAMOS_RAMPA es` +
    ` ${TRAMOS_DECLARADOS}`,
);
if (!rampaOk) {
  fallas.push(`la rampa de ${TRAMOS_DECLARADOS} tramos no llega al objetivo CVD ${CVD_OBJETIVO}`);
}

// ───────────────────────────────────────────────────────────────────────────
// D. TINTA DE TEXTO (`--ink-*`), los dos temas, leída de `globals.css`.
//    Vara: 4.5:1 (WCAG 1.4.3, texto de cuerpo) sobre cada superficie donde se
//    escribe texto. `ink-ghost` se usa en más de 200 textos de 10-12 px, así
//    que no califica como "texto grande" en ningún caso.
//    Las superficies de texto oscuras incluyen `#1c1f24`, el fondo de los
//    badges (`bg-surface-*` + borde) medido en el QA del 2026-09-26.
// ───────────────────────────────────────────────────────────────────────────

const { readFileSync } = await import("node:fs");
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
function bloque(selector) {
  const inicio = css.indexOf(`${selector} {`);
  if (inicio < 0) throw new Error(`no encontré el bloque ${selector} en globals.css`);
  return css.slice(inicio, css.indexOf("\n}", inicio));
}
function variable(texto, nombre) {
  const m = texto.match(new RegExp(`--${nombre}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`falta --${nombre}`);
  return m[1];
}
const TINTAS = [
  "ink-primary",
  "ink-body",
  "ink-secondary",
  "ink-muted",
  "ink-dim",
  "ink-faint",
  "ink-fainter",
  "ink-ghost",
];
const SUPERFICIES_TEXTO = {
  claro: {
    selector: ":root",
    fondos: ["surface-card", "surface-root", "surface-input", "surface-hover"],
  },
  oscuro: {
    selector: ".dark",
    fondos: ["surface-root", "surface-card", "surface-input", "surface-bubble-in"],
    extra: ["#1c1f24"],
  },
};
for (const [tema, conf] of Object.entries(SUPERFICIES_TEXTO)) {
  const b = bloque(conf.selector);
  const fondos = [...conf.fondos.map((f) => variable(b, f)), ...(conf.extra ?? [])];
  console.log(`\nTinta de texto — tema ${tema}\n  (fondos ${fondos.join(" · ")})\n`);
  let anterior = Infinity;
  for (const tinta of TINTAS) {
    const hex = variable(b, tinta);
    const peor = Math.min(...fondos.map((f) => contraste(aRgb(hex), aRgb(f))));
    const ok = peor >= CONTRASTE_MINIMO;
    // La escalera tiene que seguir bajando: un escalón "más tenue" que
    // contrasta más que el anterior invierte la jerarquía.
    const orden = peor <= anterior + 1e-9;
    console.log(
      `  ${tinta.padEnd(14)} ${hex}  peor ${peor.toFixed(2)}  ${ok ? "ok" : "BAJO"}${orden ? "" : "  FUERA DE ORDEN"}`,
    );
    if (!ok) fallas.push(`${tema}: --${tinta} ${peor.toFixed(2)} < ${CONTRASTE_MINIMO}`);
    if (!orden) fallas.push(`${tema}: --${tinta} contrasta más que el escalón anterior`);
    anterior = peor;
  }
}

if (fallas.length > 0) {
  console.error(`\nFALLA: ${fallas.join("; ")}`);
  process.exit(1);
}
console.log("\nTodas las varas se cumplen.");
