import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import {
  COMPARADORES,
  PROFUNDIDAD_MAX,
  contarReglas,
  profundidad,
  type Grupo,
  type NodoCondicion,
  type Regla,
  type ValorCondicion,
} from "@/lib/ui/condiciones";

/**
 * La forma del árbol de condiciones de una audiencia, no su sentido.
 *
 * Valida estructura —grupos, filas, valores tipados, tope de anidado— para que
 * lo que se guarda en `difusiones.audiencia` sea de verdad un `Grupo`. Que la
 * audiencia esté completa (`condicionCompleta`) y que sus campos existan en el
 * catálogo lo decide quien la resuelve antes de mandar: un borrador puede
 * guardarse a medio armar.
 *
 * Los objetos son estrictos: una propiedad que el modelo no conoce se rechaza
 * en vez de descartarse callada. Si `condiciones.ts` crece, este schema tiene
 * que crecer con él, y el primer guardado lo avisa.
 */

/** Cotas defensivas contra un payload patológico, no reglas de negocio. */
export const MAX_REGLAS_AUDIENCIA = 50;
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

const ReglaSchema: z.ZodType<Regla> = z.strictObject({
  id: Id,
  clase: z.literal("regla"),
  campoId: Id.nullable(),
  comparador: z.enum(COMPARADORES).nullable(),
  valor: ValorSchema,
});

// Recursivo: un grupo tiene filas y grupos. `z.lazy` con el tipo anotado para
// que TypeScript no tenga que inferir un tipo que se contiene a sí mismo.
const NodoSchema: z.ZodType<NodoCondicion> = z.lazy(() => z.union([ReglaSchema, GrupoSchema]));

const GrupoSchema: z.ZodType<Grupo> = z.lazy(() =>
  z.strictObject({
    id: Id,
    clase: z.literal("grupo"),
    operador: z.enum(["y", "o"]),
    hijos: z.array(NodoSchema).max(MAX_HIJOS),
  }),
);

export const AudienciaSchema: z.ZodType<Grupo> = GrupoSchema.refine(
  (g) => profundidad(g) <= PROFUNDIDAD_MAX,
  { message: `la audiencia admite hasta ${PROFUNDIDAD_MAX} niveles de grupos` },
).refine((g) => contarReglas(g) <= MAX_REGLAS_AUDIENCIA, {
  message: `la audiencia admite hasta ${MAX_REGLAS_AUDIENCIA} filas`,
});

/** El árbol validado, o `ValidationError` con los issues de Zod. */
export function validarAudiencia(valor: unknown): Grupo {
  const r = AudienciaSchema.safeParse(valor);
  if (!r.success) {
    throw new ValidationError(
      "la audiencia no tiene la forma del árbol de condiciones",
      r.error.issues,
    );
  }
  return r.data;
}
