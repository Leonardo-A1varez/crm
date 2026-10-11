/**
 * Cuánto se pausa la IA de una conversación cuando el negocio contesta desde la
 * app WhatsApp Business del teléfono (coexistencia, `smb_message_echoes`).
 *
 * Decisión del dueño (2026-10-11): 2 horas. Es una constante y no una columna de
 * `agente_config`: hacerla editable exige migración, tipo y defaults de la config,
 * provider, schema de validación y un campo en la pantalla del agente. Si el
 * dueño quiere cambiarla sin tocar código, ese es el trabajo pendiente. Cada eco
 * nuevo extiende la ventana desde su propia hora.
 */
export const PAUSA_POR_RESPUESTA_HUMANA_MIN = 120;

export const PAUSA_POR_RESPUESTA_HUMANA_MS = PAUSA_POR_RESPUESTA_HUMANA_MIN * 60_000;
