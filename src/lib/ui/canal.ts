import { CANAL } from "@/types/domain";
import type { Canal } from "@/types/domain";
import type { MetaUserIds } from "@/types/entities";

const COLOR: Record<Canal, string> = {
  wa: "#25D366",
  ig: "#E1306C",
  fb: "#1877F2",
};

const LABEL: Record<Canal, string> = {
  wa: "WhatsApp",
  ig: "Instagram",
  fb: "Messenger",
};

export function canalColor(canal: Canal): string {
  return COLOR[canal];
}

export function canalLabel(canal: Canal): string {
  return LABEL[canal];
}

/**
 * Por qué canales se puede hablar con este lead. Fuente única de la pregunta.
 *
 * Estaba escrita a mano en tres componentes (`ConversationHeader`, `LeadFicha`,
 * `DuplicadosSection`) y de una cuarta forma distinta en el inbox, que la
 * derivaba solo de las conversaciones existentes. Resultado: un lead con
 * WhatsApp e Instagram mostraba los dos en el header y uno solo en la fila. La
 * misma app contestaba distinto a la misma pregunta según la pantalla.
 *
 * Las tres fuentes son legítimas y ninguna sola alcanza:
 * - `canal_origen` es por dónde entró; existe siempre, incluso sin conversación.
 * - las claves de `meta_user_ids` son las identidades de Meta que se le
 *   conocen: es lo que deja el merge de leads y lo que dice que se le *puede*
 *   escribir por ahí aunque todavía no haya hilo.
 * - los canales con conversación cubren el caso inverso: hay hilo abierto pero
 *   el id de Meta no quedó guardado.
 *
 * El orden es estable —`canal_origen` primero, después `CANAL`— para que la
 * tira no se reordene sola entre renders. Quién va *pintado* primero en una
 * fila es otra decisión y la toma `canalesDeFila` con el canal activo.
 */
export function canalesDelLead(
  lead: { canal_origen: Canal; meta_user_ids: MetaUserIds },
  conConversacion: readonly Canal[] = [],
): Canal[] {
  const canales: Canal[] = [lead.canal_origen];
  for (const canal of CANAL) {
    if (canales.includes(canal)) continue;
    if (lead.meta_user_ids[canal] || conConversacion.includes(canal)) canales.push(canal);
  }
  return canales;
}

/**
 * Los canales de una fila del inbox, listos para dibujar.
 *
 * Dos decisiones, las dos por ancho medido. La fila mide 322px; descontando el
 * `px-2` de la lista, el `p-[11px]` del link y el avatar de 38px, a la columna
 * de texto le quedan 236px, y ahí ya viven el nombre, la hora, el preview, el
 * chip de motivo y la etapa.
 *
 * 1. **El activo va primero.** Sin ese pin la fila cambiaría de glifo líder
 *    cada vez que el lead escribe por otro lado, y la lista parpadearía sola.
 * 2. **El nombre del canal solo entra cuando hay uno.** "WhatsApp" al lado del
 *    glifo cuesta ~63px, que el nombre del lead todavía puede ceder. Con dos
 *    nombres el nombre del lead queda en dos letras — y el glifo solo ya
 *    identifica la plataforma, que es para lo que está.
 */
export function canalesDeFila(
  canales: Canal[],
  activo: Canal | null,
  permiteEtiqueta: boolean,
): { canales: Canal[]; conEtiqueta: boolean } {
  const ordenados =
    activo === null ? [...canales] : [activo, ...canales.filter((c) => c !== activo)];
  return { canales: ordenados, conEtiqueta: permiteEtiqueta && ordenados.length === 1 };
}
