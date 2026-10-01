import { useCallback, useSyncExternalStore } from "react";

export type ModoCentro = "whatsapp" | "hilo";

const POR_DEFECTO: ModoCentro = "whatsapp";
const EVENTO = "crm:vista-centro";

// Respaldo cuando el navegador no deja usar localStorage (ventana privada,
// datos de sitio bloqueados): el selector tiene que seguir funcionando durante
// la sesión aunque no pueda recordar la elección.
const enMemoria = new Map<string, ModoCentro>();

function clave(usuarioId: string | null): string {
  return `crm:inbox:vista-centro:${usuarioId ?? "anon"}`;
}

function leer(key: string): ModoCentro {
  try {
    return window.localStorage.getItem(key) === "hilo" ? "hilo" : POR_DEFECTO;
  } catch {
    return enMemoria.get(key) ?? POR_DEFECTO;
  }
}

function suscribir(avisar: () => void): () => void {
  window.addEventListener("storage", avisar);
  window.addEventListener(EVENTO, avisar);
  return () => {
    window.removeEventListener("storage", avisar);
    window.removeEventListener(EVENTO, avisar);
  };
}

/**
 * Qué muestra el centro del Inbox cuando la conversación se puede ver en
 * WhatsApp Web: WhatsApp Web o el hilo del CRM. Se recuerda por usuario en
 * localStorage; el default es WhatsApp Web.
 *
 * `useSyncExternalStore` y no un effect que lee al montar: no hay un segundo
 * render con el valor viejo, y cambiarlo en una pestaña lo refleja en las
 * demás. El snapshot del server es el default; no importa, porque el render
 * inicial siempre muestra el hilo (ver `CentroConversacion`).
 */
export function usePreferenciaVistaCentro(
  usuarioId: string | null,
): [ModoCentro, (modo: ModoCentro) => void] {
  const key = clave(usuarioId);
  const modo = useSyncExternalStore(
    suscribir,
    () => leer(key),
    () => POR_DEFECTO,
  );

  const cambiar = useCallback(
    (nuevo: ModoCentro) => {
      enMemoria.set(key, nuevo);
      try {
        window.localStorage.setItem(key, nuevo);
      } catch {
        // Sin storage el respaldo en memoria alcanza para esta sesión.
      }
      window.dispatchEvent(new Event(EVENTO));
    },
    [key],
  );

  return [modo, cambiar];
}
