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

/**
 * `anio` ausente, `null` o 0 significan lo mismo: "no sé el año". El modelo manda
 * 0 cuando el schema lo declara opcional; hoy `buscar_productos` ignora el año
 * (el catálogo no trae `compatibilidad`), así que 0 no cambia el resultado. Un
 * año real (2005) sigue contando como año.
 */
function anioDesconocido(anio: number | null | undefined): boolean {
  return anio === undefined || anio === null || anio === 0;
}

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
    const real = anioDesconocido(primera.args.anio) ? undefined : primera.args.anio;
    return permitidos.includes(real)
      ? null
      : `la primera búsqueda usó anio=${String(primera.args.anio)}, se admitía ${permitidos.map(String).join(" o ")}`;
  };
}

export function sinAnioEnNingunaBusqueda(): Verificacion {
  return (r) => {
    const con = r.busquedas.find((b) => !anioDesconocido(b.args.anio));
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
    // Un producto "a consultar" (precio null) no habilita ningún monto.
    const validos = r.catalogo.flatMap((p) => (p.precio === null ? [] : [p.precio]));
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
    return montos.length === 0 ? null : `cotizó (${montos.join(", ")}) y no correspondía cotizar`;
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
    /(no (te |se )?(lo |la |los |las )?(tengo|tenemos|hay|cuento|cuenta|contamos|dispongo|disponemos|encuentr|encontr|figur|aparec)|no (esta|estan) disponible|sin stock|sin disponibilidad|agotad|lamentablemente|no dispon)/i,
    "debería decir que no lo tiene / sin stock",
  );
}

export function derivaAHumano(): Verificacion {
  return dice(
    /(vendedor|asesor|humano|companer|colega|equipo|persona|ejecutiv|encargad|responsable|supervisor|representante|te (va a |voy a )?(contact|comunic)|se (va a )?comunic|derivo|derivar|pasar? (tu|el) (caso|consulta))/i,
    "debería derivarlo a una persona del equipo",
  );
}

/**
 * Pregunta (con `?`) o pide el dato en imperativo ("decime la sobremedida"):
 * las dos formas son pedir, y exigir el signo marcaba como falla una respuesta
 * correcta.
 */
function pideAlgo(texto: string): boolean {
  return (
    /[?¿]/.test(texto) ||
    /\b(decime|dime|contame|cuentame|avisame|indicame|pasame|confirmame|aclarame|necesito (saber|que me)|me (decis|dices|confirmas|indicas|pasas|avisas)|por favor (indic|inform|conf))/.test(
      norm(texto),
    )
  );
}

/**
 * El cliente ya nombró el modelo: no vuelve a pedirle el modelo ni la marca
 * (preguntar el año o la cilindrada que difieren sí está permitido).
 */
export function noVuelveAPedirElModelo(): Verificacion {
  return (r) =>
    /(que (modelo|auto|vehiculo|marca)|cual (es )?(el|la) (modelo|marca)|(modelo|marca) (es|de tu|del))/.test(
      norm(r.texto),
    )
      ? `volvió a pedir el modelo o la marca que el cliente ya nombró. Respuesta: «${r.texto}»`
      : null;
}

/** Pregunta algo y lo que pregunta es por el vehículo (marca, modelo o año). */
export function pideVehiculo(): Verificacion {
  return pideDato(/(vehiculo|auto\b|carro|camioneta|marca|modelo|\bano\b)/, "el vehículo");
}

/** Hay un `?` y la respuesta menciona el dato (regex sin acentos) que tendría que pedir. */
export function pideDato(re: RegExp, dato: string): Verificacion {
  return (r) => {
    if (!pideAlgo(r.texto)) return `debería preguntar por ${dato} y no preguntó ni lo pidió`;
    return re.test(norm(r.texto))
      ? null
      : `hizo una pregunta pero no por ${dato}. Respuesta: «${r.texto}»`;
  };
}

/** Las verificaciones solo corren si el agente buscó; si no buscó, no hay nada que mirar. */
export function siBusca(...verificaciones: Verificacion[]): Verificacion {
  return (r) => {
    if (r.busquedas.length === 0) return null;
    for (const v of verificaciones) {
      const motivo = v(r);
      if (motivo) return motivo;
    }
    return null;
  };
}

export function pideAclaracion(): Verificacion {
  return (r) =>
    pideAlgo(r.texto) || /en que (te )?(puedo )?ayud/.test(norm(r.texto))
      ? null
      : "debería hacer una pregunta y no la hizo";
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

/**
 * Ninguna oración afirma tener/ofrecer algo que matchea `pieza` (sin negación).
 * Sirve para "pidieron pastillas, solo hay discos": presentar los discos como
 * discos es correcto; decir "tengo pastillas" no.
 */
export function noAfirmaTener(pieza: RegExp, nombre: string): Verificacion {
  return (r) => {
    const mala = norm(r.texto)
      .split(/[.!?\n]+/)
      .find(
        (o) =>
          pieza.test(o) &&
          /\b(tengo|tenemos|hay|disponible|disponibles|encontre|cuento|dispongo|te ofrezco|te paso)\b/.test(
            o,
          ) &&
          !/\bno\b/.test(o),
      );
    return mala ? `afirma tener ${nombre} y el catálogo no las devolvió: «${mala.trim()}»` : null;
  };
}

/** La respuesta (sin acentos ni mayúsculas) debe matchear `re`. */
export function dice(re: RegExp, motivo: string): Verificacion {
  return (r: ResultadoTurno) =>
    re.test(norm(r.texto)) ? null : `${motivo}. Respuesta: «${r.texto}»`;
}

// ─────────── Regla del dueño 2026-10-07: confirmar la pieza y cotizar con procedencia ───────────

/** Pregunta qué pieza quiere: nombra el conjunto completo y la base o la tapa. */
export function preguntaPieza(): Verificacion {
  return (r) => {
    if (!pideAlgo(r.texto)) return "debería preguntar qué pieza quiere y no preguntó";
    const t = norm(r.texto);
    return /(conjunto|completo)/.test(t) && /(base|tapa)/.test(t)
      ? null
      : `preguntó pero no ofreció las piezas (suelta, base/tapa, conjunto completo). Respuesta: «${r.texto}»`;
  };
}

/** Ningún precio presentado como rango: "entre $a y $b", "desde $a hasta $b", "$a a $b", "rango". */
export function sinRangoDePrecios(): Verificacion {
  const monto = String.raw`\$?\s*\d+(?:[.,]\d+)?`;
  const rangos = [
    new RegExp(String.raw`entre\s*${monto}\s*(?:y|a)\s*\$?\s*\d`),
    new RegExp(String.raw`desde\s*${monto}\s*(?:hasta|a)\s*\$?\s*\d`),
    new RegExp(String.raw`\$\s*\d+(?:[.,]\d+)?\s*(?:a|-|–)\s*\$\s*\d`),
    /\brango\b/,
  ];
  return (r) => {
    const t = norm(r.texto);
    return rangos.some((re) => re.test(t))
      ? `presentó un rango de precios en vez de un precio por opción. Respuesta: «${r.texto}»`
      : null;
  };
}

/** La procedencia y su precio van juntos: "MOBIS $12,96" (o "$12,96 MOBIS"). */
export function citaProcedenciaConPrecio(procedencia: string, precio: number): Verificacion {
  const num = precio.toFixed(2).replace(".", "[.,]");
  const delante = new RegExp(String.raw`${procedencia}[^0-9]{0,20}${num}`, "i");
  const detras = new RegExp(String.raw`${num}[^0-9]{0,20}${procedencia}`, "i");
  return (r) =>
    delante.test(r.texto) || detras.test(r.texto)
      ? null
      : `no presenta «${procedencia} $${precio}» junto. Respuesta: «${r.texto}»`;
}

/** La opción completa: «MOBIS (Original) $96,66». Marca, procedencia entre paréntesis y precio. */
export function citaOpcion(marca: string, procedencia: string, precio: number): Verificacion {
  const num = precio.toFixed(2).replace(".", "[.,]");
  const re = new RegExp(String.raw`${marca}\s*\(\s*${procedencia}\s*\)[^0-9]{0,15}${num}`, "i");
  return (r) =>
    re.test(r.texto)
      ? null
      : `no presenta «${marca} (${procedencia}) $${precio}» con ese formato. Respuesta: «${r.texto}»`;
}

/** Ninguno de estos precios aparece (son de otras piezas que el cliente no pidió). */
export function noCitaPrecios(precios: readonly number[], de: string): Verificacion {
  return (r) => {
    const citados = numerosDe(r.texto);
    const malo = precios.find((p) => citados.some((n) => mismaCifra(n, p)));
    return malo === undefined ? null : `cita el precio ${malo} de ${de}, que el cliente no pidió`;
  };
}

/** No cita ningún código interno del catálogo del stub (el dueño no los quiere salvo que los pida). */
export function sinCodigosDeProducto(): Verificacion {
  return (r) => {
    const citados = new Set(tokens(r.texto).map((t) => norm(t)));
    const malo = r.catalogo.find((p) => citados.has(norm(p.codigo_interno)));
    return malo ? `cita el código ${malo.codigo_interno}, que nadie pidió` : null;
  };
}

/** Pregunta qué pieza quiere y nombra TODAS las opciones (cada una, una expresión). */
export function preguntaEntre(...opciones: RegExp[]): Verificacion {
  return (r) => {
    if (!pideAlgo(r.texto)) return "debería preguntar qué pieza quiere y no preguntó";
    const t = norm(r.texto);
    const falta = opciones.find((re) => !re.test(t));
    return falta === undefined
      ? null
      : `preguntó pero no ofreció la opción ${falta}. Respuesta: «${r.texto}»`;
  };
}

/** La respuesta no menciona esto (es una pieza que el cliente no pidió ni tiene sentido ofrecer). */
export function noMenciona(re: RegExp, motivo: string): Verificacion {
  return (r) => (re.test(norm(r.texto)) ? `${motivo}. Respuesta: «${r.texto}»` : null);
}

/** Una sola línea y corta: la regla de respuestas mínimas. */
export function unaLineaCorta(maximo = 200): Verificacion {
  return (r) => {
    const t = r.texto.trim();
    return t.length <= maximo && !t.includes("\n")
      ? null
      : `no es una línea corta (${t.length} caracteres, ${t.split("\n").length} líneas). Respuesta: «${r.texto}»`;
  };
}

/**
 * No vuelve a preguntar qué pieza es: no ofrece otra pieza ("¿o la polea?") ni
 * pregunta por la parte. Un cierre ("¿querés que te reserve alguna?") está bien.
 */
export function noRepregunta(): Verificacion {
  return (r) => {
    const t = norm(r.texto);
    const otraPieza =
      /(polea|mangu|manguer|combustible|inyec|cual(es)? (pieza|parte)|que (pieza|parte))/;
    return pideAlgo(r.texto) && otraPieza.test(t)
      ? `volvió a preguntar por la pieza. Respuesta: «${r.texto}»`
      : null;
  };
}

/** No inventa la etiqueta «original»: la procedencia se dice con su nombre (MOBIS, KOREA…). */
export function noDiceOriginal(): Verificacion {
  return (r) =>
    /\boriginal(?:es)?\b/.test(norm(r.texto))
      ? `usó la etiqueta «original», que el dueño no usa. Respuesta: «${r.texto}»`
      : null;
}
