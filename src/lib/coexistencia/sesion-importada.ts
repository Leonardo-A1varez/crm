import type { LeadSession } from "@/types/entities";

/**
 * Marca en `lead_session.extras` de la sesión que agrupa el historial importado
 * de la app WhatsApp Business (webhook `history`, docs/meta/conectar-whatsapp.md).
 *
 * El esquema sólo admite `resultado` `exito` o `perdido`, así que esas sesiones se
 * cierran como `perdido` sin motivo. Eso no es un dato de negocio: nadie perdió una
 * venta. La marca es lo que permite a quien cuenta ventas perdidas, reactiva
 * clientes o purga por antigüedad dejarlas afuera.
 */
export const CLAVE_SESION_IMPORTADA = "importado_historial";

export function esSesionImportada(sesion: Pick<LeadSession, "extras">): boolean {
  return sesion.extras[CLAVE_SESION_IMPORTADA] === true;
}
