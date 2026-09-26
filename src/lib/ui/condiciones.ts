/**
 * El modelo de un árbol de condiciones, compartido por el editor de workflows y
 * el constructor de audiencia de Difusión.
 *
 * ────────────────────────────────────────────────────────────────────────
 * POR QUÉ ES UN SOLO MODELO Y NO DOS
 * ────────────────────────────────────────────────────────────────────────
 *
 * Las dos pantallas hacen preguntas distintas —el workflow pregunta "¿este lead
 * cumple?" y devuelve sí/no; la difusión pregunta "¿quiénes cumplen?" y
 * devuelve un conjunto— pero **la gramática con la que se escribe la pregunta
 * es la misma**: campo, comparador, valor, agrupados con Y/O. Si cada pantalla
 * define la suya, el vendedor aprende dos idiomas para la misma operación
 * mental, y cada arreglo hay que hacerlo dos veces.
 *
 * Lo que cambia por dominio no está acá: el catálogo de campos, el vocabulario
 * de los comparadores y qué se cuenta con el resultado los aporta cada pantalla.
 *
 * ────────────────────────────────────────────────────────────────────────
 * LA DECISIÓN CENTRAL: un grupo tiene UN operador, no uno por fila
 * ────────────────────────────────────────────────────────────────────────
 *
 * La causa número uno de "le mandamos la promo a toda la base" en esta
 * industria es un `O` mal agrupado. `A Y B O C` se lee de izquierda a derecha
 * como "A y B, o si no C" y en realidad, con la precedencia de casi todos los
 * motores, es `A Y (B O C)`. Quien armó la condición quería una cosa y el
 * sistema hizo otra, y nadie se entera hasta que salieron 4.000 mensajes.
 *
 * **Acá esa expresión no se puede escribir.** El operador vive en el grupo, no
 * entre las filas: todas las filas hermanas se combinan con el mismo. Para
 * mezclar hay que crear un grupo, y un grupo es una caja con borde propio que
 * se ve. La ambigüedad no se valida ni se advierte: no existe.
 *
 * Por eso `Grupo.operador` es un campo del grupo y no una propiedad de cada
 * hijo, y por eso los chips `Y` que se dibujan entre filas son **un solo
 * control repetido** —tocar cualquiera cambia el del grupo—, cosa que la
 * interfaz enseña resaltándolos todos juntos al pasar el mouse por uno.
 */

/** Cómo se combinan los hijos de un grupo. */
export type Operador = "y" | "o";

export const OPERADOR_LABEL: Record<Operador, string> = { y: "Y", o: "O" };

/** Cómo se lee el grupo en voz alta, para el encabezado de la caja. */
export const OPERADOR_FRASE: Record<Operador, string> = {
  y: "se cumplen todas",
  o: "se cumple al menos una",
};

export function operadorOpuesto(o: Operador): Operador {
  return o === "y" ? "o" : "y";
}

/**
 * Los tipos de campo que el constructor sabe editar.
 *
 * `lista` y `multilista` son **campos cerrados**: etapas, etiquetas,
 * vendedores, intents, canales. Su valor se elige de una lista y no se escribe.
 * Es la mitad de la regla "ningún campo acepta código": la otra mitad es que
 * ni siquiera los campos abiertos aceptan plantillas — un `texto` es texto y se
 * compara literal.
 */
export type TipoCampo = "lista" | "multilista" | "texto" | "numero" | "fecha" | "booleano";

export interface OpcionCampo {
  valor: string;
  etiqueta: string;
  /** Hex opcional, para las etiquetas del lead, que tienen color propio. */
  color?: string;
}

/**
 * Los comparadores. Ninguno acepta una expresión: son operaciones cerradas
 * sobre un campo y un valor elegido.
 */
export const COMPARADORES = [
  "es",
  "no_es",
  "tiene",
  "tiene_todas",
  "no_tiene",
  "contiene",
  "no_contiene",
  "empieza_con",
  "mayor_que",
  "menor_que",
  "entre",
  "antes_de",
  "despues_de",
  "hace_mas_de",
  "esta_vacio",
  "no_esta_vacio",
] as const;

export type Comparador = (typeof COMPARADORES)[number];

/**
 * El rótulo por defecto de cada comparador.
 *
 * Es "por defecto" y no "el rótulo" porque un campo puede renombrarlo: en
 * Difusión, `tiene` sobre etapas se lee "es alguna de", que dice exactamente lo
 * mismo con las palabras de esa pantalla. Ver `etiquetaComparador`.
 */
export const COMPARADOR_LABEL: Record<Comparador, string> = {
  es: "es",
  no_es: "no es",
  tiene: "tiene alguna de",
  tiene_todas: "tiene todas",
  no_tiene: "no tiene",
  contiene: "contiene",
  no_contiene: "no contiene",
  empieza_con: "empieza con",
  mayor_que: "es mayor que",
  menor_que: "es menor que",
  entre: "está entre",
  antes_de: "es antes de",
  despues_de: "es después de",
  hace_mas_de: "hace más de",
  esta_vacio: "está vacío",
  no_esta_vacio: "no está vacío",
};

/**
 * Qué comparadores ofrece cada tipo de campo.
 *
 * Es la tabla que el prototipo mostraba como ayuda al pie del panel y que acá
 * además **gobierna el selector**: el desplegable de comparador sólo lista los
 * de su tipo. Ofrecer "es mayor que" sobre un campo de etiquetas y validar
 * después es hacerle perder el tiempo a alguien; no ofrecerlo es más corto.
 */
export const COMPARADORES_POR_TIPO: Record<TipoCampo, readonly Comparador[]> = {
  lista: ["es", "no_es", "esta_vacio", "no_esta_vacio"],
  multilista: ["tiene", "tiene_todas", "no_tiene", "esta_vacio", "no_esta_vacio"],
  texto: ["es", "no_es", "contiene", "no_contiene", "empieza_con", "esta_vacio", "no_esta_vacio"],
  numero: ["es", "no_es", "mayor_que", "menor_que", "entre", "esta_vacio", "no_esta_vacio"],
  fecha: ["antes_de", "despues_de", "entre", "hace_mas_de", "esta_vacio", "no_esta_vacio"],
  booleano: ["es"],
};

export interface CampoCondicion {
  id: string;
  /** Cómo se llama para el vendedor: "Etiquetas del lead", no `lead_tags`. */
  etiqueta: string;
  tipo: TipoCampo;
  /** Obligatorias en `lista` y `multilista`. Sin opciones no hay de dónde elegir. */
  opciones?: readonly OpcionCampo[];
  /** Sufijo de un número: "min", "USD", "días". Sale en mono al lado del input. */
  unidad?: string;
  /** Agrupador del selector de campo: "Lead", "Sesión", "Vehículo", "Mensaje". */
  grupo?: string;
  /**
   * Recorta los comparadores del tipo. Sirve cuando el campo admite menos de
   * los que su tipo permitiría: "Última actividad" es un número pero preguntar
   * si está *entre* dos valores no tiene sentido en esa pantalla.
   */
  comparadores?: readonly Comparador[];
  /**
   * Renombra comparadores para este campo. Es lo que deja que las dos pantallas
   * compartan el modelo sin compartir el vocabulario: la operación `tiene` es
   * la misma, pero sobre etapas de una audiencia se lee "es alguna de".
   */
  etiquetas?: Partial<Record<Comparador, string>>;
}

/** Los comparadores efectivos de un campo: los suyos si los declara, si no los de su tipo. */
export function comparadoresDe(campo: CampoCondicion): readonly Comparador[] {
  return campo.comparadores ?? COMPARADORES_POR_TIPO[campo.tipo];
}

/** Cómo se lee un comparador en el contexto de este campo. */
export function etiquetaComparador(campo: CampoCondicion, c: Comparador): string {
  return campo.etiquetas?.[c] ?? COMPARADOR_LABEL[c];
}

/** Los comparadores que no llevan valor: preguntan por la ausencia del dato. */
export function comparadorSinValor(c: Comparador): boolean {
  return c === "esta_vacio" || c === "no_esta_vacio";
}

/**
 * El valor de una fila.
 *
 * Es una unión discriminada y no un `string`, porque "el valor" de una
 * comparación de etiquetas son varias etiquetas, el de un rango son dos
 * números y el de un campo vacío no es nada. Aplanarlo todo a texto es lo que
 * obliga después a parsear, y parsear es la puerta por la que entra el código
 * que este editor no quiere.
 */
export type ValorCondicion =
  | { tipo: "ninguno" }
  | { tipo: "opcion"; valor: string | null }
  | { tipo: "opciones"; valores: string[] }
  | { tipo: "texto"; valor: string }
  | { tipo: "numero"; valor: number | null }
  | { tipo: "rango"; desde: number | null; hasta: number | null }
  | { tipo: "fecha"; valor: string | null }
  | { tipo: "rangoFecha"; desde: string | null; hasta: string | null }
  | { tipo: "booleano"; valor: boolean };

export interface Regla {
  id: string;
  clase: "regla";
  campoId: string | null;
  comparador: Comparador | null;
  valor: ValorCondicion;
}

export interface Grupo {
  id: string;
  clase: "grupo";
  /** Uno solo para todos los hijos. Ver el bloque de arriba. */
  operador: Operador;
  hijos: NodoCondicion[];
}

export type NodoCondicion = Regla | Grupo;

/**
 * Profundidad máxima de anidado.
 *
 * Tres niveles. No es una limitación técnica: es que a partir del cuarto la
 * caja mide 40 px de ancho útil en un panel de 400 y **nadie puede verificar a
 * ojo si la condición dice lo que quiso decir** — que es el único motivo por
 * el que existen las cajas. Un vendedor de repuestos que necesita cuatro
 * niveles de álgebra booleana necesita otra herramienta, no una caja más
 * chica. El botón "+ Grupo" simplemente no aparece en el nivel 3.
 */
export const PROFUNDIDAD_MAX = 3;

/** Valor inicial coherente con el tipo del campo y el comparador elegidos. */
export function valorPorDefecto(tipo: TipoCampo, comparador: Comparador): ValorCondicion {
  if (comparadorSinValor(comparador)) return { tipo: "ninguno" };
  // "Hace más de N días": sobre una fecha, pero lo que se escribe es un número.
  if (comparador === "hace_mas_de") return { tipo: "numero", valor: null };
  if (comparador === "entre") {
    return tipo === "fecha"
      ? { tipo: "rangoFecha", desde: null, hasta: null }
      : { tipo: "rango", desde: null, hasta: null };
  }
  switch (tipo) {
    case "lista":
      return { tipo: "opcion", valor: null };
    case "multilista":
      return { tipo: "opciones", valores: [] };
    case "numero":
      return { tipo: "numero", valor: null };
    case "fecha":
      return { tipo: "fecha", valor: null };
    case "booleano":
      return { tipo: "booleano", valor: true };
    case "texto":
      return { tipo: "texto", valor: "" };
  }
}

/** Una fila sin terminar. Se marca en la propia fila, nunca en un panel aparte. */
export function reglaIncompleta(r: Regla): boolean {
  if (!r.campoId || !r.comparador) return true;
  switch (r.valor.tipo) {
    case "ninguno":
      return false;
    case "opcion":
      return r.valor.valor === null;
    case "opciones":
      return r.valor.valores.length === 0;
    case "texto":
      return r.valor.valor.trim() === "";
    case "numero":
      return r.valor.valor === null;
    case "rango":
      return r.valor.desde === null || r.valor.hasta === null;
    case "fecha":
      return r.valor.valor === null;
    case "rangoFecha":
      return r.valor.desde === null || r.valor.hasta === null;
    case "booleano":
      return false;
  }
}

/** Cuántas filas hay en total, contando las de los grupos anidados. */
export function contarReglas(nodo: NodoCondicion): number {
  return nodo.clase === "regla" ? 1 : nodo.hijos.reduce((n, h) => n + contarReglas(h), 0);
}

/** Cuántas filas quedaron sin terminar. Es lo que decide si la condición se puede guardar. */
export function contarIncompletas(nodo: NodoCondicion): number {
  if (nodo.clase === "regla") return reglaIncompleta(nodo) ? 1 : 0;
  return nodo.hijos.reduce((n, h) => n + contarIncompletas(h), 0);
}

/**
 * Si el árbol está entero.
 *
 * Es la pregunta que las dos pantallas hacen antes de mostrar un número, y por
 * motivos distintos: el workflow para no decir a cuántos leads alcanza una
 * bifurcación a medias, la difusión para no decir el tamaño de una audiencia a
 * medias. Las dos respuestas serían mentira, así que la función es una sola.
 */
export function condicionCompleta(raiz: Grupo): boolean {
  return contarIncompletas(raiz) === 0;
}

/**
 * Reemplaza un nodo por su versión editada, en cualquier nivel del árbol.
 *
 * Devuelve una raíz nueva y no muta: el estado del constructor es un árbol
 * inmutable, así que un `useMemo` sobre él —el contador de coincidencias, por
 * ejemplo— se recalcula sólo cuando algo cambió de verdad.
 */
export function reemplazar(raiz: Grupo, id: string, nuevo: NodoCondicion): Grupo {
  return {
    ...raiz,
    hijos: raiz.hijos.map((h) =>
      h.id === id ? nuevo : h.clase === "grupo" ? reemplazar(h, id, nuevo) : h,
    ),
  };
}

/** Saca un nodo del árbol. Un grupo que se queda sin hijos se va con ellos. */
export function quitar(raiz: Grupo, id: string): Grupo {
  const hijos = raiz.hijos
    .filter((h) => h.id !== id)
    .map((h) => (h.clase === "grupo" ? quitar(h, id) : h))
    .filter((h) => h.clase === "regla" || h.hijos.length > 0);
  return { ...raiz, hijos };
}

/**
 * Deshace un grupo: sus hijos suben al grupo padre.
 *
 * Sólo tiene sentido si el operador del grupo y el del padre coinciden, porque
 * si no cambiaría el significado. La interfaz oculta el botón "desagrupar"
 * cuando difieren en lugar de ofrecerlo y después explicar por qué no anda.
 */
export function desagrupar(raiz: Grupo, id: string): Grupo {
  const hijos = raiz.hijos.flatMap((h): NodoCondicion[] => {
    if (h.clase === "grupo" && h.id === id && h.operador === raiz.operador) return h.hijos;
    return [h.clase === "grupo" ? desagrupar(h, id) : h];
  });
  return { ...raiz, hijos };
}

/**
 * Profundidad del árbol, contando la raíz como nivel 1.
 *
 * La usa la validación de un árbol que llega de afuera —de la base, de un
 * import— donde el tope de anidado no lo garantizó la interfaz.
 */
export function profundidad(nodo: NodoCondicion): number {
  if (nodo.clase === "regla") return 0;
  return 1 + nodo.hijos.reduce((max, h) => Math.max(max, profundidad(h)), 0);
}

/** Un id local, sólo para las claves de React y el direccionamiento del árbol. */
export function nuevoId(): string {
  return `c${Math.random().toString(36).slice(2, 9)}`;
}

export function reglaVacia(): Regla {
  return {
    id: nuevoId(),
    clase: "regla",
    campoId: null,
    comparador: null,
    valor: { tipo: "ninguno" },
  };
}

export function grupoVacio(operador: Operador): Grupo {
  return { id: nuevoId(), clase: "grupo", operador, hijos: [reglaVacia(), reglaVacia()] };
}

/** La raíz de un constructor recién abierto: un grupo `Y` con una sola fila vacía. */
export function condicionVacia(operador: Operador = "y"): Grupo {
  return { id: nuevoId(), clase: "grupo", operador, hijos: [reglaVacia()] };
}
