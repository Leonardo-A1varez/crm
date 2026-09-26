import type { CategoriaPlantilla } from "./modelo";

/**
 * Cuándo cobra Meta una plantilla. Es la única regla de cobro del CRM: la usan
 * el costo estimado del pre-vuelo y el del asistente.
 *
 * Fuente: https://developers.facebook.com/docs/whatsapp/pricing/ , leída el
 * 2026-09-25. Por mensaje entregado desde el 2025-07-01. Textual: "All
 * marketing template messages are charged" y "utility templates sent within an
 * open CSW are free" (CSW = la ventana de servicio de 24 h).
 *
 * Las tarifas por mercado no están acá: Meta las publica en rate cards
 * descargables por país y moneda, y este CRM todavía no las tiene cargadas.
 */
export const FUENTE_COBRO_META = {
  url: "https://developers.facebook.com/docs/whatsapp/pricing/",
  leida: "2026-09-25",
} as const;

/**
 * Si la plantilla se cobra aunque el destinatario tenga la ventana de servicio
 * abierta. Sólo aplica a quien le sale la plantilla: con la ventana abierta y
 * texto libre en la difusión, el motor manda el texto libre, que no es una
 * plantilla y no se cobra. Sin texto libre, marketing se cobra a todos.
 */
export function seCobraConVentanaAbierta(categoria: CategoriaPlantilla): boolean {
  return categoria === "marketing";
}
