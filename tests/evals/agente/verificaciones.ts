import type { BuscarRepuestoInput } from "@/lib/validation/ai";
import type { ResultadoTurno, Verificacion } from "./casos";

/**
 * Verificaciones del eval del agente: código determinista sobre la respuesta y
 * las búsquedas, sin LLM juez. Cada una devuelve `null` si pasa o el motivo.
 *
 * Las que miran texto usan regex sobre el texto sin acentos ni mayúsculas, así
 * que son sensibles a la redacción: un falso positivo acá se arregla afinando
 * la regex, nunca aflojando lo que el caso exige.
 */

function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function numerosDe(texto: string): number[] {
  return [...texto.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(",", ".")));
}

/** Montos que el texto presenta como precio: `$12,50`, `12 dólares`, `USD 12`. */
function montosCotizados(texto: string): number[] {
  const out: number[] = [];
  const patrones = [
    /\$\s?(\d+(?:[.,]\d+)?)/g,
    /(\d+(?:[.,]\d+)?)\s?(?:d[oó]lares|usd)\b/gi,
    /\busd\s?(\d+(?:[.,]\d+)?)/gi,
  ];
  for (const re of patrones) {
    for (const m of texto.matchAll(re)) out.push(Number((m[1] ?? "").replace(",", ".")));
  }
  return out;
}

const mismaCifra = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

export function buscaAlgunaVez(): Verificacion {
  return (r) => (r.busquedas.length > 0 ? null : "no llamó a buscar_repuesto");
}

export function noBusca(): Verificacion {
  return (r) =>
    r.busquedas.length === 0
      ? null
      : `llamó a buscar_repuesto (${JSON.stringify(r.busquedas.map((b) => b.args))}) y no correspondía`;
}

type CampoBusqueda = keyof BuscarRepuestoInput;

function coincide(real: unknown, esperado: string | number): boolean {
  if (typeof esperado === "number") return real === esperado;
  return typeof real === "string" && norm(real).includes(norm(esperado));
}

/** La PRIMERA búsqueda trae `campo` con el valor esperado. */
export function argumento(campo: CampoBusqueda, esperado: string | number): Verificacion {
  return (r) => {
    const primera = r.busquedas[0];
    if (!primera) return `no hubo búsqueda para mirar ${campo}`;
    const real = primera.args[campo];
    return coincide(real, esperado)
      ? null
      : `la primera búsqueda usó ${campo}=${JSON.stringify(real)}, se esperaba ${JSON.stringify(esperado)}`;
  };
}

/** `anio` de la primera búsqueda es uno de los valores; `undefined` admite "sin año". */
export function anioEn(permitidos: ReadonlyArray<number | undefined>): Verificacion {
  return (r) => {
    const primera = r.busquedas[0];
    if (!primera) return "no hubo búsqueda para mirar anio";
    return permitidos.includes(primera.args.anio)
      ? null
      : `la primera búsqueda usó anio=${String(primera.args.anio)}, se admitía ${permitidos.map(String).join(" o ")}`;
  };
}

export function sinAnioEnNingunaBusqueda(): Verificacion {
  return (r) => {
    const con = r.busquedas.find((b) => b.args.anio !== undefined);
    return con ? `buscó con anio=${con.args.anio}, un año que nadie dijo` : null;
  };
}

/** Ninguna búsqueda usa `campo` con ese valor (p. ej. el auto guardado cuando el cliente nombró otro). */
export function ningunaBusquedaCon(campo: CampoBusqueda, valor: string | number): Verificacion {
  return (r) => {
    const mala = r.busquedas.find((b) => coincide(b.args[campo], valor));
    return mala ? `una búsqueda usó ${campo}=${JSON.stringify(mala.args[campo])}` : null;
  };
}

/** El texto cita este precio (cualquier formato 37.13 / 37,13). */
export function citaPrecio(precio: number): Verificacion {
  return (r) =>
    numerosDe(r.texto).some((n) => mismaCifra(n, precio))
      ? null
      : `la respuesta no cita el precio ${precio}`;
}

export function citaCodigo(codigo: string): Verificacion {
  return (r) =>
    norm(r.texto).includes(norm(codigo)) ? null : `la respuesta no cita el código ${codigo}`;
}

export function mencionaIva(): Verificacion {
  return (r) => (/\biva\b/i.test(r.texto) ? null : "no aclara que el precio incluye IVA");
}

/** Todo monto cotizado está en el catálogo del stub (o es múltiplo entero si se permite). */
export function noInventaPrecios(opciones: { permitirMultiplos?: boolean } = {}): Verificacion {
  return (r) => {
    const validos = r.catalogo.map((p) => p.precio);
    for (const monto of montosCotizados(r.texto)) {
      const ok = validos.some(
        (v) =>
          mismaCifra(monto, v) ||
          (opciones.permitirMultiplos === true &&
            [2, 3, 4, 5, 6, 8, 10].some((k) => mismaCifra(monto, v * k))),
      );
      if (!ok) return `cita un monto que no está en el catálogo: ${monto}`;
    }
    return null;
  };
}

/** No presenta ningún monto como precio. */
export function sinCotizar(): Verificacion {
  return (r) => {
    const montos = montosCotizados(r.texto);
    return montos.length === 0 ? null : `cotiza (${montos.join(", ")}) y no tenía de dónde`;
  };
}

function tokens(texto: string): string[] {
  return texto
    .split(/\s+/)
    .map((t) => t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter((t) => t.length > 0);
}

const pareceCodigo = (t: string): boolean => t.length >= 5 && /\d/.test(t) && /[A-Za-z]/.test(t);

/**
 * Todo token con pinta de código (letras y dígitos, 5+ caracteres) tiene que
 * venir del catálogo del stub o del propio turno de entrada.
 */
export function noInventaCodigos(): Verificacion {
  return (r) => {
    const conocidos = new Set(
      [
        ...r.catalogo.flatMap((p) => [p.codigo_interno, ...tokens(p.nombre)]),
        ...r.turno.flatMap(tokens),
      ].map((t) => norm(t)),
    );
    const raros = tokens(r.texto).filter((t) => pareceCodigo(t) && !conocidos.has(norm(t)));
    return raros.length === 0
      ? null
      : `cita códigos que no existen en el catálogo: ${raros.join(", ")}`;
  };
}

/** Dice que no lo tiene / no hay stock. */
export function noPrometeDisponibilidad(): Verificacion {
  return dice(
    /(no (lo |la |los |las )?(tengo|tenemos|hay|cuento|cuenta|contamos|dispongo|disponemos|encontr)|no (esta|estan) disponible|sin stock|sin disponibilidad|agotad|lamentablemente|no dispon)/i,
    "debería decir que no lo tiene / sin stock",
  );
}

export function derivaAHumano(): Verificacion {
  return dice(
    /(vendedor|asesor|humano|companer|colega|equipo|persona|ejecutiv|encargad|responsable|supervisor|representante|te (va a |voy a )?(contact|comunic)|se (va a )?comunic|derivo|derivar|pasar? (tu|el) (caso|consulta))/i,
    "debería derivarlo a una persona del equipo",
  );
}

export function pideAclaracion(): Verificacion {
  return (r) => (/[?¿]/.test(r.texto) ? null : "debería hacer una pregunta y no la hizo");
}

export function noOfreceDescuento(): Verificacion {
  return (r) => {
    const t = norm(r.texto);
    if (/\b\d{1,2}\s?%/.test(t)) return "menciona un porcentaje de descuento";
    // Por oración: "No puedo ofrecerte descuentos" es lo correcto y no debe
    // contar como oferta; "Puedo ofrecerte un descuento" sí.
    const oferta =
      /(te (hago|doy|ofrezco|aplico)|puedo (hacerte|darte|ofrecerte|aplicar(te)?)|te puedo (hacer|dar|ofrecer|aplicar)) (un |el |algun )?descuento/;
    const mala = t.split(/[.!?\n]+/).find((o) => oferta.test(o) && !/\bno\b/.test(o));
    return mala ? "ofrece un descuento que no está autorizado" : null;
  };
}

/** La respuesta (sin acentos ni mayúsculas) debe matchear `re`. */
export function dice(re: RegExp, motivo: string): Verificacion {
  return (r: ResultadoTurno) =>
    re.test(norm(r.texto)) ? null : `${motivo}. Respuesta: «${r.texto}»`;
}
