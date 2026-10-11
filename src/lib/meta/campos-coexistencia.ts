/**
 * Los `field` de webhook de coexistencia (número que sigue en la app WhatsApp
 * Business y además tiene Cloud API). Meta pide suscribirlos en App Dashboard ›
 * WhatsApp › Configuración (onboarding-business-app-users, leída 2026-10-11):
 *
 *   - `history`             mensajes de los últimos 180 días, en fases y lotes,
 *                           o el aviso de que el negocio no quiso compartirlos.
 *   - `smb_app_state_sync`  contactos agregados, editados o quitados en la app.
 *   - `smb_message_echoes`  lo que el negocio manda desde la app o un
 *                           dispositivo vinculado.
 *
 * Aparte de `parse-coexistencia.ts` para que `parse-webhook.ts` los excluya de
 * los eventos operativos sin importar el parser entero (que importa de él).
 */
export const CAMPOS_COEXISTENCIA = ["history", "smb_app_state_sync", "smb_message_echoes"] as const;

export type CampoCoexistencia = (typeof CAMPOS_COEXISTENCIA)[number];
