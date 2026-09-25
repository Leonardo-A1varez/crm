import type {
  Comparador,
  Grupo,
  NodoCondicion,
  Regla,
  TipoCampo,
  ValorCondicion,
} from "@/lib/ui/condiciones";
import { CANAL, CURRENT_STAGE } from "@/types/domain";

/**
 * Las condiciones de un workflow: qué campos pueden mirar, cómo se guardan y
 * cómo las evalúa el motor.
 *
 * Un nodo `logica_condicion` (y el `condicion` legacy) guarda una de dos formas
 * en `Nodo.config`, y el motor entiende las dos:
 *
 * - **El árbol Y/O** —`{ arbol: Grupo }`— que arma el constructor. Es el modelo
 *   compartido de `lib/ui/condiciones.ts`, el mismo de la audiencia de
 *   Difusión: el operador vive en el grupo, así que `A Y B O C` no se puede
 *   escribir.
 * - **El trío plano** —`{ campo, operador, valor }`— que guardaba el panel
 *   antes del árbol. No se migra en la base: se convierte al árbol al leerlo
 *   (`arbolDeCondicionPlana`), con la semántica exacta del evaluador de antes,
 *   así que un flujo ya publicado toma la misma rama que tomaba.
 *   `tests/unit/workflows/condiciones.test.ts` lo prueba contra una copia de
 *   aquel evaluador, caso por caso.
 *
 * La validación con Zod vive en `condiciones.schema.ts`; este archivo no la
 * importa, para que el evaluador siga siendo una función pura.
 */

/**
 * Los campos que una condición puede mirar. Lista blanca a propósito: W3 la
 * amplía agregando entradas acá, y nadie amplía una gramática.
 *
 * Los ids son rutas dentro de `workflow_runs.contexto`, que siembra
 * `contextoDeDisparo` (`contexto.ts`).
 */
export const CAMPOS_CONDICION = [
  "lead.etapa",
  "lead.nombre",
  "lead.canal",
  "sesion.respondio",
  "sesion.tiene_cotizacion",
] as const;
export type CampoCondicion = (typeof CAMPOS_CONDICION)[number];

export function esCampoCondicion(id: string): id is CampoCondicion {
  return (CAMPOS_CONDICION as readonly string[]).includes(id);
}

/**
 * Los tipos de campo que el motor sabe evaluar. Sumar a la lista blanca un
 * campo de otro tipo (número, fecha) no compila hasta que se le escriba su
 * semántica en `cumpleRegla`.
 */
export type TipoCampoEvaluable = Extract<TipoCampo, "lista" | "texto" | "booleano">;

/** El tipo de cada campo. Decide qué comparadores admite (`COMPARADORES_POR_TIPO`). */
export const TIPO_DE_CAMPO_CONDICION: Record<CampoCondicion, TipoCampoEvaluable> = {
  "lead.etapa": "lista",
  "lead.nombre": "texto",
  "lead.canal": "lista",
  "sesion.respondio": "booleano",
  "sesion.tiene_cotizacion": "booleano",
};

/**
 * Los valores posibles de los campos cerrados: los que el contexto puede traer.
 * `lead.etapa` es la etapa de la sesión —cualquiera de las ocho, desvíos
 * incluidos— y `lead.canal` el canal del lead. Las etiquetas que se leen en
 * pantalla las pone la pantalla.
 */
export const OPCIONES_DE_CAMPO_CONDICION: Readonly<
  Partial<Record<CampoCondicion, readonly string[]>>
> = {
  "lead.etapa": CURRENT_STAGE,
  "lead.canal": CANAL,
};

/** Los operadores del trío plano. Sirven para leer lo guardado antes del árbol. */
export const OPERADORES = ["es", "no_es", "contiene", "es_verdadero", "es_falso"] as const;
export type Operador = (typeof OPERADORES)[number];

/** La condición como la guardaba el panel antes del árbol. */
export interface CondicionPlana {
  campo: CampoCondicion;
  operador: Operador;
  valor: string | null;
}

/** La condición como la arma el constructor. */
export interface CondicionArbol {
  arbol: Grupo;
}

/** Lo que evalúa el motor: cualquiera de las dos formas guardadas. */
export type Condicion = CondicionPlana | CondicionArbol;

/**
 * `"arbol" in c` a secas no alcanza: TypeScript no angosta una unión por una
 * clave que uno de los lados no declara.
 */
export function esCondicionArbol(c: Condicion): c is CondicionArbol {
  return "arbol" in c;
}

function leer(contexto: Record<string, unknown>, campo: string): unknown {
  return campo.split(".").reduce<unknown>((actual, parte) => {
    if (actual === null || typeof actual !== "object") return undefined;
    return (actual as Record<string, unknown>)[parte];
  }, contexto);
}

/** Ausente, null, texto en blanco o lista vacía. */
function estaVacio(valor: unknown): boolean {
  if (valor === undefined || valor === null) return true;
  if (typeof valor === "string") return valor.trim() === "";
  if (Array.isArray(valor)) return valor.length === 0;
  return false;
}

/** `es`/`no_es` comparan exacto; los demás, sin distinguir mayúsculas. Igual que el trío. */
function compararTexto(actual: string, comparador: Comparador, buscado: string | null): boolean {
  const aguja = (buscado ?? "").toLowerCase();
  switch (comparador) {
    case "es":
      return actual === buscado;
    case "no_es":
      return actual !== buscado;
    case "contiene":
      return actual.toLowerCase().includes(aguja);
    case "no_contiene":
      return !actual.toLowerCase().includes(aguja);
    case "empieza_con":
      return actual.toLowerCase().startsWith(aguja);
    default:
      return false;
  }
}

/**
 * Una fila. Un campo ausente da `false` con todo comparador salvo "está
 * vacío": que un dato todavía no exista es información, no una falla. La rama
 * `falso` de la condición siempre está conectada —lo exige el validador—, así
 * que el flujo tiene a dónde ir.
 *
 * Se evalúa por el tipo del **valor**, no del campo: es lo que deja que un trío
 * raro del panel viejo (`es "true"` sobre un booleano) conserve su resultado
 * exacto al convertirse. Un árbol del constructor siempre trae el valor del
 * tipo que corresponde a su campo; eso lo hace cumplir `condiciones.schema.ts`.
 */
function cumpleRegla(regla: Regla, contexto: Record<string, unknown>): boolean {
  // Fila sin terminar: no afirma nada. `CondicionSchema` no deja que llegue una
  // al motor; esto cubre a quien llame al evaluador sin validar.
  if (regla.campoId === null || regla.comparador === null) return false;
  const actual = leer(contexto, regla.campoId);
  const comparador = regla.comparador;

  if (comparador === "esta_vacio") return estaVacio(actual);
  if (comparador === "no_esta_vacio") return !estaVacio(actual);

  const valor = regla.valor;
  // Contra el booleano, no contra su texto. Y ausente no es "no".
  if (valor.tipo === "booleano") return comparador === "es" && actual === valor.valor;
  if (actual === undefined || actual === null) return false;
  if (valor.tipo !== "opcion" && valor.tipo !== "texto") {
    // Número, fecha, varias opciones: ningún campo de la lista blanca los usa
    // todavía. Una fila así no se cumple, en vez de inventarle un sentido.
    return false;
  }
  return compararTexto(String(actual), comparador, valor.valor);
}

/**
 * Un grupo sin hijos no se cumple con ningún operador. `[].every()` daría
 * `true`: una condición vacía mandaría a todos por la rama "sí", que es
 * justamente la condición que acierta de más.
 */
function cumpleNodo(nodo: NodoCondicion, contexto: Record<string, unknown>): boolean {
  if (nodo.clase === "regla") return cumpleRegla(nodo, contexto);
  if (nodo.hijos.length === 0) return false;
  return nodo.operador === "y"
    ? nodo.hijos.every((h) => cumpleNodo(h, contexto))
    : nodo.hijos.some((h) => cumpleNodo(h, contexto));
}

/**
 * ¿La condición se cumple con este contexto? Evalúa el árbol completo; un trío
 * plano se convierte al árbol primero.
 *
 * **Firma estable:** la llama el ejecutor (`ejecutor.service.ts`) con lo que
 * devuelve `CondicionSchema`.
 */
export function evaluarCondicion(cond: Condicion, contexto: Record<string, unknown>): boolean {
  const arbol = esCondicionArbol(cond) ? cond.arbol : arbolDeCondicionPlana(cond);
  return cumpleNodo(arbol, contexto);
}

/** Ids fijos: el mismo trío da siempre el mismo árbol, y no chocan con los de `nuevoId()`. */
const ID_RAIZ = "raiz";
const ID_PRIMERA_FILA = "fila-1";

/**
 * `es`/`no_es` comparaban el texto del campo contra el valor tal cual. Un valor
 * null queda como opción sin elegir —con `es` no se cumple nunca, con `no_es`
 * se cumple con todo lo presente, igual que antes— y el constructor la muestra
 * como fila incompleta. Un texto queda como texto para que el constructor lo
 * muestre en su input; el resto, como opción.
 */
function valorLiteralDelTrio(c: CondicionPlana): ValorCondicion {
  if (c.valor === null) return { tipo: "opcion", valor: null };
  return TIPO_DE_CAMPO_CONDICION[c.campo] === "texto"
    ? { tipo: "texto", valor: c.valor }
    : { tipo: "opcion", valor: c.valor };
}

function comparadorYValorDelTrio(c: CondicionPlana): {
  comparador: Comparador;
  valor: ValorCondicion;
} {
  switch (c.operador) {
    // `es_verdadero`/`es_falso` del panel viejo son `es` contra el booleano en
    // la gramática del árbol: el constructor ofrece "Sí"/"No" como valor.
    case "es_verdadero":
      return { comparador: "es", valor: { tipo: "booleano", valor: true } };
    case "es_falso":
      return { comparador: "es", valor: { tipo: "booleano", valor: false } };
    case "contiene":
      return { comparador: "contiene", valor: { tipo: "texto", valor: c.valor ?? "" } };
    case "es":
    case "no_es":
      return { comparador: c.operador, valor: valorLiteralDelTrio(c) };
  }
}

/** El trío plano como árbol: una sola fila dentro de un grupo Y. Misma semántica exacta. */
export function arbolDeCondicionPlana(c: CondicionPlana): Grupo {
  return {
    id: ID_RAIZ,
    clase: "grupo",
    operador: "y",
    hijos: [
      { id: ID_PRIMERA_FILA, clase: "regla", campoId: c.campo, ...comparadorYValorDelTrio(c) },
    ],
  };
}

/** Lo que abre el constructor para un nodo sin configurar: un grupo Y con una fila vacía. */
export function arbolVacio(): Grupo {
  return {
    id: ID_RAIZ,
    clase: "grupo",
    operador: "y",
    hijos: [
      {
        id: ID_PRIMERA_FILA,
        clase: "regla",
        campoId: null,
        comparador: null,
        valor: { tipo: "ninguno" },
      },
    ],
  };
}
