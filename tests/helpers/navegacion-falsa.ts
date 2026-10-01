import { useSyncExternalStore } from "react";

/**
 * `next/navigation` para los tests de `/productos`: la URL es la de jsdom
 * (`window.location`) y `history.replaceState` avisa a quien la lee, como hace Next al
 * integrar la API nativa con `useSearchParams`. Así un test escribe la URL, renderiza y
 * ve cómo reacciona la pantalla cuando un filtro la cambia.
 *
 * Uso: `vi.mock("next/navigation", () => import("../helpers/navegacion-falsa"))`.
 */

const EVENTO = "navegacion-falsa";
let instalado = false;

/** Parchea `history.replaceState` una vez por archivo de test. */
export function instalarNavegacion(): void {
  if (instalado) return;
  instalado = true;
  const original = window.history.replaceState.bind(window.history);
  window.history.replaceState = (datos, titulo, url) => {
    original(datos, titulo, url);
    window.dispatchEvent(new Event(EVENTO));
  };
}

/** Pone la URL de la pantalla sin avisar a nadie: es el estado de partida de un test. */
export function ponerUrl(search: string): void {
  window.history.pushState(null, "", search === "" ? "/productos" : `/productos?${search}`);
}

/** La URL actual como `a=1&b=2`, decodificada. */
export function urlActual(): string {
  return decodeURIComponent(window.location.search.replace(/^\?/, "")).replace(/\+/g, " ");
}

function suscribir(avisar: () => void) {
  window.addEventListener(EVENTO, avisar);
  return () => window.removeEventListener(EVENTO, avisar);
}

export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(
    suscribir,
    () => window.location.search,
    () => "",
  );
  return new URLSearchParams(search);
}

export const usePathname = () => "/productos";
export const useRouter = () => ({ replace: () => {}, push: () => {}, refresh: () => {} });
