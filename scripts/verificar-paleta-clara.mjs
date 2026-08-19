/**
 * Verifica la paleta de etapas del tema claro contra las tres varas que la
 * gobiernan. Existe porque los valores viven en `src/app/globals.css` con
 * números en el comentario, y un número en un comentario que nadie puede
 * reproducir es una afirmación sin respaldo (AGENTS.md, lección 8).
 *
 *   node scripts/verificar-paleta-clara.mjs
 *
 * Las tres varas:
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

if (fallas.length > 0) {
  console.error(`\nFALLA: ${fallas.join("; ")}`);
  process.exit(1);
}
console.log("\nLas dos varas se cumplen.");
