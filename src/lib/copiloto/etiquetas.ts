import type { CodigoErrorBorrador } from "@/lib/copiloto/errores";
import type { ModoDecidido, ModoOverride, ViaUsoBorrador } from "@/types/copiloto";

/** Las tres opciones del interruptor: `segun_horario` es el `null` de la base. */
export type OpcionInterruptor = "segun_horario" | ModoOverride;

export function etiquetaModo(modo: ModoDecidido): string {
  if (modo === "copiloto") return "Copiloto";
  if (modo === "automatico") return "Automático";
  return "Fuera de horario";
}

/** El texto de cada opción. "Según horario" muestra lo que haría hoy, para que el equipo lo vea sin abrir Ajustes. */
export function etiquetaOpcionModo(opcion: OpcionInterruptor, efectivo: ModoDecidido): string {
  if (opcion === "segun_horario") return `Según horario · ahora ${etiquetaModo(efectivo)}`;
  return opcion === "copiloto" ? "Copiloto" : "Automático";
}

// Record exhaustivo: un código nuevo en `CodigoErrorBorrador` rompe el typecheck hasta que tenga frase.
const ERRORES: Record<CodigoErrorBorrador, string> = {
  llm_error: "No se pudo redactar. Reintentá.",
  tope_diario: "Se alcanzó el tope de gasto diario de la IA. Redactá a mano o reintentá más tarde.",
  descuento_excedido: "La IA ofreció un descuento mayor al permitido. Redactá a mano.",
  ia_no_disponible: "La IA no redacta en esta conversación (pausada o escalada).",
  escalado: "La conversación está escalada a una persona: la IA no redacta.",
};

/** El código corto de `borradores_ia.error_codigo` como frase. Nunca se muestra el código crudo. */
export function mensajeDeErrorBorrador(codigo: string | null): string {
  // hasOwn: un código como "constructor" no debe resolver a una función del prototipo.
  if (codigo !== null && Object.hasOwn(ERRORES, codigo)) {
    return ERRORES[codigo as CodigoErrorBorrador];
  }
  return ERRORES.llm_error;
}

export function etiquetaUso(via: ViaUsoBorrador | null): string {
  switch (via) {
    case "insertar":
      return "Ya usado · insertado en WhatsApp";
    case "copiar":
      return "Ya usado · copiado";
    case "abrir_web":
      return "Ya usado · abierto en WhatsApp Web";
    case "al_composer":
      return "Ya usado · enviado desde el CRM";
    default:
      return "Ya usado";
  }
}
