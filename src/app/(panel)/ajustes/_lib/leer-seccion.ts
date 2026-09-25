import { unstable_rethrow } from "next/navigation";
import type { Lectura } from "@/components/ajustes";
import type { Logger } from "@/lib/observability/logger";

/**
 * Lee los datos de una sección sin que su falla tumbe la página: lo que no se
 * pudo leer vuelve como `error` con el mensaje, y la pantalla lo dibuja en el
 * lugar de la sección.
 *
 * `unstable_rethrow` va primero: si lo atrapado es un control de Next
 * (redirect, notFound, la señal de render dinámico), tiene que seguir de largo
 * en vez de convertirse en un cartel de error.
 *
 * El detalle se loguea en `detalle` y no en `mensaje`: `redactPii` tacha la
 * clave `mensaje` —es la del cuerpo de un WhatsApp— y el aviso llegaría vacío.
 */
export async function leerSeccion<T>(
  seccion: string,
  leer: () => Promise<T>,
  logger: Logger,
): Promise<Lectura<T>> {
  try {
    return { estado: "ok", datos: await leer() };
  } catch (error) {
    unstable_rethrow(error);
    const mensaje = error instanceof Error ? error.message : String(error);
    logger.warn("ajustes.lectura_fallida", {
      seccion,
      tipo: error instanceof Error ? error.name : typeof error,
      detalle: mensaje,
    });
    return { estado: "error", mensaje };
  }
}
