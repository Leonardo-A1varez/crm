import type { Canal } from "@/types/domain";

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
