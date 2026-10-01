import { useSyncExternalStore } from "react";

const sinSuscripcion = () => () => {};

/**
 * ¿Corre esta página dentro de la app de escritorio? `null` mientras no se
 * sabe: el server no tiene `window`, y la primera pasada del cliente tiene que
 * coincidir con lo que renderizó el server para no romper la hidratación.
 * `window.crmEscritorio` no cambia durante la vida de la página, así que no
 * hay nada a lo que suscribirse.
 */
export function useEscritorio(): boolean | null {
  return useSyncExternalStore(
    sinSuscripcion,
    () => window.crmEscritorio !== undefined,
    () => null,
  );
}
