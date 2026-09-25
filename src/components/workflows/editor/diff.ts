/**
 * Comparación de dos versiones de un grafo, para dibujar el diff **sobre el
 * propio lienzo**.
 *
 * ────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO VIVE ACÁ Y NO EN `src/lib/workflows/`
 * ────────────────────────────────────────────────────────────────────────
 *
 * Es comparación *para pintar*, no para el motor: decide qué nodo lleva anillo
 * verde y qué línea va punteada. Si algún día hace falta un diff canónico —para
 * una auditoría, para un changelog automático— ese va en `src/lib/workflows/` y
 * este archivo pasa a consumirlo. Hoy no existe (verificado: no hay ningún
 * comparador de grafos en el repo) e inventarlo en `lib` sería adivinar el
 * contrato de otro stream.
 *
 * ────────────────────────────────────────────────────────────────────────
 * DECISIÓN: MOVER UN NODO NO ES UN CAMBIO
 * ────────────────────────────────────────────────────────────────────────
 *
 * `posicion` se ignora entera. Acomodar el lienzo para que se entienda mejor es
 * exactamente lo que uno quiere que la gente haga, y marcarlo como "cambiado"
 * junto a un cambio de plantilla de WhatsApp entrena a ignorar el ámbar. El
 * motor tampoco la lee (`Nodo.posicion`: "Sólo para el canvas de W5").
 *
 * La consecuencia visible: un nodo puede aparecer en otro lugar del lienzo del
 * diff sin ninguna marca. Es correcto y hay que decirlo en la interfaz, porque
 * si no se lee como un bug.
 *
 * ────────────────────────────────────────────────────────────────────────
 * DECISIÓN: SE COMPARA EL VALOR, NO CÓMO SE MUESTRA
 * ────────────────────────────────────────────────────────────────────────
 *
 * La primera versión decidía si un parámetro cambió comparando su texto de
 * pantalla. Todo objeto se muestra como "(configuración)", así que dos objetos
 * distintos daban el mismo texto y el cambio desaparecía. Con la condición
 * guardada como `{ arbol }` eso significaba que editar una condición no
 * contaba: el diff decía "0 cambios", y el editor —que usa esta misma función
 * para saber si hay algo sin guardar— dejaba publicar la versión vieja creyendo
 * que era la nueva. Ahora se compara la estructura (`mismoValor`), y el texto
 * sólo se usa para mostrar.
 */

import type { Grafo, Nodo, Arista } from "@/types/workflows";

export type ClaseCambio = "agregado" | "eliminado" | "cambiado" | "igual";

/** Un parámetro que cambió, con los dos valores ya en texto para mostrar. */
export interface CambioParametro {
  /** Cómo se llama para el vendedor: "Categoría", "Tiempo máximo". */
  etiqueta: string;
  /** `null` = no estaba configurado. Se dibuja como "sin definir", no como vacío. */
  antes: string | null;
  despues: string | null;
}

export interface CambioNodo {
  nodoId: string;
  clase: ClaseCambio;
  /** Nombre legible del nodo. Sale del catálogo, no del tipo crudo. */
  nombre: string;
  parametros: CambioParametro[];
}

export interface CambioArista {
  aristaId: string;
  clase: Extract<ClaseCambio, "agregado" | "eliminado" | "igual">;
  desde: string;
  hasta: string;
  puerto: string;
}

export interface DiffGrafo {
  /**
   * La **unión** de los dos grafos: los nodos nuevos, los que siguen y los
   * borrados. Los borrados van en la posición que tenían en la versión
   * anterior, que es la única forma de que "se eliminó el paso del medio" se
   * lea como un hueco en el lugar del hueco.
   */
  nodos: (Nodo & { clase: ClaseCambio })[];
  aristas: CambioArista[];
  cambios: CambioNodo[];
  /** Cuántos cambios reales hay. Cero significa que publicar no haría nada. */
  total: number;
}

/** Formatea un valor de config para mostrarlo. Sin JSON: esto lo lee un vendedor. */
function comoTexto(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "sí" : "no";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.length === 0 ? null : v.map((x) => comoTexto(x) ?? "—").join(", ");
  // Un objeto anidado no se aplana a JSON: se dice que cambió y punto. Mostrar
  // `{"a":1}` en un diff que mira un vendedor es peor que no mostrar nada.
  return "(configuración)";
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function esPrimitivo(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/** Ausente, `null`, texto vacío o lista vacía: para el diff los cuatro son "sin definir". */
function sinDefinir(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/**
 * Si dos valores de config son el mismo, por estructura.
 *
 * Dos primitivos se comparan como texto —`5` y `"5"` no son un cambio que un
 * vendedor pueda ver—, y todo lo demás, recorriendo: un árbol de condición con
 * una fila distinta es otro valor aunque se muestre igual. El orden de las
 * claves de un objeto no cuenta; el de una lista, sí.
 */
export function mismoValor(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (sinDefinir(a) && sinDefinir(b)) return true;
  if (esPrimitivo(a) && esPrimitivo(b)) return String(a) === String(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => mismoValor(x, b[i]));
  }
  if (esObjeto(a) && esObjeto(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!mismoValor(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

function idArista(a: Arista): string {
  return `${a.desde}→${a.hasta}:${a.puerto}`;
}

export interface OpcionesDiff {
  /** Clave de config → nombre legible. Ej: `{ categoria: "Categoría" }`. */
  etiquetasConfig?: Readonly<Record<string, string>>;
  /** Id de nodo → nombre legible. Ej: `{ n2: "Enviar mensaje" }`. */
  nombres?: Readonly<Record<string, string>>;
  /**
   * Cómo mostrar el valor de una clave que el formato por defecto no sabe
   * leer: una condición, una lista de ids de etiqueta. Devolver `undefined`
   * deja el formato por defecto; `null`, "sin definir".
   */
  formatear?: (clave: string, valor: unknown) => string | null | undefined;
}

function mostrar(
  clave: string,
  valor: unknown,
  formatear: OpcionesDiff["formatear"],
): string | null {
  if (sinDefinir(valor)) return null;
  const propio = formatear?.(clave, valor);
  return propio !== undefined ? propio : comoTexto(valor);
}

/** Lo que se muestra cuando el valor cambió pero el texto de antes y el de ahora son iguales. */
const MODIFICADA = "(modificada)";

/**
 * Compara la config de dos nodos, campo por campo.
 *
 * `etiquetas` traduce las claves técnicas al idioma del vendedor. Una clave sin
 * traducción se muestra tal cual, que es feo pero honesto: inventarle un nombre
 * bonito a un campo que no conocemos es peor.
 */
function compararConfig(
  antes: Record<string, unknown>,
  despues: Record<string, unknown>,
  opciones: Pick<OpcionesDiff, "etiquetasConfig" | "formatear">,
): CambioParametro[] {
  const etiquetas = opciones.etiquetasConfig ?? {};
  const claves = new Set([...Object.keys(antes), ...Object.keys(despues)]);
  const out: CambioParametro[] = [];
  for (const k of claves) {
    if (mismoValor(antes[k], despues[k])) continue;
    const a = mostrar(k, antes[k], opciones.formatear);
    const d = mostrar(k, despues[k], opciones.formatear);
    // Dos configuraciones distintas que se ven igual —un objeto que nadie
    // sabe resumir— siguen siendo un cambio: se dice que se modificó en vez
    // de mostrar dos textos idénticos con una flecha en el medio.
    out.push({
      etiqueta: etiquetas[k] ?? k,
      antes: a,
      despues: a !== null && a === d ? MODIFICADA : d,
    });
  }
  return out.sort((x, y) => x.etiqueta.localeCompare(y.etiqueta, "es"));
}

/**
 * El diff de dos grafos.
 *
 * Los nodos se emparejan por `id`, nunca por posición en el array. Es la misma
 * razón por la que las aristas del proyecto referencian ids: emparejar por
 * índice hace que insertar un paso al medio marque como "cambiados" a todos los
 * que vienen después.
 */
export function compararGrafos(
  anterior: Grafo,
  nuevo: Grafo,
  opciones: OpcionesDiff = {},
): DiffGrafo {
  const nombres = opciones.nombres ?? {};
  const nombreDe = (n: Nodo) => nombres[n.id] ?? n.tipo;

  const previos = new Map(anterior.nodos.map((n) => [n.id, n]));
  const actuales = new Map(nuevo.nodos.map((n) => [n.id, n]));

  const nodos: DiffGrafo["nodos"] = [];
  const cambios: CambioNodo[] = [];

  for (const n of nuevo.nodos) {
    const antes = previos.get(n.id);
    if (!antes) {
      nodos.push({ ...n, clase: "agregado" });
      cambios.push({ nodoId: n.id, clase: "agregado", nombre: nombreDe(n), parametros: [] });
      continue;
    }
    // `posicion` no entra en la comparación. Ver el bloque de arriba.
    const parametros = compararConfig(antes.config, n.config, opciones);
    const cambioDeTipo = antes.tipo !== n.tipo;
    const clase: ClaseCambio = parametros.length > 0 || cambioDeTipo ? "cambiado" : "igual";
    nodos.push({ ...n, clase });
    if (clase === "cambiado") {
      cambios.push({
        nodoId: n.id,
        clase,
        nombre: nombreDe(n),
        parametros: cambioDeTipo
          ? [{ etiqueta: "Tipo de bloque", antes: antes.tipo, despues: n.tipo }, ...parametros]
          : parametros,
      });
    }
  }

  for (const n of anterior.nodos) {
    if (actuales.has(n.id)) continue;
    // Va con la posición que tenía. Es lo que deja ver el hueco donde estaba.
    nodos.push({ ...n, clase: "eliminado" });
    cambios.push({ nodoId: n.id, clase: "eliminado", nombre: nombreDe(n), parametros: [] });
  }

  const previasAristas = new Set(anterior.aristas.map(idArista));
  const actualesAristas = new Set(nuevo.aristas.map(idArista));

  const aristas: CambioArista[] = [
    ...nuevo.aristas.map((a) => ({
      aristaId: idArista(a),
      clase: (previasAristas.has(idArista(a)) ? "igual" : "agregado") as CambioArista["clase"],
      desde: a.desde,
      hasta: a.hasta,
      puerto: a.puerto,
    })),
    ...anterior.aristas
      .filter((a) => !actualesAristas.has(idArista(a)))
      .map((a) => ({
        aristaId: idArista(a),
        clase: "eliminado" as const,
        desde: a.desde,
        hasta: a.hasta,
        puerto: a.puerto,
      })),
  ];

  return { nodos, aristas, cambios, total: cambios.length };
}

export const CLASE_LABEL: Record<ClaseCambio, string> = {
  agregado: "agregado",
  eliminado: "eliminado",
  cambiado: "cambiado",
  igual: "sin cambios",
};

/**
 * Los tres colores del diff.
 *
 * Verde / ámbar / rojo es el idioma universal del diff y no vale la pena
 * pelearlo por pureza interna: quien ve un diff ya sabe leerlo. Se toman de los
 * tokens semánticos (`ok`, `caution`, `danger`), que ya están calibrados en los
 * dos temas, en vez de declarar tres hex nuevos.
 *
 * El color nunca va solo: cada nodo del lienzo lleva además una insignia con la
 * palabra ("nuevo", "1 cambio", "eliminado") y la leyenda de la barra está
 * siempre visible, no escondida en un tooltip.
 */
export const CLASE_ANILLO: Record<ClaseCambio, string> = {
  agregado: "ring-2 ring-ok",
  eliminado: "ring-2 ring-danger/50",
  cambiado: "ring-2 ring-caution",
  igual: "",
};

export const CLASE_TEXTO: Record<ClaseCambio, string> = {
  agregado: "text-ok",
  eliminado: "text-danger",
  cambiado: "text-caution",
  igual: "text-ink-ghost",
};

export const CLASE_PUNTO: Record<ClaseCambio, string> = {
  agregado: "bg-ok",
  eliminado: "bg-danger",
  cambiado: "bg-caution",
  igual: "bg-line-dot",
};

/** Texto de la insignia del nodo en el lienzo del diff. */
export function insigniaDe(cambio: CambioNodo | undefined, clase: ClaseCambio): string | null {
  if (clase === "agregado") return "nuevo";
  if (clase === "eliminado") return "eliminado";
  if (clase !== "cambiado") return null;
  const n = cambio?.parametros.length ?? 0;
  return n === 1 ? "1 cambio" : `${n} cambios`;
}
