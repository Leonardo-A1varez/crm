import { z } from "zod";
import {
  COMPARADORES,
  COMPARADORES_POR_TIPO,
  PROFUNDIDAD_MAX,
  contarReglas,
  profundidad,
  reglaIncompleta,
  valorPorDefecto,
  type Grupo,
  type NodoCondicion,
  type Regla,
  type ValorCondicion,
} from "@/lib/ui/condiciones";
import {
  CAMPOS_CONDICION,
  OPCIONES_DE_CAMPO_CONDICION,
  OPERADORES,
  TIPO_DE_CAMPO_CONDICION,
  arbolDeCondicionPlana,
  arbolVacio,
  esCampoCondicion,
  type Condicion,
  type CondicionArbol,
} from "./condiciones";

/**
 * La validación de las condiciones de un workflow. Son dos preguntas distintas
 * y por eso son dos schemas:
 *
 * - `ConfigCondicionSchema`: ¿esto es una config de `logica_condicion`? La
 *   forma y nada más. Un borrador se guarda a medias —igual que la audiencia de
 *   Difusión—, así que acepta filas sin terminar y la config vacía de un nodo
 *   recién soltado. Es la que importa `config-nodos.ts`.
 * - `CondicionSchema`: ¿el motor la puede evaluar? La corre el ejecutor antes
 *   de cada evaluación. Exige cada fila completa, sobre un campo de la lista
 *   blanca, con un comparador que su tipo admite y un valor que le corresponde.
 *   Una condición a medias no cae a una rama: falla en voz alta, porque una que
 *   se evaluara igual acertaría de más o de menos sin que nadie se entere.
 *
 * Las dos deciden la forma por la presencia de `arbol`: si está, manda el árbol
 * —aunque quede un trío viejo al lado— y se valida como árbol; si no está, es
 * el trío plano. Un árbol roto nunca cae al trío.
 */

/** Cotas contra un payload patológico, las mismas que la audiencia de Difusión. */
export const MAX_FILAS_CONDICION = 50;
const MAX_HIJOS = 50;
const MAX_OPCIONES = 200;

const Id = z.string().min(1).max(64);
const Texto = z.string().max(200);
// Zod 4 rechaza Infinity y NaN en z.number() por defecto.
const Numero = z.number();
const Fecha = z.string().min(1).max(40);

const ValorSchema: z.ZodType<ValorCondicion> = z.discriminatedUnion("tipo", [
  z.strictObject({ tipo: z.literal("ninguno") }),
  z.strictObject({ tipo: z.literal("opcion"), valor: Texto.nullable() }),
  z.strictObject({ tipo: z.literal("opciones"), valores: z.array(Texto).max(MAX_OPCIONES) }),
  z.strictObject({ tipo: z.literal("texto"), valor: Texto }),
  z.strictObject({ tipo: z.literal("numero"), valor: Numero.nullable() }),
  z.strictObject({ tipo: z.literal("rango"), desde: Numero.nullable(), hasta: Numero.nullable() }),
  z.strictObject({ tipo: z.literal("fecha"), valor: Fecha.nullable() }),
  z.strictObject({
    tipo: z.literal("rangoFecha"),
    desde: Fecha.nullable(),
    hasta: Fecha.nullable(),
  }),
  z.strictObject({ tipo: z.literal("booleano"), valor: z.boolean() }),
]);

// Objetos estrictos: una propiedad que el modelo compartido no tiene se
// rechaza en vez de descartarse callada. Si `lib/ui/condiciones.ts` crece,
// esto tiene que crecer con él, y el primer guardado lo avisa.
const ReglaSchema: z.ZodType<Regla> = z.strictObject({
  id: Id,
  clase: z.literal("regla"),
  campoId: Id.nullable(),
  comparador: z.enum(COMPARADORES).nullable(),
  valor: ValorSchema,
});

// Recursivo: `z.lazy` con el tipo anotado, para que TypeScript no tenga que
// inferir un tipo que se contiene a sí mismo.
const NodoSchema: z.ZodType<NodoCondicion> = z.lazy(() => z.union([ReglaSchema, GrupoSchema]));

const GrupoSchema: z.ZodType<Grupo> = z.lazy(() =>
  z.strictObject({
    id: Id,
    clase: z.literal("grupo"),
    operador: z.enum(["y", "o"]),
    hijos: z.array(NodoSchema).max(MAX_HIJOS),
  }),
);

/** La forma del árbol: estructura, tope de anidado y de filas. Acepta filas a medias. */
export const ArbolCondicionSchema: z.ZodType<Grupo> = GrupoSchema.refine(
  (g) => profundidad(g) <= PROFUNDIDAD_MAX,
  { error: `la condición admite hasta ${PROFUNDIDAD_MAX} niveles de grupos` },
).refine((g) => contarReglas(g) <= MAX_FILAS_CONDICION, {
  error: `la condición admite hasta ${MAX_FILAS_CONDICION} filas`,
});

/**
 * Lo que le falta a una fila para que el motor la pueda evaluar, o `null`.
 * `fila` es su posición contando sólo filas, de arriba abajo: es como la ve
 * quien la armó.
 */
function problemaDeRegla(regla: Regla, fila: number): string | null {
  if (regla.campoId === null) return `la fila ${fila} no tiene campo`;
  if (!esCampoCondicion(regla.campoId)) {
    return `la fila ${fila} usa un campo que el motor no conoce: "${regla.campoId}"`;
  }
  const campo = regla.campoId;
  if (regla.comparador === null) return `la fila ${fila} (${campo}) no tiene comparador`;
  const tipo = TIPO_DE_CAMPO_CONDICION[campo];
  if (!COMPARADORES_POR_TIPO[tipo].includes(regla.comparador)) {
    return `la fila ${fila}: ${campo} no admite "${regla.comparador}"`;
  }
  if (valorPorDefecto(tipo, regla.comparador).tipo !== regla.valor.tipo) {
    return `la fila ${fila} (${campo}): el valor no corresponde al comparador`;
  }
  if (reglaIncompleta(regla)) return `a la fila ${fila} (${campo}) le falta el valor`;
  const opciones = OPCIONES_DE_CAMPO_CONDICION[campo];
  if (
    opciones &&
    regla.valor.tipo === "opcion" &&
    regla.valor.valor !== null &&
    !opciones.includes(regla.valor.valor)
  ) {
    return `la fila ${fila}: "${regla.valor.valor}" no es un valor posible de ${campo}`;
  }
  return null;
}

/**
 * Todo lo que le falta a un árbol para que el motor lo pueda evaluar, en
 * orden. Vacío = evaluable. Sirve también para mostrarlo en el editor antes de
 * publicar: son los mismos mensajes con los que fallaría la corrida.
 */
export function problemasDeArbol(arbol: Grupo): string[] {
  const problemas: string[] = [];
  let fila = 0;
  const visitar = (nodo: NodoCondicion, esRaiz: boolean): void => {
    if (nodo.clase === "grupo") {
      if (nodo.hijos.length === 0) {
        problemas.push(esRaiz ? "la condición no tiene ninguna fila" : "hay un grupo sin filas");
      }
      for (const hijo of nodo.hijos) visitar(hijo, false);
      return;
    }
    fila += 1;
    const problema = problemaDeRegla(nodo, fila);
    if (problema) problemas.push(problema);
  };
  visitar(arbol, true);
  return problemas;
}

const ArbolEvaluableSchema = ArbolCondicionSchema.superRefine((arbol, ctx) => {
  for (const mensaje of problemasDeArbol(arbol)) {
    ctx.addIssue({ code: "custom", message: mensaje, input: arbol });
  }
});

function tieneArbol(valor: unknown): boolean {
  return typeof valor === "object" && valor !== null && Object.hasOwn(valor, "arbol");
}

/** Los mensajes propios ya se leen solos; a los de forma de Zod se les antepone dónde. */
function legible(issue: { code: string; path: readonly PropertyKey[]; message: string }): string {
  if (issue.code === "custom" || issue.path.length === 0) return issue.message;
  return `${issue.path.map(String).join(".")}: ${issue.message}`;
}

/**
 * Elige el schema por la presencia de `arbol` en vez de probar los dos con un
 * `z.union`: una unión dejaría que un árbol roto con un trío viejo al lado se
 * aceptara como trío, y su error sería un "Invalid input" que no dice nada.
 */
function porForma<ConArbol, Plana>(conArbol: z.ZodType<ConArbol>, plana: z.ZodType<Plana>) {
  return z.unknown().transform((valor, ctx): ConArbol | Plana => {
    const r = tieneArbol(valor) ? conArbol.safeParse(valor) : plana.safeParse(valor);
    if (r.success) return r.data;
    for (const issue of r.error.issues) {
      ctx.issues.push({ code: "custom", message: legible(issue), input: valor });
    }
    return z.NEVER;
  });
}

const ConfigPlanaSchema = z.object({
  campo: z.enum(CAMPOS_CONDICION).optional(),
  operador: z.enum(OPERADORES).optional(),
  valor: Texto.nullable().optional(),
});

/**
 * La config de un nodo `logica_condicion` (y del `condicion` legacy) tal como
 * se guarda: `{ arbol }` con el árbol del constructor, o el trío plano de
 * antes. Guardar un árbol es reemplazar la config entera por `{ arbol }`.
 */
export const ConfigCondicionSchema = porForma(
  z.object({ arbol: ArbolCondicionSchema }),
  ConfigPlanaSchema,
);
export type ConfigCondicion = z.output<typeof ConfigCondicionSchema>;

const CondicionPlanaSchema = z.object({
  campo: z.enum(CAMPOS_CONDICION),
  // `??` y no `.default()`: un null también vale el default que el panel
  // muestra y no guarda, igual que `configDeCondicion` en el ejecutor.
  operador: z
    .enum(OPERADORES)
    .nullish()
    .transform((o) => o ?? "es"),
  valor: Texto.nullish().transform((v) => v ?? null),
});

/** Lo que valida el ejecutor antes de evaluar. Ver el bloque de arriba. */
export const CondicionSchema: z.ZodType<Condicion> = porForma(
  z.object({ arbol: ArbolEvaluableSchema }),
  CondicionPlanaSchema,
);

function esConfigArbol(c: ConfigCondicion): c is CondicionArbol {
  return "arbol" in c;
}

/**
 * El árbol con que el constructor abre la condición de un nodo guardado:
 *
 * - `{ arbol }` → ese árbol, tal cual;
 * - un trío plano → un árbol de una fila, con su misma semántica;
 * - la config vacía de un nodo recién soltado → un grupo Y con una fila vacía.
 *
 * `null` si la config trae un árbol con la forma rota: es mejor decir que no
 * se puede abrir que reemplazar lo guardado por un árbol vacío.
 */
export function arbolDeConfig(config: unknown): Grupo | null {
  const r = ConfigCondicionSchema.safeParse(config);
  if (!r.success) return null;
  const c = r.data;
  if (esConfigArbol(c)) return c.arbol;
  if (c.campo === undefined) return arbolVacio();
  return arbolDeCondicionPlana({
    campo: c.campo,
    operador: c.operador ?? "es",
    valor: c.valor ?? null,
  });
}
