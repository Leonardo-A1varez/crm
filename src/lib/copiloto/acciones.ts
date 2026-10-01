/** Dónde se dibuja la tarjeta (§5). `null` mientras no se sabe si hay app de escritorio. */
export type UbicacionTarjeta = "escritorio-whatsapp" | "escritorio-hilo" | "navegador";
export type AccionPrincipal = "insertar" | "abrir_web";

export const ETIQUETA_PRINCIPAL: Record<AccionPrincipal, string> = {
  insertar: "Insertar en WhatsApp",
  abrir_web: "Abrir en WhatsApp Web",
};

/**
 * Qué acciones de envío ofrece la tarjeta en cada contexto. Copiar y Regenerar
 * están siempre; acá solo se decide la principal y si hay "Al composer" (que
 * envía por la API, con costo: es un saliente humano normal).
 */
export function accionesDeTarjeta(
  ubicacion: UbicacionTarjeta | null,
  hayTelefono: boolean,
): { principal: AccionPrincipal | null; alComposer: boolean } {
  switch (ubicacion) {
    case "escritorio-whatsapp":
      return { principal: "insertar", alComposer: false };
    case "escritorio-hilo":
      return { principal: "insertar", alComposer: true };
    case "navegador":
      return hayTelefono
        ? { principal: "abrir_web", alComposer: false }
        : { principal: null, alComposer: true };
    default:
      return { principal: null, alComposer: false };
  }
}
