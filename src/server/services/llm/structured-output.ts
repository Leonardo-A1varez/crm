/**
 * Opciones de provider compartidas por los `generateObject` del CRM.
 *
 * El AI SDK manda los schemas a OpenAI en modo strict por default, y strict
 * rechaza buena parte de lo que Zod emite:
 *
 *   - `format` — lo producen `.url()`, `.uuid()`, `.datetime()`
 *   - `propertyNames` — lo produce `z.record()`
 *   - cualquier campo `.optional()` — strict exige que `required` liste TODAS
 *     las keys de `properties`
 *
 * Los 3 schemas LLM del CRM usan esas construcciones, así que en strict fallan
 * siempre. Verificado contra la API real el 2026-08-07: `update-lead-twin`
 * nunca completó una ejecución desde Slice 1, fallando en cadena con
 * `'uri' is not a valid format` → `'propertyNames' is not permitted` →
 * `'required' ... Missing 'current_stage'`. Los tests unitarios no lo vieron
 * porque `MockLanguageModelV3` no valida el JSON Schema contra la API.
 *
 * Apagar strict recupera el comportamiento útil: OpenAI deja de *garantizar* la
 * conformidad, pero el AI SDK sigue validando la respuesta con Zod y lanza si no
 * cumple. El modo de falla pasa de "falla siempre" a "ocasionalmente reintenta".
 *
 * El arreglo de fondo es reescribir los schemas a forma strict-compatible (todo
 * en `required`, `nullable` en lugar de `optional`, sin `format` ni `record`).
 * Eso cambia la semántica que leen los services y va como tarea aparte.
 */
export const NON_STRICT_JSON_SCHEMA = {
  openai: { strictJsonSchema: false },
};
