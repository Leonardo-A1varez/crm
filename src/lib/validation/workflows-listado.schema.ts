import { z } from "zod";

/**
 * Entrada de las dos actions que agregó la pantalla de listado: contar las
 * corridas vivas y crear un flujo desde la galería de plantillas.
 *
 * Están en un archivo aparte de `workflows.schema.ts` porque ése ya lleva los
 * schemas del editor y de las seis mutaciones, y mezclarlos hacía que dos
 * streams tocaran el mismo archivo por motivos distintos. El contrato es el
 * mismo: toda action `'use server'` parsea con Zod en la primera línea
 * (AGENTS.md §0.9).
 */

/**
 * Los flujos de los que hay que contar corridas vivas.
 *
 * El tope no es decorativo: la entrada de una action es `unknown` hasta que
 * este schema la mira, y sin `.max()` un payload con 50.000 ids se convierte
 * en 50.000 consultas contra `workflow_runs`. Una instalación tiene una docena
 * de flujos (AGENTS.md §1, "1 instalación por cliente"), así que 200 es techo
 * de sobra.
 */
export const ContarCorridasVivasSchema = z.object({
  workflowIds: z.array(z.string().uuid()).max(200),
});
export type ContarCorridasVivasInput = z.infer<typeof ContarCorridasVivasSchema>;

/**
 * Alta de un flujo desde la galería. Los mismos límites que
 * `CrearWorkflowSchema`, porque terminan en la misma tabla: el CHECK de
 * `workflows.nombre` es de 80 chars.
 */
export const CrearFlujoDesdePlantillaSchema = z.object({
  nombre: z.string().trim().min(1).max(80),
  descripcion: z.string().trim().max(500).nullable(),
  /**
   * Qué plantilla se eligió, o `null` si se arrancó en blanco. Hoy sólo se
   * registra en la descripción del flujo: **no existe traducción de plantilla
   * a grafo**, así que el flujo nace vacío se elija lo que se elija. Viaja
   * igual para que el día que esa traducción exista no haya que cambiar la
   * firma ni el formulario.
   */
  plantillaId: z.string().trim().max(64).nullable(),
});
export type CrearFlujoDesdePlantillaInput = z.infer<typeof CrearFlujoDesdePlantillaSchema>;
