import { z } from "zod";
import { GrafoSchema } from "./workflows.schema";

/**
 * La forma de un flujo importado desde JSON.
 *
 * Sólo la forma: que el grafo tenga sentido (alcanzable, sin ciclos sin
 * espera) lo decide `validarGrafo` al guardar la versión, la misma puerta que
 * pasa "Guardar" en el editor.
 */

/** Lo que admite el campo del diálogo: un flujo exportado a mano no pesa más que esto. */
export const TEXTO_IMPORTAR_MAX = 1_000_000;

/** El default de la columna `workflow_versiones.max_pasos` (ver `TOPE_PASOS`). */
const TOPE_POR_DEFECTO = 500;

export const FlujoImportadoSchema = z.object({
  nombre: z
    .string({ error: "Falta el nombre del flujo." })
    .trim()
    .min(1, "Falta el nombre del flujo.")
    .max(80, "El nombre pasa de 80 caracteres."),
  descripcion: z.string().trim().max(500).nullable().default(null),
  grafo: GrafoSchema,
  maxPasos: z.number().int().min(1).max(500).default(TOPE_POR_DEFECTO),
});
export type FlujoImportado = z.infer<typeof FlujoImportadoSchema>;

/** La entrada de la Server Action: el texto tal cual se pegó o se leyó del archivo. */
export const ImportarFlujoInputSchema = z.object({
  texto: z
    .string()
    .min(1, "Pegá el JSON del flujo o elegí un archivo.")
    .max(TEXTO_IMPORTAR_MAX, "El archivo es demasiado grande para ser un flujo."),
});

/** Lee el texto importado: JSON y después la forma. Nunca lanza. */
export function leerFlujoImportado(
  texto: string,
): { ok: true; flujo: FlujoImportado } | { ok: false; error: string } {
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    return { ok: false, error: "El texto no es JSON válido." };
  }
  const r = FlujoImportadoSchema.safeParse(crudo);
  if (!r.success) {
    const issue = r.error.issues[0];
    const donde = issue && issue.path.length > 0 ? ` (en ${issue.path.join(".")})` : "";
    return {
      ok: false,
      error: `${issue?.message ?? "El flujo no tiene la forma esperada."}${donde}`,
    };
  }
  return { ok: true, flujo: r.data };
}
