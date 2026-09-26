import { z } from "zod";
import { interpolarVariables, type DatosInterpolacion } from "@/lib/workflows/variables";
import { LARGO_MAXIMO_TEXTO_LIBRE } from "./modelo";

/**
 * Las variables del cuerpo de la plantilla de una difusión (`{{1}}`, `{{2}}`…),
 * cómo se guardan en `difusiones.plantilla_parametros` y cómo se resuelven
 * para cada destinatario.
 *
 * Mismo mecanismo que los workflows: cada parámetro es un texto con la
 * sintaxis `{{namespace.campo}}` y lo resuelve `interpolarVariables`
 * (`lib/workflows/variables.ts`). La diferencia es que acá el valor es UNA
 * variable de una lista cerrada —el asistente la elige de un desplegable, no
 * se escribe— más un respaldo literal para quien no tenga el dato. Meta
 * rechaza un parámetro vacío, así que sin dato y sin respaldo no se manda.
 */

/** Los datos del lead que puede llevar una variable. Mismo conjunto que el asistente. */
export const CAMPOS_PARAMETRO = [
  "nombre",
  "nombre_perfil",
  "vehiculo_marca",
  "vehiculo_modelo",
  "vehiculo_anio",
  "consulta",
] as const;
export type CampoParametro = (typeof CAMPOS_PARAMETRO)[number];

const TOKEN: Record<CampoParametro, string> = {
  nombre: "{{lead.nombre}}",
  nombre_perfil: "{{lead.nombre_perfil}}",
  vehiculo_marca: "{{lead.vehiculo_marca}}",
  vehiculo_modelo: "{{lead.vehiculo_modelo}}",
  vehiculo_anio: "{{lead.vehiculo_anio}}",
  // Vive en la sesión activa: una sesión cerrada se purga a los 29 días.
  consulta: "{{sesion.consulta}}",
};

const CAMPO_POR_TOKEN = new Map<string, CampoParametro>(CAMPOS_PARAMETRO.map((c) => [TOKEN[c], c]));

export function tokenDeCampo(campo: CampoParametro): string {
  return TOKEN[campo];
}

export function campoDeToken(valor: string): CampoParametro | null {
  return CAMPO_POR_TOKEN.get(valor.trim()) ?? null;
}

/** Un respaldo es una o dos palabras en lugar de un dato; más largo cambia el texto aprobado. */
export const LARGO_MAXIMO_RESPALDO = 40;
/** Cota defensiva, no un límite documentado de Meta. */
export const MAXIMO_PARAMETROS = 20;

export const ParametroPlantillaSchema = z.strictObject({
  valor: z.string().refine((v) => campoDeToken(v) !== null, {
    message: "cada variable sale de un dato del lead de la lista",
  }),
  respaldo: z
    .string()
    .max(LARGO_MAXIMO_RESPALDO, `el respaldo va hasta ${LARGO_MAXIMO_RESPALDO} caracteres`)
    .refine((v) => !v.includes("{{") && !v.includes("}}"), {
      message: "el respaldo es texto literal: no lleva llaves",
    }),
});

export const ParametrosPlantillaSchema = z
  .array(ParametroPlantillaSchema)
  .max(MAXIMO_PARAMETROS, `una plantilla lleva hasta ${MAXIMO_PARAMETROS} variables`);

export type ParametroPlantilla = z.infer<typeof ParametroPlantillaSchema>;

/**
 * Código de idioma como lo devuelve Meta al listar plantillas (`es`, `es_AR`,
 * `pt_BR`, `en_US`). Se manda tal cual en `template.language.code`.
 */
export const IdiomaPlantillaSchema = z
  .string()
  .regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "el idioma de la plantilla no tiene la forma de Meta");

export type ResolucionParametros =
  | { ok: true; valores: string[] }
  | { ok: false; /** Como en la plantilla: 1 es `{{1}}`. */ numero: number };

export function resolverParametros(
  parametros: readonly ParametroPlantilla[],
  datos: DatosInterpolacion,
): ResolucionParametros {
  const valores: string[] = [];
  for (const [indice, p] of parametros.entries()) {
    const dato = interpolarVariables(p.valor, datos).texto.trim();
    const valor = dato !== "" ? dato : p.respaldo.trim();
    if (valor === "") return { ok: false, numero: indice + 1 };
    valores.push(valor);
  }
  return { ok: true, valores };
}

/** Qué datos hay que cargar para resolver estos parámetros. */
export function camposUsados(parametros: readonly ParametroPlantilla[]): Set<CampoParametro> {
  const usados = new Set<CampoParametro>();
  for (const p of parametros) {
    const c = campoDeToken(p.valor);
    if (c) usados.add(c);
  }
  return usados;
}

// ---------------------------------------------------------------------------
// El texto libre (PRD §7.3.5): mismas variables, mismo interpolador
// ---------------------------------------------------------------------------

/** Cualquier `{{ns.campo}}`, conocido o no: es la forma que ve `interpolarVariables`. */
const VARIABLE_EN_TEXTO = /\{\{\w+\.\w+\}\}/g;

/** Los datos del lead que usa un texto libre: lo que hay que cargar para resolverlo. */
export function camposEnTexto(texto: string): Set<CampoParametro> {
  const usados = new Set<CampoParametro>();
  for (const m of texto.matchAll(VARIABLE_EN_TEXTO)) {
    const c = campoDeToken(m[0]);
    if (c) usados.add(c);
  }
  return usados;
}

/**
 * La versión en texto libre de una difusión. Sólo las variables que el motor
 * carga (`CAMPOS_PARAMETRO`): otra saldría vacía para todos. Hasta 4096
 * caracteres, lo que Meta acepta en `text.body`.
 */
export const TextoLibreSchema = z
  .string()
  .trim()
  .min(1, "el texto libre no puede quedar vacío")
  .max(LARGO_MAXIMO_TEXTO_LIBRE, `el texto libre va hasta ${LARGO_MAXIMO_TEXTO_LIBRE} caracteres`)
  .refine((t) => [...t.matchAll(VARIABLE_EN_TEXTO)].every((m) => campoDeToken(m[0]) !== null), {
    message: "el texto libre sólo lleva datos del lead de la lista",
  });
