import { ValidationError } from "@/lib/errors";
import {
  contarIncompletas,
  contarReglas,
  type Comparador,
  type Grupo,
  type NodoCondicion,
  type Regla,
  type TipoCampo,
  type ValorCondicion,
} from "@/lib/ui/condiciones";
import { validarAudiencia } from "@/lib/validation/difusion.schema";
import { UUIDSchema } from "@/lib/validation/schemas";
import { CANAL, CURRENT_STAGE, MOTIVO_PERDIDA } from "@/types/domain";

/**
 * La audiencia de una difusión, lista para que la base la resuelva.
 *
 * El árbol de condiciones (`lib/ui/condiciones.ts`) es la gramática que
 * comparte con el editor de workflows; esto es la otra mitad, la que es sólo de
 * Difusión: qué campos se pueden preguntar y con qué comparadores, y la
 * traducción del árbol a una forma cerrada que la función SQL
 * `difusion_resolver_audiencia` sabe leer.
 *
 * Tres reglas duras, y por eso esto es un compilador y no un `JSON.stringify`:
 *
 *   1. **Un árbol vacío no es "toda la base".** Mandarle a todos es una
 *      elección explícita (`todaLaBase`), guardada en la difusión. Sin ella, un
 *      árbol sin filas se rechaza.
 *   2. **Lo desconocido falla en voz alta.** Un campo que la base no sabe
 *      resolver, un comparador que el campo no admite o un valor fuera de su
 *      dominio lanzan `ValidationError` con el nombre de lo que falló. Nunca se
 *      descarta una fila en silencio: una fila ignorada ensancha la audiencia.
 *   3. **Una fila a medias no se resuelve.** Es la misma regla que el contador
 *      en vivo: con una condición sin terminar no hay a quién mandarle.
 *
 * La base vuelve a validar todo lo que recibe (la función SQL levanta 23514
 * ante cualquier cosa que no conozca): esto es la primera barrera, no la única.
 */

export const CAMPOS_AUDIENCIA = [
  "etapa",
  "etiqueta",
  "vendedor",
  "canal",
  "motivo_perdida",
  "ultima_actividad",
  "consulta",
  "vehiculo",
  "campania_previa",
] as const;
export type CampoAudiencia = (typeof CAMPOS_AUDIENCIA)[number];

/** Contra qué se valida cada valor de una fila. */
type DominioValores = "etapas" | "canales" | "motivos" | "ids" | "texto" | "dias";

export interface DefinicionCampoAudiencia {
  tipo: TipoCampo;
  /** Los únicos que la función SQL sabe resolver para este campo. */
  comparadores: readonly Comparador[];
  dominio: DominioValores;
}

/**
 * La tabla que ata el catálogo de la pantalla (`components/difusion/campos-audiencia.ts`)
 * con lo que la base sabe resolver. El catálogo toma de acá tipo y
 * comparadores, así que la pantalla no puede ofrecer algo que la base rechace.
 *
 * Qué pregunta cada campo en la base (`*_difusion_resolver.sql`):
 *   etapa, motivo_perdida, vendedor, consulta → la sesión más reciente del lead;
 *   canal → `leads.canal_origen`;
 *   ultima_actividad → la conversación más reciente (o el alta del lead);
 *   vehiculo → cualquiera de sus `lead_vehiculos`;
 *   campania_previa → un envío de esa difusión que llegó a Meta.
 */
export const DEFINICION_CAMPO_AUDIENCIA: Readonly<
  Record<CampoAudiencia, DefinicionCampoAudiencia>
> = {
  etapa: { tipo: "multilista", comparadores: ["tiene", "no_tiene"], dominio: "etapas" },
  etiqueta: {
    tipo: "multilista",
    comparadores: ["tiene", "tiene_todas", "no_tiene"],
    dominio: "ids",
  },
  vendedor: { tipo: "multilista", comparadores: ["tiene", "no_tiene"], dominio: "ids" },
  canal: { tipo: "multilista", comparadores: ["tiene", "no_tiene"], dominio: "canales" },
  motivo_perdida: { tipo: "multilista", comparadores: ["tiene", "no_tiene"], dominio: "motivos" },
  ultima_actividad: { tipo: "numero", comparadores: ["mayor_que", "menor_que"], dominio: "dias" },
  consulta: {
    tipo: "texto",
    comparadores: ["contiene", "no_contiene", "esta_vacio", "no_esta_vacio"],
    dominio: "texto",
  },
  vehiculo: { tipo: "texto", comparadores: ["contiene", "no_contiene"], dominio: "texto" },
  campania_previa: { tipo: "multilista", comparadores: ["tiene", "no_tiene"], dominio: "ids" },
};

export type ComparadorLista = "tiene" | "tiene_todas" | "no_tiene";
export type ComparadorTexto = "contiene" | "no_contiene";
export type ComparadorPresencia = "esta_vacio" | "no_esta_vacio";
export type ComparadorNumero = "mayor_que" | "menor_que";

export type ReglaCompilada =
  | { tipo: "regla"; campo: CampoAudiencia; comparador: ComparadorLista; valores: string[] }
  | { tipo: "regla"; campo: CampoAudiencia; comparador: ComparadorTexto; texto: string }
  | { tipo: "regla"; campo: CampoAudiencia; comparador: ComparadorPresencia }
  | { tipo: "regla"; campo: CampoAudiencia; comparador: ComparadorNumero; numero: number };

export interface GrupoCompilado {
  tipo: "grupo";
  operador: "y" | "o";
  hijos: NodoCompilado[];
}

export type NodoCompilado = ReglaCompilada | GrupoCompilado;

/** Lo que recibe `difusion_resolver_audiencia`. */
export type AudienciaCompilada = GrupoCompilado | { tipo: "toda_la_base" };

export function esCampoAudiencia(id: string | null): id is CampoAudiencia {
  return id !== null && (CAMPOS_AUDIENCIA as readonly string[]).includes(id);
}

export function compilarAudiencia(
  raiz: Grupo,
  opciones: { todaLaBase: boolean },
): AudienciaCompilada {
  const arbol = validarAudiencia(raiz);
  const filas = contarReglas(arbol);

  if (opciones.todaLaBase) {
    if (filas > 0) {
      throw new ValidationError(
        "Elegiste mandarle a toda la base y la audiencia tiene condiciones. Son dos cosas distintas: sacá las condiciones o dejá de elegir toda la base.",
      );
    }
    return { tipo: "toda_la_base" };
  }

  if (filas === 0) {
    throw new ValidationError(
      "La audiencia no tiene ninguna condición. Si de verdad es para toda la base, hay que elegirlo a propósito: un árbol vacío no se interpreta como «todos».",
    );
  }

  const incompletas = contarIncompletas(arbol);
  if (incompletas > 0) {
    throw new ValidationError(
      incompletas === 1
        ? "Hay una condición sin terminar: con una fila a medias no se sabe a quién le llega."
        : `Hay ${incompletas} condiciones sin terminar: con filas a medias no se sabe a quién le llega.`,
    );
  }

  return compilarGrupo(arbol);
}

function compilarGrupo(g: Grupo): GrupoCompilado {
  if (g.hijos.length === 0) {
    throw new ValidationError(
      "Un grupo sin condiciones no dice nada: «se cumplen todas» sobre nada es toda la base y «se cumple al menos una» sobre nada es nadie. Sacalo o completalo.",
    );
  }
  return { tipo: "grupo", operador: g.operador, hijos: g.hijos.map(compilarNodo) };
}

function compilarNodo(nodo: NodoCondicion): NodoCompilado {
  return nodo.clase === "grupo" ? compilarGrupo(nodo) : compilarRegla(nodo);
}

function compilarRegla(r: Regla): ReglaCompilada {
  const campo = r.campoId;
  if (!esCampoAudiencia(campo)) {
    throw new ValidationError(
      `El campo «${campo ?? "sin elegir"}» no se puede usar en una audiencia de difusión: la base no sabe resolverlo.`,
    );
  }

  const def = DEFINICION_CAMPO_AUDIENCIA[campo];
  const comparador = r.comparador;
  if (comparador === null || !def.comparadores.includes(comparador)) {
    throw new ValidationError(
      `«${campo}» no admite el comparador «${comparador ?? "sin elegir"}» en una audiencia.`,
    );
  }

  switch (comparador) {
    case "tiene":
    case "tiene_todas":
    case "no_tiene":
      return {
        tipo: "regla",
        campo,
        comparador,
        valores: valoresDeLista(campo, def.dominio, r.valor),
      };
    case "contiene":
    case "no_contiene":
      return { tipo: "regla", campo, comparador, texto: textoDe(campo, r.valor) };
    case "esta_vacio":
    case "no_esta_vacio":
      if (r.valor.tipo !== "ninguno") throw valorEquivocado(campo, "ningún valor", r.valor);
      return { tipo: "regla", campo, comparador };
    case "mayor_que":
    case "menor_que":
      return { tipo: "regla", campo, comparador, numero: diasDe(campo, r.valor) };
    case "es":
    case "no_es":
    case "empieza_con":
    case "entre":
    case "antes_de":
    case "despues_de":
      // Ningún campo de audiencia los ofrece y la tabla de arriba ya los frenó.
      // Si alguien se los agrega a un campo sin enseñarle a la base a
      // resolverlos, tiene que fallar acá y no llegar al SQL.
      throw new ValidationError(`El comparador «${comparador}» no se resuelve en audiencias.`);
    default:
      return noContemplado(comparador);
  }
}

function valoresDeLista(
  campo: CampoAudiencia,
  dominio: DominioValores,
  valor: ValorCondicion,
): string[] {
  if (valor.tipo !== "opciones") throw valorEquivocado(campo, "una lista de opciones", valor);
  // Sin repetir: `tiene_todas` compara cuántas distintas tiene el lead contra
  // cuántas se pidieron, y un repetido lo haría imposible de cumplir.
  const unicos = [...new Set(valor.valores)];
  if (unicos.length === 0) throw new ValidationError(`«${campo}» necesita al menos una opción.`);
  for (const v of unicos) {
    if (!valorValido(dominio, v)) {
      throw new ValidationError(`«${v}» no es un valor válido para «${campo}».`);
    }
  }
  return unicos;
}

function valorValido(dominio: DominioValores, v: string): boolean {
  switch (dominio) {
    case "etapas":
      return (CURRENT_STAGE as readonly string[]).includes(v);
    case "canales":
      return (CANAL as readonly string[]).includes(v);
    case "motivos":
      return (MOTIVO_PERDIDA as readonly string[]).includes(v);
    case "ids":
      return UUIDSchema.safeParse(v).success;
    case "texto":
    case "dias":
      // No son dominios de lista. Un campo multilista declarado con uno de
      // estos rechaza todo, que es fallar en voz alta.
      return false;
    default:
      return noContemplado(dominio);
  }
}

function textoDe(campo: CampoAudiencia, valor: ValorCondicion): string {
  if (valor.tipo !== "texto") throw valorEquivocado(campo, "un texto", valor);
  const texto = valor.valor.trim();
  if (texto === "") throw new ValidationError(`«${campo}» necesita un texto para comparar.`);
  return texto;
}

function diasDe(campo: CampoAudiencia, valor: ValorCondicion): number {
  if (valor.tipo !== "numero" || valor.valor === null) {
    throw valorEquivocado(campo, "una cantidad de días", valor);
  }
  if (!Number.isFinite(valor.valor) || valor.valor < 0) {
    throw new ValidationError(
      `«${campo}» necesita una cantidad de días mayor o igual a cero (llegó ${valor.valor}).`,
    );
  }
  return valor.valor;
}

function valorEquivocado(
  campo: CampoAudiencia,
  esperado: string,
  valor: ValorCondicion,
): ValidationError {
  return new ValidationError(
    `«${campo}» espera ${esperado} y llegó un valor de tipo «${valor.tipo}».`,
  );
}

function noContemplado(x: never): never {
  throw new ValidationError(`caso de audiencia no contemplado: ${String(x)}`);
}
