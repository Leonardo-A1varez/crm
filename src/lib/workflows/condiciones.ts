import type {
  Comparador,
  Grupo,
  NodoCondicion,
  Regla,
  TipoCampo,
  ValorCondicion,
} from "@/lib/ui/condiciones";
import { horaDePared } from "@/lib/zona-horaria";
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
 * Los ids son rutas dentro del contexto que ve la condición. Los cinco
 * primeros los siembra el disparo en `workflow_runs.contexto`
 * (`contextoDeDisparo`, `contexto.ts`); los de `CAMPOS_VIVOS` se leen de la
 * base al evaluar.
 */
export const CAMPOS_CONDICION = [
  "lead.etapa",
  "lead.nombre",
  "lead.canal",
  "sesion.respondio",
  "sesion.tiene_cotizacion",
  "sesion.intent",
  "lead.etiquetas",
  "vehiculo.marca",
  "sesion.precio_cotizado",
  "lead.alta",
  "lead.ultimo_mensaje",
] as const;
export type CampoCondicion = (typeof CAMPOS_CONDICION)[number];

export function esCampoCondicion(id: string): id is CampoCondicion {
  return (CAMPOS_CONDICION as readonly string[]).includes(id);
}

/**
 * Los campos que NO siembra el disparo: el ejecutor los lee de la base justo
 * antes de evaluar la condición (`CargadorCamposVivos` en el ejecutor), así
 * que una condición después de "Esperar 2 días" ve las etiquetas de ahora y no
 * las del disparo. No se guardan en `workflow_runs.contexto`.
 *
 * - `sesion.intent`: id del intent del último turno clasificado de la sesión
 *   (`turn_classifications` o `rule_executions`, el más nuevo). Ausente si
 *   ningún turno se clasificó. Excepción: el disparo por mensaje trae el de su
 *   propio turno con la hora del mensaje (`CLAVE_INTENT_MENSAJE_AT`), porque la
 *   base recién lo escribe cuando contesta el agente; gana el más nuevo.
 * - `lead.etiquetas`: ids de las etiquetas puestas y no quitadas.
 * - `vehiculo.marca`: marca del vehículo principal (el primero de
 *   `lead_vehiculos` en su orden: principal, después el más viejo).
 * - `sesion.precio_cotizado`: `lead_session.precio_cotizado`.
 * - `lead.alta`: `leads.created_at`.
 * - `lead.ultimo_mensaje`: último entrante de la conversación más reciente.
 */
export const CAMPOS_VIVOS: ReadonlySet<CampoCondicion> = new Set<CampoCondicion>([
  "sesion.intent",
  "lead.etiquetas",
  "vehiculo.marca",
  "sesion.precio_cotizado",
  "lead.alta",
  "lead.ultimo_mensaje",
]);

/** Los campos vivos que usa un árbol. Vacío = el ejecutor no tiene nada que leer. */
export function camposVivosDe(nodo: NodoCondicion): Set<CampoCondicion> {
  const vivos = new Set<CampoCondicion>();
  const visitar = (n: NodoCondicion): void => {
    if (n.clase === "grupo") {
      n.hijos.forEach(visitar);
      return;
    }
    if (n.campoId !== null && esCampoCondicion(n.campoId) && CAMPOS_VIVOS.has(n.campoId)) {
      vivos.add(n.campoId);
    }
  };
  visitar(nodo);
  return vivos;
}

/** Los tipos de campo que el motor sabe evaluar: todos los del modelo compartido. */
export type TipoCampoEvaluable = TipoCampo;

/** El tipo de cada campo. Decide qué comparadores admite (`COMPARADORES_POR_TIPO`). */
export const TIPO_DE_CAMPO_CONDICION: Record<CampoCondicion, TipoCampoEvaluable> = {
  "lead.etapa": "lista",
  "lead.nombre": "texto",
  "lead.canal": "lista",
  "sesion.respondio": "booleano",
  "sesion.tiene_cotizacion": "booleano",
  "sesion.intent": "lista",
  "lead.etiquetas": "multilista",
  "vehiculo.marca": "texto",
  "sesion.precio_cotizado": "numero",
  "lead.alta": "fecha",
  "lead.ultimo_mensaje": "fecha",
};

/**
 * Los campos que "Según el valor" puede mirar: los que se comparan por
 * igualdad —texto y opción única—. Cada caso es un `es` de este evaluador, y
 * sobre un número, una fecha, un sí/no o una lista de etiquetas un `es` contra
 * un texto no afirma nada útil (`cumpleRegla`): esos se bifurcan con una
 * condición.
 */
export const CAMPOS_SWITCH: readonly CampoCondicion[] = CAMPOS_CONDICION.filter((c) => {
  const tipo = TIPO_DE_CAMPO_CONDICION[c];
  return tipo === "texto" || tipo === "lista";
});

/**
 * Los valores posibles de los campos cerrados que no dependen de la base: los
 * que el contexto puede traer. `lead.etapa` es la etapa de la sesión —cualquiera
 * de las ocho, desvíos incluidos— y `lead.canal` el canal del lead. Las
 * etiquetas que se leen en pantalla las pone la pantalla.
 *
 * Intent y etiquetas también son cerrados, pero sus valores son filas
 * (`intents`, `tags`): la pantalla los trae de la base y acá no se pueden
 * listar.
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
 * Lo que la evaluación necesita saber del mundo y no está en el contexto: la
 * hora, para "hace más de N días", y la zona del negocio, para decir en qué
 * día cae un instante (`agente_config.horario_timezone`).
 */
export interface OpcionesEvaluacion {
  ahora: Date;
  zona: string;
}

/**
 * Sin opciones: el reloj real y UTC. Sirve a quien evalúa condiciones que no
 * miran fechas; el ejecutor siempre pasa la zona del negocio.
 */
function opcionesPorDefecto(): OpcionesEvaluacion {
  return { ahora: new Date(), zona: "UTC" };
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Varias opciones contra una lista. Algo que no es una lista de textos no afirma nada. */
function compararLista(actual: unknown, comparador: Comparador, buscados: string[]): boolean {
  if (!Array.isArray(actual) || !actual.every((v) => typeof v === "string")) return false;
  const tiene = new Set<string>(actual);
  switch (comparador) {
    case "tiene":
      return buscados.some((b) => tiene.has(b));
    case "tiene_todas":
      return buscados.every((b) => tiene.has(b));
    case "no_tiene":
      return !buscados.some((b) => tiene.has(b));
    default:
      return false;
  }
}

/** Un número y sólo un número: `"150"` no es 150. */
function compararNumero(actual: unknown, comparador: Comparador, valor: ValorCondicion): boolean {
  if (typeof actual !== "number" || !Number.isFinite(actual)) return false;
  if (valor.tipo === "rango") {
    if (comparador !== "entre" || valor.desde === null || valor.hasta === null) return false;
    return actual >= valor.desde && actual <= valor.hasta;
  }
  if (valor.tipo !== "numero" || valor.valor === null) return false;
  switch (comparador) {
    case "es":
      return actual === valor.valor;
    case "no_es":
      return actual !== valor.valor;
    case "mayor_que":
      return actual > valor.valor;
    case "menor_que":
      return actual < valor.valor;
    default:
      return false;
  }
}

function instanteDe(actual: unknown): Date | null {
  const d = actual instanceof Date ? actual : typeof actual === "string" ? new Date(actual) : null;
  return d !== null && !Number.isNaN(d.getTime()) ? d : null;
}

/** El día calendario (`AAAA-MM-DD`) en que cae un instante en la zona. */
export function diaEnZona(instante: Date, zona: string): string | null {
  const pared = horaDePared(zona, instante);
  if (pared === null) return null;
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${pared.anio}-${dos(pared.mes)}-${dos(pared.dia)}`;
}

/**
 * Las fechas se comparan por día calendario en la zona del negocio: "antes del
 * 25" es "el 24 o antes, allá", no "antes de las 00:00 UTC". Los días del
 * constructor son `AAAA-MM-DD`, que se ordenan como texto. `entre` incluye los
 * dos días. "Hace más de N días" es instante contra instante, en días de 24 h.
 */
function compararFecha(
  actual: unknown,
  comparador: Comparador,
  valor: ValorCondicion,
  opciones: OpcionesEvaluacion,
): boolean {
  const instante = instanteDe(actual);
  if (instante === null) return false;
  if (comparador === "hace_mas_de") {
    if (valor.tipo !== "numero" || valor.valor === null) return false;
    return opciones.ahora.getTime() - instante.getTime() > valor.valor * MS_POR_DIA;
  }
  const dia = diaEnZona(instante, opciones.zona);
  if (dia === null) return false;
  if (valor.tipo === "rangoFecha") {
    if (comparador !== "entre" || valor.desde === null || valor.hasta === null) return false;
    return dia >= valor.desde && dia <= valor.hasta;
  }
  if (valor.tipo !== "fecha" || valor.valor === null) return false;
  if (comparador === "antes_de") return dia < valor.valor;
  if (comparador === "despues_de") return dia > valor.valor;
  return false;
}

/**
 * Una fila. Un campo ausente da `false` con todo comparador salvo "está
 * vacío": que un dato todavía no exista es información, no una falla. La rama
 * `falso` de la condición siempre está conectada —lo exige el validador—, así
 * que el flujo tiene a dónde ir.
 *
 * Texto, opción y booleano se evalúan por el tipo del **valor**, no del campo:
 * es lo que deja que un trío raro del panel viejo (`es "true"` sobre un
 * booleano) conserve su resultado exacto al convertirse. Número y fecha, por
 * el tipo del campo: sus comparadores no existían en el trío. Un árbol del
 * constructor siempre trae el valor que corresponde a su campo; eso lo hace
 * cumplir `condiciones.schema.ts`.
 */
function cumpleRegla(
  regla: Regla,
  contexto: Record<string, unknown>,
  opciones: OpcionesEvaluacion,
): boolean {
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

  const tipoCampo = esCampoCondicion(regla.campoId) ? TIPO_DE_CAMPO_CONDICION[regla.campoId] : null;
  if (tipoCampo === "fecha") return compararFecha(actual, comparador, valor, opciones);
  if (tipoCampo === "numero") return compararNumero(actual, comparador, valor);
  if (valor.tipo === "opciones") return compararLista(actual, comparador, valor.valores);
  if (valor.tipo !== "opcion" && valor.tipo !== "texto") {
    // Un número o una fecha sobre un campo que no es de ese tipo: el schema no
    // lo deja pasar. Una fila así no se cumple, en vez de inventarle un sentido.
    return false;
  }
  return compararTexto(String(actual), comparador, valor.valor);
}

/**
 * Un grupo sin hijos no se cumple con ningún operador. `[].every()` daría
 * `true`: una condición vacía mandaría a todos por la rama "sí", que es
 * justamente la condición que acierta de más.
 */
function cumpleNodo(
  nodo: NodoCondicion,
  contexto: Record<string, unknown>,
  opciones: OpcionesEvaluacion,
): boolean {
  if (nodo.clase === "regla") return cumpleRegla(nodo, contexto, opciones);
  if (nodo.hijos.length === 0) return false;
  return nodo.operador === "y"
    ? nodo.hijos.every((h) => cumpleNodo(h, contexto, opciones))
    : nodo.hijos.some((h) => cumpleNodo(h, contexto, opciones));
}

/**
 * ¿La condición se cumple con este contexto? Evalúa el árbol completo; un trío
 * plano se convierte al árbol primero.
 *
 * **Firma estable:** la llama el ejecutor (`ejecutor.service.ts`) con lo que
 * devuelve `CondicionSchema`, y con la hora y la zona del negocio.
 */
export function evaluarCondicion(
  cond: Condicion,
  contexto: Record<string, unknown>,
  opciones: OpcionesEvaluacion = opcionesPorDefecto(),
): boolean {
  const arbol = esCondicionArbol(cond) ? cond.arbol : arbolDeCondicionPlana(cond);
  return cumpleNodo(arbol, contexto, opciones);
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

/** Qué pide el ejecutor al leer los campos vivos de una condición. */
export interface ConsultaCamposVivos {
  leadId: string;
  /** La sesión de la corrida. Sin ella, la más reciente del lead. */
  leadSessionId: string | null;
  campos: ReadonlySet<CampoCondicion>;
}

/**
 * Los campos que dependen del disparo y no de un dato guardado: no se pueden
 * contar sobre la base. "Respondió" es "el lead acaba de escribir", y eso sólo
 * lo sabe el disparo por mensaje.
 */
export const CAMPOS_SIN_CONTEO: ReadonlySet<CampoCondicion> = new Set<CampoCondicion>([
  "sesion.respondio",
]);

/** Los campos del árbol que no se pueden contar sobre la base, sin repetir. */
export function camposSinConteoDe(nodo: NodoCondicion): CampoCondicion[] {
  const vistos = new Set<CampoCondicion>();
  const visitar = (n: NodoCondicion): void => {
    if (n.clase === "grupo") {
      n.hijos.forEach(visitar);
      return;
    }
    if (n.campoId !== null && esCampoCondicion(n.campoId) && CAMPOS_SIN_CONTEO.has(n.campoId)) {
      vistos.add(n.campoId);
    }
  };
  visitar(nodo);
  return [...vistos];
}
