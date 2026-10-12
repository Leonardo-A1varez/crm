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

/**
 * El operando de `lead_session.extras @> …` / PostgREST `not.cs.…` que reconoce
 * una sesión importada. Las lecturas que NO deben contarlas (Métricas, el
 * resultado y el filtro «Perdidos» de Leads) lo piden en la base en vez de
 * traerlas y descartarlas: el historial son miles de mensajes.
 */
export const FILTRO_JSONB_SESION_IMPORTADA = JSON.stringify({ [CLAVE_SESION_IMPORTADA]: true });

export function esSesionImportada(sesion: Pick<LeadSession, "extras">): boolean {
  return sesion.extras[CLAVE_SESION_IMPORTADA] === true;
}
