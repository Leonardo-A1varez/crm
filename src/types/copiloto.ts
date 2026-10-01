/** Preferencia por conversación. `null` en la base = "Según horario". */
export const MODOS_OVERRIDE = ["copiloto", "automatico"] as const;
export type ModoOverride = (typeof MODOS_OVERRIDE)[number];

/**
 * Qué hace el pipeline con un mensaje entrante (§3.2):
 * - `copiloto`: la IA redacta un borrador; no se manda nada por la API.
 * - `automatico`: la IA contesta por la API, como siempre.
 * - `fuera_de_horario`: plantilla de fuera de horario si hay, o nada; sin LLM.
 */
export type ModoDecidido = "copiloto" | "automatico" | "fuera_de_horario";
