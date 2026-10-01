import { BudgetExceededError } from "@/lib/errors";

/**
 * Códigos cortos que se guardan en `borradores_ia.error_codigo`. Nunca texto del
 * proveedor: el CHECK de la tabla exige `^[a-z_]{1,40}$` y el mensaje de un
 * error del LLM puede traer fragmentos de la conversación.
 */
export type CodigoErrorBorrador =
  | "llm_error"
  | "tope_diario"
  | "descuento_excedido"
  | "ia_no_disponible";

/**
 * Qué código de error le toca a un fallo de `respond`. El error de un step de
 * Inngest puede llegar sin su clase original, por eso además de `instanceof`
 * se mira `name` (cada `DomainError` lo fija a `constructor.name`).
 */
export function codigoDeErrorBorrador(e: unknown): "tope_diario" | "llm_error" {
  if (e instanceof BudgetExceededError) return "tope_diario";
  if (e instanceof Error && e.name === "BudgetExceededError") return "tope_diario";
  return "llm_error";
}
