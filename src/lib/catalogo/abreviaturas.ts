import { plegarTexto } from "@/lib/catalogo/plegar-texto";

/**
 * Las abreviaturas del inventario y cómo se pliega a ellas lo que escribe el cliente.
 *
 * OBSERVACION: «necesito los amortiguadores delanteros para el Kia Niro 2020»
 * devolvía dos filas basura (`290 AMORTIGUADORES DEL CH TAOHE 2011`, grupo
 * `REPUESTO EMG`, sin existencia) y ocultaba `KIA NIRO HYB 17- LH/RH`, que sí
 * están. CAUSA RAIZ: el inventario escribe `AMORTIG DELT`; el cliente dice
 * «amortiguadores delanteros». La búsqueda de texto exigía que la palabra del
 * cliente fuera una subcadena del catálogo, y `amortiguadores` no está dentro de
 * `AMORTIG` ni `delanteros` dentro de `DELT`.
 *
 * **Este módulo es el espejo TypeScript de `public.catalogo_raiz`, de la
 * normalización de la consulta de `public.buscar_productos` y de la tabla
 * `catalogo_abreviaturas`** (20261008120000 y 20261008120100). Si divergen, la
 * suite pasa en verde y el agente ordena distinto contra la base real.
 *
 * Nada de lo que hay acá sabe qué abreviaturas existen: salen de la tabla, que
 * carga el dueño (`scripts/catalogo/cargar-abreviaturas.mjs`). Con la tabla
 * vacía, solo queda el prefijo (`amortiguadores` ~ `AMORTIG`).
 */

export type TipoAbreviatura = "pieza" | "posicion" | "atributo" | "ruido";
export type AmbitoAbreviatura = "categoria" | "nombre" | "ambos";

/** Una fila de `catalogo_abreviaturas`. */
export interface Abreviatura {
  abrev: string;
  expansion: string;
  tipo: TipoAbreviatura;
  ambito: AmbitoAbreviatura;
  confianza: "alta" | "media" | "baja";
  confirmado: boolean;
}

/** Misma regla que la columna generada `activo` de `catalogo_abreviaturas`. */
export function abreviaturaActiva(a: Pick<Abreviatura, "confianza" | "confirmado">): boolean {
  return a.confirmado || a.confianza === "alta";
}

/** El largo mínimo de una palabra del cliente para compararla por prefijo. */
export const LARGO_MINIMO_PALABRA_PREFIJO = 5;
/** El largo mínimo de la abreviatura del catálogo que puede ser prefijo de una palabra. */
export const LARGO_MINIMO_PREFIJO = 4;

/** Las palabras de un texto: plegadas y partidas en todo lo que no sea letra o cifra. */
export function tokensDe(texto: string | null | undefined): string[] {
  return plegarTexto(texto ?? "")
    .split(/[^0-9a-z]+/)
    .filter((t) => t !== "");
}

/**
 * La raíz de una palabra: sin tildes, sin plural y sin la vocal final, para que
 * «amortiguadores» y «amortiguador», o «delanteros» y «delantera», sean la misma.
 * Espeja `public.catalogo_raiz`.
 */
export function raizDe(palabra: string): string {
  const p = plegarTexto(palabra.trim());
  let s = p;
  if (p.length > 4 && /[rldnz]es$/.test(p)) s = p.slice(0, -2);
  else if (p.length > 3 && p.endsWith("s")) s = p.slice(0, -1);
  return s.length >= 5 && /[aeo]$/.test(s) ? s.slice(0, -1) : s;
}

/**
 * Los prefijos de una palabra que pueden ser una abreviatura del catálogo
 * (`amortiguadores` -> `amor`, `amort`, ... `amortiguadore`). Vacío si la
 * palabra es corta o trae algo que no sea letra o cifra.
 */
export function prefijosDe(palabra: string): string[] {
  if (palabra.length < LARGO_MINIMO_PALABRA_PREFIJO || !/^[0-9a-z]+$/.test(palabra)) return [];
  const salida: string[] = [];
  for (let k = LARGO_MINIMO_PREFIJO; k < palabra.length; k++) salida.push(palabra.slice(0, k));
  return salida;
}

/**
 * La expansión de una abreviatura tal como la escribe el dueño en el CSV puede traer
 * una aclaración entre paréntesis («posterior (trasero)», «bocín (buje)») o varias
 * lecturas separadas por `;`. Lo que se compara es la cabeza: «posterior», «bocín».
 * Espeja `public.catalogo_cabeza`.
 */
export function cabezaDeExpansion(expansion: string): string {
  return (expansion.split("(")[0] ?? "").split(";")[0]?.trim() ?? "";
}

export type Lado =
  | "delantero"
  | "posterior"
  | "izquierdo"
  | "derecho"
  | "superior"
  | "inferior"
  | "exterior"
  | "interior";
/** Los lados que se excluyen entre sí: delante/atrás, izquierda/derecha, arriba/abajo, afuera/adentro. */
export type FamiliaDeLado = "eje" | "costado" | "altura" | "cara";

const LADO_DE_RAIZ: Readonly<Record<string, Lado>> = {
  delanter: "delantero",
  anterior: "delantero",
  frontal: "delantero",
  posterior: "posterior",
  traser: "posterior",
  izquierd: "izquierdo",
  derech: "derecho",
  superior: "superior",
  inferior: "inferior",
  exterior: "exterior",
  interior: "interior",
};

/** Qué lado dice la expansión de una abreviatura de posición; `null` si no es ninguno. */
export function ladoDe(expansion: string): Lado | null {
  return LADO_DE_RAIZ[raizDe(expansion)] ?? null;
}

/** La llave bajo la que se indexan las posiciones de un lado (no choca con ninguna raíz). */
const claveDeLado = (l: Lado): string => `lado:${l}`;

export const familiaDe = (l: Lado): FamiliaDeLado => {
  if (l === "delantero" || l === "posterior") return "eje";
  if (l === "izquierdo" || l === "derecho") return "costado";
  return l === "superior" || l === "inferior" ? "altura" : "cara";
};

/** Lo que el cliente pidió de una palabra: pieza, posición o atributo. */
export interface PalabraAnalizada {
  /** Plegada, como la ve la búsqueda. */
  palabra: string;
  /**
   * `true` si la palabra dice QUE pieza es y por lo tanto puntúa y admite filas.
   * Las posiciones («delanteros», «izquierdo») y los atributos son filtros.
   */
  requerida: boolean;
  /** Las abreviaturas de pieza a las que se pliega (vacío si ninguna). */
  abrevs: readonly Abreviatura[];
  /** Los prefijos que podrían ser una abreviatura del catálogo. */
  prefijos: readonly string[];
}

/** Un token del catálogo que cuenta como esa palabra, y dónde vale. */
export interface Termino {
  token: string;
  ambito: AmbitoAbreviatura;
}

export const terminosDe = (w: PalabraAnalizada): Termino[] => [
  ...w.abrevs.flatMap((a) => {
    const ts = tokensDe(a.abrev);
    // Solo las abreviaturas de una palabra: una frase no es un token.
    return ts.length === 1 ? [{ token: ts[0] as string, ambito: a.ambito }] : [];
  }),
  ...w.prefijos.map((token) => ({ token, ambito: "ambos" as const })),
];

/** Lo que la búsqueda entiende de la consulta del cliente. */
export interface PedidoAnalizado {
  /** Todas las palabras útiles, sin repetir. */
  palabras: readonly PalabraAnalizada[];
  /** Las que dicen qué pieza es. */
  requeridas: readonly PalabraAnalizada[];
  /** Los lados que pidió («delanteros» -> delantero). */
  lados: readonly Lado[];
  /** Los tokens de los atributos que pidió: suman al orden, no filtran. */
  atributos: readonly string[];
}

export interface IndiceAbreviaturas {
  /** Abreviaturas activas que no son ruido, por la raíz de su expansión. */
  porRaiz: ReadonlyMap<string, readonly Abreviatura[]>;
  /** Abreviaturas activas que no son ruido, por su token (una sola palabra). */
  porToken: ReadonlyMap<string, readonly Abreviatura[]>;
  /** Grupos del ERP que son basura (REPUESTO EMG): categorías y nombres, plegados. */
  ruidoCategorias: ReadonlySet<string>;
  ruidoNombres: ReadonlySet<string>;
  /** Lo contrario: `abrev -> lado` de las abreviaturas de posición. */
  ladosPorToken: ReadonlyMap<string, readonly Lado[]>;
  /** `token -> expansion` para escribir los nombres de pieza legibles. */
  expansionPorToken: ReadonlyMap<string, string>;
}

export const INDICE_VACIO: IndiceAbreviaturas = {
  porRaiz: new Map(),
  porToken: new Map(),
  ruidoCategorias: new Set(),
  ruidoNombres: new Set(),
  ladosPorToken: new Map(),
  expansionPorToken: new Map(),
};

const normalizarClave = (t: string): string => tokensDe(t).join(" ");

function agregar<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

/** Arma el índice con las abreviaturas ACTIVAS; las demás se ignoran. */
export function indexarAbreviaturas(lista: readonly Abreviatura[]): IndiceAbreviaturas {
  const porRaiz = new Map<string, Abreviatura[]>();
  const porToken = new Map<string, Abreviatura[]>();
  const ladosPorToken = new Map<string, Lado[]>();
  const expansionPorToken = new Map<string, string>();
  const ruidoCategorias = new Set<string>();
  const ruidoNombres = new Set<string>();

  for (const a of lista) {
    if (!abreviaturaActiva(a)) continue;
    if (a.tipo === "ruido") {
      const clave = normalizarClave(a.abrev);
      if (clave === "") continue;
      if (a.ambito !== "nombre") ruidoCategorias.add(clave);
      if (a.ambito !== "categoria") ruidoNombres.add(clave);
      continue;
    }
    const tokens = tokensDe(a.abrev);
    const token = tokens.length === 1 ? (tokens[0] as string) : null;
    const cabeza = cabezaDeExpansion(a.expansion);
    const lado = a.tipo === "posicion" ? ladoDe(cabeza) : null;
    if (token !== null) {
      agregar(porToken, token, a);
      if (!expansionPorToken.has(token)) expansionPorToken.set(token, cabeza);
      if (lado !== null) agregar(ladosPorToken, token, lado);
    }
    // La expansión de varias palabras («caja de cambios») nunca iguala a UNA palabra del cliente.
    if (tokensDe(cabeza).length === 1) agregar(porRaiz, raizDe(cabeza), a);
    // «traseros» y «posteriores» dicen lo mismo: las posiciones también se buscan por lado.
    if (lado !== null) agregar(porRaiz, claveDeLado(lado), a);
  }
  return {
    porRaiz,
    porToken,
    ruidoCategorias,
    ruidoNombres,
    ladosPorToken,
    expansionPorToken,
  };
}

/** Relleno que no dice nada de la pieza. Misma lista que el `not in (...)` de `buscar_productos`. */
export const VACIAS_CONSULTA = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "para",
  "con",
  "y",
  "o",
  "mi",
  "me",
  "por",
  "que",
  "tiene",
  "tienen",
  "tenes",
  "tienes",
  "hay",
  "busco",
  "necesito",
  "quiero",
  "precio",
  "cuanto",
  "cuesta",
]);

/** Las palabras útiles de lo que escribió el cliente, sin repetir (como el `select distinct` de SQL). */
export function palabrasUtiles(q: string): string[] {
  const vistas = new Set<string>();
  for (const t of plegarTexto(q.trim()).split(/[^0-9a-z/.*-]+/)) {
    if (t.length > 1 && !VACIAS_CONSULTA.has(t)) vistas.add(t);
  }
  return [...vistas];
}

/** A qué abreviaturas se pliega una palabra: por su raíz o porque ES la abreviatura. */
export function abreviaturasDe(palabra: string, indice: IndiceAbreviaturas): Abreviatura[] {
  const vistas = new Set<Abreviatura>();
  for (const a of indice.porRaiz.get(raizDe(palabra)) ?? []) vistas.add(a);
  const lado = ladoDe(palabra);
  if (lado !== null) for (const a of indice.porRaiz.get(claveDeLado(lado)) ?? []) vistas.add(a);
  for (const a of indice.porToken.get(palabra) ?? []) vistas.add(a);
  return [...vistas];
}

/** Separa lo que dice qué pieza es de las posiciones y atributos. */
export function analizarConsulta(
  q: string,
  indice: IndiceAbreviaturas = INDICE_VACIO,
): PedidoAnalizado {
  const lados = new Set<Lado>();
  const atributos = new Set<string>();
  const palabras: PalabraAnalizada[] = [];

  const utiles = palabrasUtiles(q).map((palabra) => {
    const todas = abreviaturasDe(palabra, indice);
    const deLaPieza = todas.filter((a) => a.tipo === "pieza");
    return { palabra, todas, deLaPieza, requerida: todas.length === 0 || deLaPieza.length > 0 };
  });
  // Si TODAS son filtros («diésel», «izquierdo») no hay nada que obligue: vale el texto.
  const soloFiltros = utiles.length > 0 && utiles.every((u) => !u.requerida);

  for (const u of utiles) {
    const requerida = u.requerida || soloFiltros;
    if (!requerida) {
      for (const a of u.todas) {
        if (a.tipo === "posicion") {
          const lado = ladoDe(cabezaDeExpansion(a.expansion));
          if (lado !== null) lados.add(lado);
        } else if (a.tipo === "atributo") {
          for (const t of tokensDe(a.abrev)) atributos.add(t);
        }
      }
    }
    palabras.push({
      palabra: u.palabra,
      requerida,
      abrevs: u.requerida ? u.deLaPieza : [],
      prefijos: requerida ? prefijosDe(u.palabra) : [],
    });
  }
  return {
    palabras,
    requeridas: palabras.filter((w) => w.requerida),
    lados: [...lados],
    atributos: [...atributos],
  };
}

/** ¿El token vale en esa columna? */
export const valeEn = (ambito: AmbitoAbreviatura, columna: "categoria" | "nombre"): boolean =>
  ambito === "ambos" || ambito === columna;

/** Los tokens de las dos columnas donde se busca la pieza. */
export interface TokensDeFila {
  categoria: readonly string[];
  nombre: readonly string[];
}

export function tokensDeFila(f: {
  categoria?: string | null | undefined;
  nombre?: string | null | undefined;
}): TokensDeFila {
  return { categoria: tokensDe(f.categoria), nombre: tokensDe(f.nombre) };
}

/** ¿Alguno de los términos de la palabra está en las columnas donde vale? */
export function terminoAcierta(w: PalabraAnalizada, f: TokensDeFila): boolean {
  return terminosDe(w).some(
    (t) =>
      (valeEn(t.ambito, "categoria") && f.categoria.includes(t.token)) ||
      (valeEn(t.ambito, "nombre") && f.nombre.includes(t.token)),
  );
}

/** Un grupo del ERP que no es un repuesto (`catalogo_grupos_excluidos`). */
export interface GrupoExcluido {
  grupo: string;
  /** La carga del ERP además lo deja inactivo. */
  inactivar: boolean;
}

/** La clave con la que se compara un grupo: plegada y sin blancos de los extremos. */
export const claveDeGrupo = (g: string | null | undefined): string => plegarTexto((g ?? "").trim());

/**
 * ¿El producto es de un grupo que NUNCA se busca ni se cotiza (GASTOS VARIOS, OTROS,
 * REPUESTO EMG...)? La lista vive en `catalogo_grupos_excluidos`, no en el código.
 * Espeja el filtro de `base` en `buscar_productos`.
 */
export function esDeGrupoExcluido(
  f: { categoria?: string | null | undefined },
  grupos: ReadonlySet<string>,
): boolean {
  return grupos.has(claveDeGrupo(f.categoria));
}

/** ¿La categoría del producto es un grupo basura del ERP (REPUESTO EMG)? */
export function esRuido(
  f: { categoria?: string | null | undefined; nombre?: string | null | undefined },
  indice: IndiceAbreviaturas,
): boolean {
  return (
    indice.ruidoCategorias.has(tokensDe(f.categoria).join(" ")) ||
    indice.ruidoNombres.has(tokensDe(f.nombre).join(" "))
  );
}

/** Los lados que declara un producto en su nombre o su categoría (`LH`, `DELT`...). */
export function ladosDeFila(
  f: { categoria?: string | null | undefined; nombre?: string | null | undefined },
  indice: IndiceAbreviaturas,
): Lado[] {
  const vistos = new Set<Lado>();
  for (const t of [...tokensDe(f.nombre), ...tokensDe(f.categoria)]) {
    for (const l of indice.ladosPorToken.get(t) ?? []) vistos.add(l);
  }
  return [...vistos];
}

/**
 * Cómo se lleva un producto con los lados que pidió el cliente.
 * 2: tiene el lado pedido · 1: no dice lado (no sabemos) · 0: dice el contrario
 * (pidió delanteros y es `POST`): no se ofrece. Sin lados pedidos, 1 para todos.
 */
export function nivelDeLado(
  f: { categoria?: string | null | undefined; nombre?: string | null | undefined },
  pedidos: readonly Lado[],
  indice: IndiceAbreviaturas,
): 0 | 1 | 2 {
  if (pedidos.length === 0) return 1;
  const tiene = ladosDeFila(f, indice);
  let todosConfirmados = true;
  for (const familia of new Set(pedidos.map(familiaDe))) {
    const pedidosDeLaFamilia = pedidos.filter((l) => familiaDe(l) === familia);
    const delaFamilia = tiene.filter((l) => familiaDe(l) === familia);
    if (delaFamilia.some((l) => pedidosDeLaFamilia.includes(l))) continue;
    if (delaFamilia.length > 0) return 0;
    todosConfirmados = false;
  }
  return todosConfirmados ? 2 : 1;
}

/**
 * ¿Este token del catálogo dice lo mismo que esta palabra del cliente? Por
 * igualdad, por raíz, porque es su abreviatura o porque es un prefijo suyo.
 */
export function tokenDiceLaPalabra(
  token: string,
  palabra: string,
  indice: IndiceAbreviaturas,
): boolean {
  if (token === palabra || raizDe(token) === raizDe(palabra)) return true;
  if (prefijosDe(palabra).includes(token)) return true;
  return (indice.porToken.get(token) ?? []).some(
    (a) =>
      a.tipo !== "ruido" &&
      tokensDe(cabezaDeExpansion(a.expansion)).length === 1 &&
      raizDe(cabezaDeExpansion(a.expansion)) === raizDe(palabra),
  );
}

/** Pone una frase del catálogo en palabras del cliente: `AMORTIG DELT` -> `amortiguador delantero`. */
export function expandirFrase(frase: string, indice: IndiceAbreviaturas): string {
  return tokensDe(frase)
    .map((t) => indice.expansionPorToken.get(t) ?? t)
    .map((t) => plegarTexto(t.trim()))
    .join(" ");
}
