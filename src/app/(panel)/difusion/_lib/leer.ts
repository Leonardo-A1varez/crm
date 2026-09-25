import { unstable_rethrow } from "next/navigation";
import type { Logger } from "@/lib/observability/logger";

export type Leido<T> = { estado: "ok"; datos: T } | { estado: "error"; mensaje: string };

/**
 * Lee una parte de la pantalla sin que su falla tumbe la página entera: lo que
 * no se pudo leer vuelve como `error` con el mensaje, y la pantalla lo dibuja
 * en su lugar. Mismo criterio que `ajustes/_lib/leer-seccion.ts`, con el
 * evento de log de Difusión.
 *
 * `unstable_rethrow` va primero: si lo atrapado es un control de Next
 * (redirect, notFound, la señal de render dinámico), sigue de largo.
 *
 * El detalle va al log en `detalle` y no en `mensaje`: `redactPii` tacha la
 * clave `mensaje` —es la del cuerpo de un WhatsApp— y el aviso llegaría vacío.
 */
export async function leerParaPantalla<T>(
  seccion: string,
  leer: () => Promise<T>,
  logger: Logger,
): Promise<Leido<T>> {
  try {
    return { estado: "ok", datos: await leer() };
  } catch (error) {
    unstable_rethrow(error);
    const mensaje = error instanceof Error ? error.message : String(error);
    logger.warn("difusion.lectura_fallida", {
      seccion,
      tipo: error instanceof Error ? error.name : typeof error,
      detalle: mensaje,
    });
    return { estado: "error", mensaje };
  }
}
